#!/usr/bin/env python3
"""Normalize `lizard --csv` output to oracle JSONL rows.

Reads lizard CSV on stdin (or a file argument), emits one JSON row per
function:

  {"tool":"lizard","path":...,"name":...,"start_line":...,"end_line":...,
   "metrics":{"lizard.nloc":...,"lizard.ccn":...,"lizard.token":...,
              "lizard.param":...,"lizard.length":...}}

Metrics live in the nested dict (not flat fields) so diff_metrics.py
--metric aliases can rename them to canonical names — flat fields get
tool-prefixed inside metrics_of() after renames run.

Lizard CSV columns (no header):
  NLOC, CCN, token, PARAM, length, "name@start-end@file", file, name,
  args, start_line, end_line

Limitations vs the .fns contract: lizard reports the bare function name
(no container chain) and does not distinguish kind — `name` may collide
across impls/modules in one file; the diff script disambiguates by line
span and ordinal.
"""
import csv
import json
import sys


def main() -> int:
    data = sys.argv[1] if len(sys.argv) > 1 else None
    text = open(data, encoding="utf-8").read() if data else sys.stdin.read()
    for row in csv.reader(text.splitlines()):
        if len(row) < 11:
            continue
        nloc, ccn, token, param, length = row[0], row[1], row[2], row[3], row[4]
        path, name = row[6], row[7]
        try:
            start, end = int(row[9]), int(row[10])
        except ValueError:
            continue
        num = lambda s: int(s) if s and s.lstrip("-").isdigit() else None
        print(json.dumps({
            "tool": "lizard",
            "path": path,
            "name": name,
            "start_line": start,
            "end_line": end,
            "metrics": {
                "lizard.nloc": num(nloc),
                "lizard.ccn": num(ccn),
                "lizard.token": num(token),
                "lizard.param": num(param),
                "lizard.length": num(length),
            },
        }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
