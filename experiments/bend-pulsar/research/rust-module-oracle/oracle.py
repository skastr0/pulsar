import sys, os, glob, collections
# usage: oracle.py <corpus root> <trees file> <target dir>
corp, trees_f, tgt = sys.argv[1:4]
mine = {}  # root -> set(files)
for line in open(trees_f):
    p = line.rstrip("\n").split("\t"); mine[p[0]] = set(p[1:])
orc = collections.defaultdict(set)  # root -> union of files from all .d with that root
for d in glob.glob(tgt + "/debug/deps/*.d"):
    for line in open(d, errors="replace"):
        if ":" not in line or line.startswith(" "): continue
        tgtname, rest = line.split(":", 1)
        files = [f.replace("\\ ", " ") for f in rest.split() if f.endswith(".rs")]
        files = [os.path.relpath(f, corp) if os.path.isabs(f) else f for f in files]
        files = [f for f in files if not f.startswith("..") and "/target/" not in f]
        if not files: continue
        # first .rs source of a .d is the crate root
        orc[files[0]] |= set(files)
roots = sorted(set(orc) & set(mine))
miss = extra = 0; exact = 0
for r in roots:
    m, o = mine[r], orc[r]
    a, b = sorted(o - m), sorted(m - o)
    if not a and not b: exact += 1
    miss += len(a); extra += len(b)
    if a: print("MISSING from my tree (rustc compiled them):", r, a[:5])
    if b: print("EXTRA in my tree (not compiled by rustc in dev/all-targets):", r, len(b), b[:3])
print(f"targets compared={len(roots)} oracle_roots={len(orc)} my_roots={len(mine)} exact={exact} missing_files={miss} extra_files={extra}")
