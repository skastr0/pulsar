#!/bin/sh
# Regenerate the committed lcov from cargo llvm-cov. Needs cargo-llvm-cov and the
# llvm-tools-preview component:
#   cargo install cargo-llvm-cov
#   ./regen.sh
# llvm-cov writes absolute SF: paths; this rewrites them to crate-relative so the committed
# report is portable. Note that llvm-cov instruments the test module too: those lines carry
# no FN span in facts (the Rust lane skips test items), so they count as unassigned lines.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

mkdir -p reports
cargo llvm-cov --lcov --output-path reports/lcov.info

python3 - "$here" <<'PY'
import sys
root = sys.argv[1]
p = f"{root}/reports/lcov.info"
s = open(p).read().replace(f"SF:{root}/", "SF:")
open(p, "w").write(s)
print("lcov rewritten to crate-relative paths")
PY
