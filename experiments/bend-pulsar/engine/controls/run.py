#!/usr/bin/env python3
# Negative controls: apply each bug to a scratch copy of the module, run the
# gate on that copy, and require it to fail. Usage: run.py <controls.json> <module.bend> <proof.bend>
# A control may name its own "file" (relative to the module's directory) to mutate instead.
# Exits 1 if any pattern does not occur exactly once (checked first) or any mutant passes.
import json, os, shutil, subprocess, sys, tempfile
spec, mod, proof = sys.argv[1], sys.argv[2], sys.argv[3]
here = os.path.dirname(os.path.abspath(mod))
cs = json.load(open(spec))
# A control whose pattern does not occur exactly once tests nothing, so check
# every pattern before running any gate and refuse the whole run if one is off.
stale = 0
for c in cs:
    rel = c.get("file", os.path.basename(mod))
    n = open(os.path.join(here, rel)).read().count(c["old"])
    if n != 1:
        print(f"STALE {c['law']}: pattern occurs {n} times in {rel}, must be 1"); stale += 1
if stale:
    print(f"controls refused: {stale} stale pattern(s), no gate run")
    sys.exit(1)
bad = 0
for c in cs:
    rel = c.get("file", os.path.basename(mod))
    src = open(os.path.join(here, rel)).read()
    tmp = tempfile.mkdtemp()
    shutil.copytree(os.path.dirname(here), tmp, dirs_exist_ok=True)
    eng = os.path.join(tmp, os.path.basename(here))
    open(os.path.join(eng, rel), "w").write(src.replace(c["old"], c["new"]))
    r = subprocess.run(["bend", proof, "--verdict"], cwd=eng, capture_output=True, text=True)
    out = r.stdout + r.stderr
    loc = next((l.strip() for l in out.splitlines() if l.startswith("Location:")), "-")
    ok = r.returncode != 0 and "ALL PROOFS CHECK" not in out
    print(f"{'FAILS' if ok else 'PASSES!'} exit={r.returncode} {c['law']}: {c['bug']} [{loc}]")
    bad += 0 if ok else 1
    shutil.rmtree(tmp)
print("controls", "ok" if bad == 0 else f"{bad} did not fail")
sys.exit(1 if bad else 0)
