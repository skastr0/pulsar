#!/bin/sh
# Run every available oracle over one corpus; emit <outdir>/<name>.oracle.jsonl
# files. Oracle tools must already be installed (see ORACLE.md).
#
#   run_oracle.sh <corpus-dir> <outdir> [name]
#
# Env overrides: PULSAR_ORACLE_DIR (this dir), NODE (node binary),
# LIZARD (lizard binary), PYTHON (python3).
set -eu

ORACLE_DIR=${PULSAR_ORACLE_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}
NODE=${NODE:-node}
LIZARD=${LIZARD:-lizard}
PYTHON=${PYTHON:-python3}

repo=${1:?usage: run_oracle.sh <corpus-dir> <outdir> [name]}
outdir=${2:?usage: run_oracle.sh <corpus-dir> <outdir> [name]}
name=${3:-$(basename "$repo")}
mkdir -p "$outdir"

echo "oracle: $name <- $repo"

# TypeScript: inventory + ESLint complexity/cognitive.
"$NODE" "$ORACLE_DIR/ts_oracle.mjs" --repo "$repo" \
  -o "$outdir/$name.ts.oracle.jsonl"

# Rust: lizard cyclomatic/size over tracked .rs files.
rs_files=$(git -C "$repo" ls-files '*.rs' 2>/dev/null || true)
if [ -n "$rs_files" ]; then
  (cd "$repo" && printf '%s\n' "$rs_files" | xargs "$LIZARD" --csv) \
    | "$PYTHON" "$ORACLE_DIR/lizard_dump.py" > "$outdir/$name.rs.oracle.jsonl"
fi

echo "oracle: wrote $outdir/$name.{ts,rs}.oracle.jsonl"
