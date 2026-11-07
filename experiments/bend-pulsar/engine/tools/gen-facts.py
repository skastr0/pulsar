#!/usr/bin/env python3
"""Emit a synthetic FACTS v0 file with planted import cycles, and the output the
engine must print for it.

  gen-facts.py [--files N] [--facts M] [--seed S] --out FILE [--expect FILE]

Layout: file ids 0..N-1. A random forward graph (src < dst) is acyclic. Planted
cycles are contiguous id blocks [s, s+k) with the chain s -> s+1 -> ... -> s+k-1
plus the back edge s+k-1 -> s, so each block is exactly one strongly connected
component and nothing else is. Blocks of size 1 are import self edges.
Traps the engine must not count as edges:
  * type-only back edges (hv 0, ht 1) across the whole file range, which would
    close many cycles if the proven type-elision rule were skipped;
  * export-from self facts (form 2), which law D drops.
  * non-production files (F file 0): about 5% of ids, and "decoy" cycles of 3 to 6
    files with one non-production member, which the production-scope rule must
    not report. Edges touching a non-production file are no edges.
Duplicate (src, dst) pairs appear under different forms and flags.
The expected output is computed here, by a rule table written independently of
the engine: edge unless (hv 0, ht 1), an export-from self is no edge, and both
ends must be production files; files = production files. Cycles are the SCCs of
those edges (Tarjan, below), not just the planted blocks.
"""
import argparse
import random
import sys


