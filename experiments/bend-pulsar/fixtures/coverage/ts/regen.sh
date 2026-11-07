#!/bin/sh
# Regenerate the committed golden reports in reports/. Needs the fixture's node_modules:
#   bun install
# Then: ./regen.sh
# Vitest writes absolute paths; this rewrites them to fixture-relative so the reports are
# portable and the committed expectation means the same thing on any machine.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

[ -x node_modules/.bin/vitest ] || { echo "run bun install in $here first" >&2; exit 1; }

node_modules/.bin/vitest run --coverage
node_modules/.bin/vitest run --coverage --config vitest.istanbul.config.ts

python3 - "$here" <<'PY'
import json, os, sys
root = sys.argv[1]
for src, dst in (("coverage", "reports/v8"), ("coverage-istanbul", "reports/istanbul")):
    os.makedirs(os.path.join(root, dst), exist_ok=True)
    entries = json.load(open(os.path.join(root, src, "coverage-final.json")))
    out = {}
    for key, value in sorted(entries.items()):
        assert key.startswith(root + "/"), key
        rel = key[len(root) + 1:]
        if "path" in value:
            value["path"] = rel
        out[rel] = value
    with open(os.path.join(root, dst, "coverage-final.json"), "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    with open(os.path.join(root, src, "lcov.info")) as f:
        lcov = f.read()
    with open(os.path.join(root, dst, "lcov.info"), "w") as f:
        f.write(lcov)
print("reports rewritten to fixture-relative paths")
PY
