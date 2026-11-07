#!/usr/bin/env python3
"""Convert pulsar-engine FM output plus a `.fns` side table to engine rows.

FM line (engine stdout): `FM <fn-id> <cyclomatic> <nesting> <npath> <length> [cognitive]`
.fns row: `fn path start_line end_line parent kind chain`

Emits diff_metrics.py engine rows with canonical metric names
(cyclomatic, nesting, npath, length) so --metric aliases can join them
against oracle names (eslint.cyclomatic, lizard.ccn, ...).

Usage: fm_rows.py FILE.fns < engine-output.txt > FILE.engine.jsonl
"""
import json
import sys


def main():
    fns_path = sys.argv[1]
    fns = {}
    for line in open(fns_path, encoding="utf-8"):
        line = line.rstrip("\n")
        if not line:
            continue
        fn, path, start, end, _parent, kind, chain = line.split("\t")
        fns[int(fn)] = (path, int(start), int(end), kind, chain)

    KIND_NAMES = {
        "0": "declaration", "1": "function-expression",
        "2": "arrow-or-closure", "3": "method", "4": "getter",
        "5": "setter", "6": "constructor", "7": "static-block",
    }

    for line in sys.stdin:
        p = line.split()
        if len(p) < 6 or p[0] != "FM":
            continue
        fid = int(p[1])
        if fid not in fns:
            continue
        path, start, end, kind, chain = fns[fid]
        metrics = {
            "cyclomatic": int(p[2]),
            "nesting": int(p[3]),
            "npath": int(p[4]),
            "length": int(p[5]),
        }
        if len(p) > 6:
            metrics["cognitive"] = int(p[6])
        print(json.dumps({
            "tool": "engine",
            "path": path,
            "chain": chain,
            "name": chain.rsplit(">", 1)[-1] if chain else "",
            "kind": KIND_NAMES.get(kind, kind),
            "ordinal": 0,
            "start_line": start,
            "end_line": end,
            "fn": fid,
            "metrics": metrics,
        }))


if __name__ == "__main__":
    main()
