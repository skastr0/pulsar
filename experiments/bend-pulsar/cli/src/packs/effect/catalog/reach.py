"""Textual reach of catalog entries in corpora: occurrences of `Mod.name` (or the
bare name for node:fs/child_process) in .ts/.tsx files, tracked by git, excluding
.d.ts. An approximation: it does not resolve imports."""
import os, re, sys, tomllib, collections
cat = tomllib.load(open(sys.argv[1], "rb"))
pats = {}
for e in cat["symbols"]:
    mod, path = e["sym"].split("#", 1)
    key = path if not mod.startswith("node:") else path
    pats.setdefault(key, e["class"])
rx = re.compile(r"\b(" + "|".join(re.escape(k) for k in sorted(pats, key=len, reverse=True)) + r")\b")
for root in sys.argv[2:]:
    import subprocess
    counts = collections.Counter(); files = 0
    tracked = subprocess.run(["git", "-C", root, "ls-files", "*.ts", "*.tsx"], capture_output=True, text=True).stdout.split()
    for rel in tracked:
        if rel.endswith(".d.ts") or os.path.basename(rel).startswith("._"):
            continue
        files += 1
        try: t = open(os.path.join(root, rel), encoding="utf-8", errors="ignore").read()
        except OSError: continue
        for m in rx.finditer(t): counts[pats[m.group(1)]] += 1

    print(f"{root}  ({files} files)  " + "  ".join(f"{c}={n}" for c, n in sorted(counts.items())))