def sccs(n, edges):
    """The cycles of the edge set, computed here independently of the engine
    (iterative Tarjan): every strongly connected set of two or more files, and
    every file with a self edge; members ascending, ordered by smallest member.
    Random forward edges can close a cycle through a decoy that skips its
    non-production member, so the planted blocks alone are not the answer."""
    adj = [[] for _ in range(n)]
    for s, d in edges:
        adj[s].append(d)
    index, low, on, stack, out = [None] * n, [0] * n, [False] * n, [], []
    counter = 0
    for root in range(n):
        if index[root] is not None:
            continue
        work = [(root, 0)]
        index[root] = low[root] = counter; counter += 1
        stack.append(root); on[root] = True
        while work:
            v, i = work[-1]
            if i < len(adj[v]):
                work[-1] = (v, i + 1)
                w = adj[v][i]
                if index[w] is None:
                    index[w] = low[w] = counter; counter += 1
                    stack.append(w); on[w] = True
                    work.append((w, 0))
                elif on[w]:
                    low[v] = min(low[v], index[w])
            else:
                work.pop()
                if work:
                    low[work[-1][0]] = min(low[work[-1][0]], low[v])
                if low[v] == index[v]:
                    comp = []
                    while True:
                        w = stack.pop(); on[w] = False; comp.append(w)
                        if w == v:
                            break
                    if len(comp) > 1 or (v, v) in edges:
                        out.append(sorted(comp))
    return sorted(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--files", type=int, default=20000)
    ap.add_argument("--facts", type=int, default=100000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", required=True)
    ap.add_argument("--expect")
    a = ap.parse_args()
    rnd = random.Random(a.seed)
    n = a.files

    facts = set()  # (src, dst, form, hv, ht)

    # planted cycles: sizes 1, 2, 3, ... spread over the id range
    sizes = [1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 8, 13, 21, 34, 55, 89, 144, 233]
    sizes += [rnd.randint(2, 12) for _ in range(60)]
    starts = []
    stride = n // (len(sizes) + 1)
    for i, k in enumerate(sizes):
        s = (i + 1) * stride - rnd.randint(0, max(0, stride // 4))
        starts.append((s, k))
    planted = []
    for s, k in starts:
        if s + k > n:
            continue
        planted.append((s, k))
        if k == 1:
            facts.add((s, s, 0, 1, 0))
        else:
            for i in range(s, s + k - 1):
                facts.add((i, i + 1, 0, 1, 0))
            facts.add((s + k - 1, s, rnd.choice([0, 0, 1, 2]), 1, rnd.choice([0, 1])))

    # decoy cycles with a non-production member, in ids no planted block uses
    occupied = set()
    for s0, k in planted:
        occupied.update(range(s0, s0 + k))
    nonprod = set()
    for _ in range(40):
        k = rnd.randint(3, 6)
        for _try in range(1000):
            s0 = rnd.randrange(0, n - k)
            ids = range(s0, s0 + k)
            if not any(i in occupied for i in ids):
                break
        else:
            continue
        occupied.update(ids)
        for i in range(s0, s0 + k - 1):
            facts.add((i, i + 1, 0, 1, 0))
        facts.add((s0 + k - 1, s0, 0, 1, 0))
        nonprod.add(s0 + 1)
    # random non-production files elsewhere (they still get random edges below)
    planted_ids = set()
    for s0, k in planted:
        planted_ids.update(range(s0, s0 + k))
    while len(nonprod) < n // 20:
        i = rnd.randrange(0, n)
        if i not in planted_ids:
            nonprod.add(i)

    n_trap_type = a.facts // 20
    n_trap_self = a.facts // 100
    n_forward = a.facts - len(facts) - n_trap_type - n_trap_self

    # forward value/export edges (acyclic)
    while n_forward > 0:
        s = rnd.randrange(0, n - 1)
        d = min(n - 1, s + 1 + int(rnd.expovariate(1 / 40.0)))
        if d <= s:
            continue
        form = rnd.choice([0, 0, 0, 0, 1, 2])
        hv, ht = rnd.choice([(1, 0), (1, 0), (1, 0), (1, 1), (0, 0)])
        if form == 1:
            hv, ht = 1, 0
        if (s, d, form, hv, ht) not in facts:
            facts.add((s, d, form, hv, ht))
            n_forward -= 1
    # trap: type-only back edges
    while n_trap_type > 0:
        s = rnd.randrange(1, n)
        d = rnd.randrange(0, s)
        form = rnd.choice([0, 0, 2])
        if (s, d, form, 0, 1) not in facts:
            facts.add((s, d, form, 0, 1))
            n_trap_type -= 1
    # trap: export-from self (never an edge)
    while n_trap_self > 0:
        s = rnd.randrange(0, n)
        h = rnd.choice([(1, 0), (1, 1), (0, 1), (0, 0)])
        if (s, s, 2, h[0], h[1]) not in facts:
            facts.add((s, s, 2, h[0], h[1]))
            n_trap_self -= 1

    rows = sorted(facts)
    with open(a.out, "w") as f:
        f.write("# synthetic: files=%d nonprod=%d facts=%d seed=%d planted=%d\n" % (n, len(nonprod), len(rows), a.seed, len(planted)))
        f.write("pulsar-facts 0\n")
        f.write("N %d\n" % n)
        for i in range(n):
            f.write("F %d %d\n" % (i, 0 if i in nonprod else 1))
        for i in range(n):
            f.write("K %d %d %d\n" % (i, (i * 2654435761) % 4294967296, (i * 40503) % 4294967296))
        for r in rows:
            f.write("I %d %d %d %d %d\n" % r)

    if a.expect:
        edges = set()
        for (s, d, form, hv, ht) in rows:
            if hv == 0 and ht == 1:
                continue
            if form == 2 and s == d:
                continue
            if s in nonprod or d in nonprod:
                continue
            edges.add((s, d))
        cycles = sccs(n, edges)
        with open(a.expect, "w") as f:
            f.write("pulsar-findings 0\n")
            for c in cycles:
                f.write("CYC %d %s\n" % (len(c), " ".join(str(i) for i in c)))
            f.write("CERT 1\n")
            f.write("S %d %d %d\n" % (n - len(nonprod), len(edges), len(cycles)))
    sys.stderr.write("files=%d I=%d planted=%d\n" % (n, len(rows), len(planted)))


main()
