#!/usr/bin/env python3
# FM lines + .fns -> engine JSONL rows for bench/oracle/diff_metrics.py.
# usage: fm2jsonl.py <facts-file> <fm-output> > engine.jsonl
import json, sys
facts, fm = sys.argv[1], sys.argv[2]
fns = [l.rstrip('\n').split('\t') for l in open(facts + '.fns')]
for line in open(fm):
    p = line.split()
    if p[0] != 'FM':
        continue
    i, cc, nest, npath, loc = map(int, p[1:6])
    fn, path, s, e, parent, kind, chain = fns[i]
    assert int(fn) == i
    print(json.dumps({"tool": "engine", "path": path, "chain": chain, "name": chain.split('>')[-1],
        "kind": int(kind), "ordinal": 0, "start_line": int(s), "end_line": int(e),
        "metrics": {"cyclomatic": cc, "nesting": nest, "npath": npath, "size": loc}}))
