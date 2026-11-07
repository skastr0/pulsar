#!/usr/bin/env python3
"""Render CV facts as `<path>\t<chain>\t<covered>/<coverable>`, the fixture expectation shape.

Usage: render_cv.py <facts-file> <fns-file>

Reads only the `CV` relation from the facts file and joins it with the `.fns` side table, so
function ids may shift without touching an expectation: the chain and path identify the
function. Sorted by path, then function id.
"""
import sys

facts_path, fns_path = sys.argv[1], sys.argv[2]
chains = {}
with open(fns_path) as f:
    for line in f:
        line = line.rstrip("\n")
        if not line:
            continue
        fn, path, start, end, parent, kind, chain = line.split("\t")
        chains[int(fn)] = (path, chain)

rows = []
with open(facts_path) as f:
    for line in f:
        parts = line.split()
        if parts and parts[0] == "CV":
            fn, covered, coverable = int(parts[1]), int(parts[2]), int(parts[3])
            if fn not in chains:
                sys.exit(f"CV names fn {fn}, which {fns_path} does not define")
            path, chain = chains[fn]
            rows.append((fn, path, chain, covered, coverable))

for _, path, chain, covered, coverable in sorted(rows):
    print(f"{path}\t{chain}\t{covered}/{coverable}")
