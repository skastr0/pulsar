#!/usr/bin/env python3
"""Reachability and law coverage over a Bend tree (#702 audit).

usage: reach.py <bend-pulsar dir> <entry module relative to it> <out.tsv>

A module's defs are its top-level `def` blocks; a law is a top-level `law` block. A reference
is a dotted identifier that names a def of the same module, or `Alias.rest` where Alias is an
import and `rest` a def of that module. Base (the prelude) is not followed. Law files and
proof files are read for law statements only; the defs they hold that are not laws are spec
helpers, and a law statement's references are expanded through them.

Per reachable def it prints:
  named   laws whose statement names the def (directly or through a spec helper)
  via     laws that name some reachable caller of the def (so the def is under that law's
          statement, to the extent the law constrains the caller's output)
"""
import os, re, sys
from collections import defaultdict, deque

root, entry, out = sys.argv[1], sys.argv[2], sys.argv[3]
IMP = re.compile(r'^import\s+(\S+\.bend)\s+as\s+(\w+)')
TOP = re.compile(r'^(def|law)\s+([A-Za-z_][\w.]*[?]?)')
IDENT = re.compile(r'(?<![\w.])([A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)*)')

mods = {}  # path -> {"imports": {alias: path}, "defs": {name: body}, "laws": {name: body}}

def load(path):
    path = os.path.normpath(path)
    if path in mods:
        return path
    m = {"imports": {}, "defs": {}, "laws": {}, "line": {}, "unproven_from": None, "joined_at": None}
    mods[path] = m
    cur = None
    for no, line in enumerate(open(path), 1):
        if line.startswith("# ---- decoding rows (reader; unproven)"):
            m["unproven_from"] = no
        if line.startswith("# ---- the joined output"):
            m["joined_at"] = no
        im = IMP.match(line)
        if im:
            m["imports"][im.group(2)] = os.path.normpath(os.path.join(os.path.dirname(path), im.group(1)))
            continue
        t = TOP.match(line)
        if t:
            cur = (t.group(1), t.group(2))
            m["line"].setdefault(cur[1], no)
            m["defs" if cur[0] == "def" else "laws"].setdefault(cur[1], "")
            m["defs" if cur[0] == "def" else "laws"][cur[1]] += line
            continue
        if line.strip() and not line.startswith((" ", "\t", "#")):
            cur = None  # a type or other top-level form ends the block
        if cur and not line.lstrip().startswith("#"):
            m["defs" if cur[0] == "def" else "laws"][cur[1]] += line
    for p in list(m["imports"].values()):
        if os.path.exists(p):
            load(p)
    return path

def refs(path, body, skip=None):
    m = mods[path]
    res = set()
    for tok in IDENT.findall(body):
        if tok == skip:
            continue
        if tok in m["defs"]:
            res.add((path, tok))
            continue
        a, _, rest = tok.partition(".")
        if rest and a in m["imports"]:
            q = m["imports"][a]
            if q in mods and rest in mods[q]["defs"]:
                res.add((q, rest))
    return res

ent = load(os.path.join(root, entry))
# load every law/proof file in the tree so their statements are seen
for d in (root, os.path.join(root, "engine")):
    for f in sorted(os.listdir(d)):
        if f.endswith(("-LAWS.bend", "LAWS.bend", "-PROOF.bend")) or f == "PROOF.bend":
            load(os.path.join(d, f))

def is_spec(path):
    return path.endswith("LAWS.bend") or path.endswith("PROOF.bend")

# call graph over code defs
calls = defaultdict(set)
for p, m in mods.items():
    for n, b in m["defs"].items():
        calls[(p, n)] = refs(p, b, skip=None) - {(p, n)}

start = (ent, "main")
seen, q = {start}, deque([start])
while q:
    u = q.popleft()
    for v in calls[u]:
        if not is_spec(v[0]) and v not in seen:
            seen.add(v); q.append(v)

# law statements -> named code defs (through spec helpers)
def expand(p, body):
    out, stack, done = set(), list(refs(p, body)), set()
    while stack:
        x = stack.pop()
        if x in done:
            continue
        done.add(x)
        if is_spec(x[0]):
            stack.extend(refs(x[0], mods[x[0]]["defs"][x[1]], skip=x[1]))
        else:
            out.add(x)
    return out

named = defaultdict(set)
for p, m in mods.items():
    for n, b in m["laws"].items():
        tag = f"{os.path.basename(p)}:{n}"
        for x in expand(p, b):
            named[x].add(tag)

# via: laws naming a reachable ancestor
parents = defaultdict(set)
for u in seen:
    for v in calls[u]:
        if v in seen:
            parents[v].add(u)
via = {}
for f in seen:
    acc, st, vis = set(), [f], {f}
    while st:
        x = st.pop()
        for y in parents[x]:
            if y not in vis:
                vis.add(y); st.append(y); acc |= named[y]
    via[f] = acc

rel = lambda p: os.path.relpath(p, root)

# The engine's own list of what is tested, not proven (engine/LAWS.bend:10-23, main.bend:6-10,
# MetricsIn-LAWS.bend:12-15). It overrides "named" and "via": a law may mention such a def
# without constraining it (In.ops is named by glue_runs_metrics, as a term).
ROWS = {"Scope.go", "Facts.close_n", "Scope.count"}
def status(f):
    p, n = f; m = mods[p]; b = os.path.basename(p); ln = m["line"].get(n, 0)
    if b in ("Parse.bend", "Rows.bend"):
        return "tested", "reader (engine/LAWS.bend:10-11, 21-22)"
    if m["unproven_from"] and ln > m["unproven_from"]:
        return "tested", "decoder (engine/LAWS.bend:21-22)"
    if b == "MetricsIn.bend" and m["joined_at"] and ln < m["joined_at"]:
        return "tested", "decoder (MetricsIn-LAWS.bend:12-15)"
    if n in ROWS:
        return "tested", "row grouping / file count (engine/LAWS.bend:13-20)"
    if b == "main.bend":
        return "effects", "IO only (main.bend:1-12)"
    if named[f]:
        return "proven", " ".join(sorted(named[f]))
    if via[f]:
        return "under-law", "only through a caller; e.g. " + sorted(via[f])[0]
    return "neither", ""
with open(out, "w") as o:
    o.write("module\tdef\tstatus\tlaws_or_note\n")
    for f in sorted(seen, key=lambda x: (rel(x[0]), x[1])):
        st, note = status(f)
        o.write(f"{rel(f[0])}\t{f[1]}\t{st}\t{note}\n")
print(len(seen), "reachable defs;", sum(1 for f in seen if named[f]), "named by a law;",
      sum(1 for f in seen if not named[f] and via[f]), "only via a caller;",
      sum(1 for f in seen if not named[f] and not via[f]), "under no law")
