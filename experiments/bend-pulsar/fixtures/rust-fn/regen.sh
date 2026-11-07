#!/bin/sh
# Regenerate the committed lcov and the CV expectation. Needs cargo-llvm-cov (pulsar-base has it):
#   bash regen.sh
# Tests live in src/lib.rs under #[cfg(test)], so they give every non-async function real
# coverage and keep the #[cfg(test)] items (which emit no FN) as unassigned lines.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cd "$here"

mkdir -p reports
cargo llvm-cov --lcov --output-path reports/lcov.info
sed -i.bak "s|SF:$here/|SF:|" reports/lcov.info && rm -f reports/lcov.info.bak
grep -m1 "^SF:" reports/lcov.info
