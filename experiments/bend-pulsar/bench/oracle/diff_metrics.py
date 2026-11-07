#!/usr/bin/env python3
"""Join oracle rows and engine rows on function identity; diff metrics.

Inputs are JSONL files. Two row shapes are understood:

Oracle rows (this directory's tools):
  {"tool": ..., "path": ..., "name": ..., "kind": ..., "chain": ...,
   "child_ordinal": N, "name_ordinal": N, "start_line": N, "end_line": N,
   "metrics": {"<tool>.<metric>": value, ...}}
  or flat metric fields (lizard rows): {"tool":"lizard", ..., "ccn": N}

Engine rows (future, from .fns + metrics facts):
  {"tool":"engine", "path": ..., "chain": ..., "name": ..., "kind": ...,
   "ordinal": N, "start_line": N, "end_line": N,
   "metrics": {"cyclomatic": N, "nesting": N, "npath": N, "size": N}}

Identity: primary key is (path, chain-or-name, kind, ordinal-ish). Because
tool naming schemes differ, joining is two-stage:
  1. exact key match on (path, normalized-name, kind, ordinal)
  2. fallback positional match on (path, start_line) when names differ
     (lizard has no chain; anonymous functions differ in naming)

Output: per-metric comparison table + counts of agreed / differed /
oracle-missing / engine-missing functions.

Usage:
  diff_metrics.py ORACLE.jsonl [ENGINE.jsonl] [--metric a=b ...]
"""
import argparse
import json
import sys
from collections import defaultdict


def load_rows(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def metrics_of(row):
    """Return {metric_name: value} merging nested and flat fields."""
    out = {}
    m = row.get("metrics")
    if isinstance(m, dict):
        out.update(m)
    for k, v in row.items():
        if k in ("tool", "path", "name", "kind", "chain", "child_ordinal",
                 "name_ordinal", "ordinal", "start_line", "end_line",
                 "join_start_line", "join_start_col", "join_end_line",
                 "join_end_col", "metrics"):
            continue
        if isinstance(v, (int, float)):
            out.setdefault(f"{row.get('tool', '?')}.{k}", v)
    return out


def ident_keys(row):
    """Candidate identity keys, most-specific first."""
    path = row.get("path")
    keys = []
    chain = row.get("chain")
    name = row.get("name") or (chain.rsplit(">", 1)[-1] if chain else None)
    kind = row.get("kind") or "?"
    ords = []
    if row.get("name_ordinal"):
        ords.append(row["name_ordinal"])
    if row.get("ordinal") is not None:
        ords.append(row["ordinal"])
    if row.get("child_ordinal") is not None:
        ords.append(row["child_ordinal"])
    ords = ords or [0]
    for o in ords:
        keys.append(("exact", path, chain or name, kind, o))
    # Positional fallbacks: the full span first — same-line nested functions
    # (arrow callbacks in one expression) collide on start_line alone — then
    # start_line for rows that lack end_line.
    keys.append(("span", path, row.get("start_line"), row.get("end_line")))
    keys.append(("line", path, row.get("start_line")))
    return keys


def canon_name(row):
    chain = row.get("chain")
    if chain:
        return chain
    name = row.get("name")
    return name if name else f"<{row.get('tool','?')}:{row.get('start_line')}>"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("oracle")
    ap.add_argument("engine", nargs="?")
    ap.add_argument("--metric", action="append", default=[],
                    help="metric pair oracle=engine (e.g. eslint.cyclomatic=cyclomatic)")
    args = ap.parse_args()

    oracle_rows = load_rows(args.oracle)
    engine_rows = load_rows(args.engine) if args.engine else []

    # --metric A=B renames metric A to B on every row, so tools with
    # different names for the same quantity (eslint.cyclomatic,
    # lizard.ccn, engine cyclomatic) compare under one canonical name.
    renames = {}
    for spec in args.metric:
        a, _, b = spec.partition("=")
        if b:
            renames[a] = b

    def apply_renames(rows):
        for r in rows:
            m = r.get("metrics")
            if isinstance(m, dict):
                for a, b in renames.items():
                    if a in m:
                        m[b] = m.pop(a)
            for a, b in renames.items():
                if a in r and isinstance(r[a], (int, float)):
                    r[b] = r.pop(a)
        return rows

    oracle_rows = apply_renames(oracle_rows)
    engine_rows = apply_renames(engine_rows)

    # Index engine rows by identity keys.
    eng_by_key = defaultdict(list)
    for r in engine_rows:
        for k in ident_keys(r):
            eng_by_key[k].append(r)

    pairs = []
    unmatched_oracle = []
    for o in oracle_rows:
        match = None
        for k in ident_keys(o):
            cands = eng_by_key.get(k)
            if not cands:
                continue
            # Span/line buckets can still hold several functions (same span,
            # or rows with no end_line); prefer the same kind.
            pick = next((i for i, c in enumerate(cands) if c.get("kind") == o.get("kind")), 0)
            match = cands.pop(pick)
            break
        if match is not None:
            pairs.append((o, match))
        else:
            unmatched_oracle.append(o)

    # Metric pairs: explicit --metric, else compare shared metric names.
    om_all = defaultdict(set)
    em_all = defaultdict(set)
    for o, _ in pairs:
        om_all[o.get("path")].update(metrics_of(o))
    for _, e in pairs:
        em_all[e.get("path")].update(metrics_of(e))

    metric_names = set()
    for s in om_all.values():
        metric_names.update(s)
    for s in em_all.values():
        metric_names.update(s)

    print(f"oracle rows: {len(oracle_rows)}  engine rows: {len(engine_rows)}")
    print(f"matched: {len(pairs)}  oracle-only: {len(unmatched_oracle)}")
    print()

    header = f"{'metric':38} {'agree':>7} {'diff':>6} {'o-only':>6} {'e-only':>6}"
    print(header)
    print("-" * len(header))
    for name in sorted(metric_names):
        agree = diff = o_only = e_only = 0
        diffs = []
        for o, e in pairs:
            ov = metrics_of(o).get(name)
            ev = metrics_of(e).get(name)
            if ov is None and ev is None:
                continue
            if ov is None:
                e_only += 1
            elif ev is None:
                o_only += 1
            elif ov == ev:
                agree += 1
            else:
                diff += 1
                if len(diffs) < 5:
                    diffs.append((canon_name(o), ov, ev))
        print(f"{name:38} {agree:>7} {diff:>6} {o_only:>6} {e_only:>6}")
        for cn, ov, ev in diffs:
            print(f"    e.g. {cn}: oracle={ov} engine={ev}")

    if unmatched_oracle:
        print(f"\noracle-only functions (first 10):")
        for o in unmatched_oracle[:10]:
            print(f"  {o.get('path')}:{o.get('start_line')} {canon_name(o)}")


if __name__ == "__main__":
    main()
