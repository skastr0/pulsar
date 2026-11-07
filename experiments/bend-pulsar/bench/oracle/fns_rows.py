#!/usr/bin/env python3
"""Convert a `.fns` side table to engine-row JSONL for diff_metrics.py.

.fns row (FACTS.md): `fn path start_line end_line parent kind chain`
  fn is the global function id (row index); parent is an id or `-`;
  kind is the numeric FACTS.md kind; chain is the `>`-joined qualified name.

Engine-row shape emitted (no metrics yet — FM lines land with the engine
spine, #684):
  {"tool":"engine","path":...,"chain":...,"name":...,"kind":...,
   "ordinal":0,"start_line":N,"end_line":N,"fn":ID}

Usage: fns_rows.py FILE.fns > FILE.engine.jsonl
"""
import json
import sys

KIND_NAMES = {
    0: "declaration", 1: "function-expression", 2: "arrow-or-closure",
    3: "method", 4: "getter", 5: "setter", 6: "constructor", 7: "static-block",
}


def main():
    for line in open(sys.argv[1], encoding="utf-8"):
        line = line.rstrip("\n")
        if not line:
            continue
        fn, path, start, end, _parent, kind, chain = line.split("\t")
        name = chain.rsplit(">", 1)[-1] if chain else ""
        print(json.dumps({
            "tool": "engine",
            "path": path,
            "chain": chain,
            "name": name,
            "kind": KIND_NAMES.get(int(kind), str(kind)),
            "ordinal": 0,
            "start_line": int(start),
            "end_line": int(end),
            "fn": int(fn),
        }))


if __name__ == "__main__":
    main()
