#!/usr/bin/env python3 -I
"""Diff Pulsar-Bend CLI edges against old Pulsar's edges.

usage: edgediff.py <facts> <old-edges> [-v]
  <facts>      output of `pulsar facts` (reads <facts>.paths beside it)
  <old-edges>  output of tools/edges.ts
Edge rule (FACTS.md): an I with hv=1, or hv=0 and ht=0, is an edge; a form=2 self edge is dropped.
Only edges between production files (F ... 1) are compared, since old Pulsar's graph holds only
production nodes.
"""
import sys
from collections import defaultdict

facts, old = sys.argv[1], sys.argv[2]
verbose = "-v" in sys.argv
paths = open(facts + ".paths").read().split("\n")[:-1]
prod = set()
istmts = defaultdict(list)  # (src,dst) -> [(form,hv,ht)]
for line in open(facts):
    t = line.split()
    if not t or t[0].startswith("#"):
        continue
    if t[0] == "F" and t[2] == "1":
        prod.add(int(t[1]))
    elif t[0] == "I":
        s, d, form, hv, ht = map(int, t[1:])
        istmts[(s, d)].append((form, hv, ht))
mine_nodes = {paths[i] for i in prod}
mine = set()
for (s, d), stmts in istmts.items():
    if s not in prod or d not in prod:
        continue
    for form, hv, ht in stmts:
        if form == 2 and s == d:
            continue
        if hv == 1 or (hv == 0 and ht == 0):
            mine.add((paths[s], paths[d]))
            break
old_nodes, old_edges = set(), set()
for line in open(old):
    t = line.split()
    if not t:
        continue
    if t[0] == "N":
        old_nodes.add(t[1])
    else:
        old_edges.add((t[1], t[2]))
print(f"nodes: mine={len(mine_nodes)} old={len(old_nodes)} common={len(mine_nodes & old_nodes)} "
      f"only-mine={len(mine_nodes - old_nodes)} only-old={len(old_nodes - mine_nodes)}")
print(f"edges: mine={len(mine)} old={len(old_edges)} common={len(mine & old_edges)} "
      f"only-mine={len(mine - old_edges)} only-old={len(old_edges - mine)}")
if verbose:
    idx = {p: i for i, p in enumerate(paths)}
    for p in sorted(mine_nodes - old_nodes):
        print("NODE only-mine", p)
    for p in sorted(old_nodes - mine_nodes):
        print("NODE only-old ", p, "(in file set)" if p in idx else "(not in my file set)")
    for e in sorted(mine - old_edges):
        print("EDGE only-mine", e[0], "->", e[1], istmts[(idx[e[0]], idx[e[1]])])
    for e in sorted(old_edges - mine):
        print("EDGE only-old ", e[0], "->", e[1],
              istmts.get((idx.get(e[0], -1), idx.get(e[1], -1)), "no I fact"))

# --- classification of differences -------------------------------------------------------------
def stem(p):
    for e in (".tsx", ".ts", ".mts", ".cts"):
        if p.endswith(e):
            return p[: -len(e)]
    return p

only_mine = mine - old_edges
only_old = old_edges - mine
cls = defaultdict(list)
old_by_src = defaultdict(set)
for s_, d_ in only_old:
    old_by_src[s_].add(d_)
mine_by_dst_collision = set()
for s_, d_ in sorted(only_old):
    # old picked dir/index.ts; a sibling dir.ts exists and mine picked it (TypeScript's file-first order)
    if d_.rsplit("/", 1)[-1].startswith("index.") :
        base = d_.rsplit("/", 1)[0]
        for cand in (base + ".ts", base + ".tsx"):
            if (s_, cand) in only_mine:
                cls["B: file-vs-directory collision (a.ts vs a/index.ts)"].append((s_, d_, cand))
                mine_by_dst_collision.add((s_, cand))
                break
        else:
            cls["UNEXPLAINED only-old"].append((s_, d_))
    else:
        cls["UNEXPLAINED only-old"].append((s_, d_))
for s_, d_ in sorted(only_mine):
    if (s_, d_) in mine_by_dst_collision:
        continue
    if s_ not in old_nodes or d_ not in old_nodes:
        cls["A: endpoint not in old node set (file outside any tsconfig include)"].append((s_, d_))
    else:
        cls["C: other only-mine (check with heritage-probe)"].append((s_, d_))
print()
for k in sorted(cls):
    v = cls[k]
    print(f"{k}: {len(v)}")
    for x in v[:3]:
        print("    e.g.", " -> ".join(map(str, x[:2])), x[2] if len(x) > 2 else "")
if "-s" in sys.argv:
    print("C sources:", " ".join(sorted({a for a, _ in cls["C: other only-mine (check with heritage-probe)"]})))
