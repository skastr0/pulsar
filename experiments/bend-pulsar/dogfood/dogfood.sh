#!/usr/bin/env bash
# Dogfood: run Pulsar on the Pulsar repo itself (#678).
#
#   dogfood.sh delta <base> <head> [--repo dir]   findings added/removed between two shas
#   dogfood.sh snapshot [--repo dir]              findings on the current worktree (pulsar cycles)
#
# Coverage is generated first so CV facts exist when the coverage lane lands:
#   cargo llvm-cov --lcov in cli/, `bun test --coverage-reporter=lcov` for TS.
# Both are best-effort: a missing tool or failing suite is a warning, not a
# stop — no-data coverage is a real finding, not something to paper over.
#
# Output: experiments/bend-pulsar/dogfood/<sha>.txt — sorted findings plus a
# short summary. Exit code mirrors `pulsar delta`: 0 no findings added,
# 1 findings added, 2 error.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)          # experiments/bend-pulsar/dogfood
EXP=$(cd "$HERE/.." && pwd)                  # experiments/bend-pulsar
REPO=$(cd "$EXP/../.." && pwd)               # pulsar checkout
CLI=${PULSAR_CLI:-$EXP/cli/target/release/pulsar}
OUTDIR=$HERE
MODE=""
BASE=""
HEAD=""

while [ $# -gt 0 ]; do
  case "$1" in
    delta) MODE=delta; BASE=${2:?base sha}; HEAD=${3:?head sha}; shift 3 ;;
    snapshot) MODE=snapshot; shift ;;
    --repo) REPO=$(cd "$2" && pwd); shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "dogfood.sh: unknown arg $1" >&2; exit 2 ;;
  esac
done
[ -n "$MODE" ] || { echo "usage: dogfood.sh delta <base> <head> | snapshot [--repo dir]" >&2; exit 2; }
[ -x "$CLI" ] || { echo "dogfood.sh: no CLI at $CLI (build cli/ or set PULSAR_CLI)" >&2; exit 2; }

warn() { echo "dogfood: WARN $*" >&2; }

# `timeout` is GNU; macOS has gtimeout (coreutils) or nothing. Fall back to
# running uncapped rather than failing the coverage step outright.
TIMEOUT=""
for t in timeout gtimeout; do command -v "$t" >/dev/null 2>&1 && TIMEOUT=$t && break; done
cap() { if [ -n "$TIMEOUT" ]; then "$TIMEOUT" 600 "$@"; else "$@"; fi; }

# --- coverage first (CV facts attach at facts time) -------------------------
# Each step is time-capped: coverage is best-effort and must never block
# the findings run (observed: `bun test` on the legacy suite can hang for
# many minutes on a VM without node_modules).
if command -v cargo >/dev/null 2>&1 && [ -d "$REPO/experiments/bend-pulsar/cli" ]; then
  (cd "$REPO/experiments/bend-pulsar/cli" && \
    cap cargo llvm-cov --lcov --output-path "$REPO/experiments/bend-pulsar/coverage/lcov.info" \
    >/dev/null 2>&1) || warn "cargo llvm-cov failed, absent or >600s — cli coverage is no-data"
fi
if command -v bun >/dev/null 2>&1 && [ -f "$REPO/package.json" ]; then
  (cd "$REPO" && cap bun test --coverage-reporter=lcov >/dev/null 2>&1) \
    || warn "bun test coverage failed or >600s — TS coverage is no-data"
fi

sha_of() { git -C "$REPO" rev-parse "$1" 2>/dev/null || echo "$1"; }
POLICY=$("$CLI" policy --repo "$REPO" 2>/dev/null | tail -1 || echo "policy: unavailable")

report() { # $1=sha $2=title $3=body-file
  local sha=$1 title=$2 body=$3 out="$OUTDIR/$1.txt"
  {
    echo "# dogfood $title — $sha"
    echo "# repo: $REPO"
    echo "# $(date -u +%Y-%m-%dT%H:%M:%SZ)  $POLICY"
    echo "#"
    cat "$body"
  } > "$out"
  echo "dogfood: wrote $out"
}

if [ "$MODE" = delta ]; then
  B=$(sha_of "$BASE"); H=$(sha_of "$HEAD")
  JSONL=$(mktemp /tmp/dogfood-delta.XXXXXX.jsonl)
  set +e
  "$CLI" delta "$B" "$H" --repo "$REPO" --json > "$JSONL"
  rc=$?
  set -e
  # Findings added, sorted by (rule, file, key); removed listed after.
  python3 - "$JSONL" "$rc" <<'PY' > /tmp/dogfood-body.$$
import json, sys
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
summ = [r for r in rows if r.get("type") == "summary"]
finds = [r for r in rows if r.get("type") == "finding"]
added = sorted((r for r in finds if r.get("change") == "added"),
               key=lambda r: (r["rule"], r["file"], r["key"]))
removed = sorted((r for r in finds if r.get("change") == "removed"),
                 key=lambda r: (r["rule"], r["file"], r["key"]))
if summ:
    s = summ[-1]
    print(f"# base={s['base'][:12]} head={s['head'][:12]} added={s['added']} removed={s['removed']} unchanged={s['unchanged']}")
else:
    print(f"# delta exit={sys.argv[2]} (no summary line)")
print()
for r in added:
    sym = f" {r['symbol']}" if r.get("symbol") else ""
    print(f"+ {r['rule']} {r['key']} {r['file']}{sym}")
print()
for r in removed:
    sym = f" {r['symbol']}" if r.get("symbol") else ""
    print(f"- {r['rule']} {r['key']} {r['file']}{sym}  (removed)")
PY
  BODY=/tmp/dogfood-body.$$
  report "$H" "delta $B $H" "$BODY"
  rm -f "$JSONL" "$BODY"
  exit "$rc"
fi

# snapshot mode: cycles on the worktree (full findings once the engine prints them)
H=$(sha_of HEAD)
ENGINE=${PULSAR_ENGINE:-$EXP/engine/pulsar-engine}
OUT=$(mktemp /tmp/dogfood-cycles.XXXXXX.txt)
set +e
"$CLI" cycles "$REPO" > "$OUT" 2>/tmp/dogfood-cycles.err
rc=$?
set -e
# Until the CLI renders FM/FX itself, fall back to facts + engine binary
# directly (lead ruling: first dogfood run reads engine output directly).
if [ $rc -ne 0 ] || grep -q "unknown engine line tag" /tmp/dogfood-cycles.err; then
  if [ -x "$ENGINE" ]; then
    warn "pulsar cycles cannot parse engine output yet — using facts + $ENGINE directly"
    FACTS=$(mktemp /tmp/dogfood-self.XXXXXX.facts)
    "$CLI" facts "$REPO" -o "$FACTS" >/dev/null 2>&1
    "$ENGINE" "$FACTS" > "$OUT" 2>>/tmp/dogfood-cycles.err
    rc=$?
    rm -f "$FACTS" "$FACTS.paths" "$FACTS.fns" "$FACTS.syms"
  fi
fi
{
  echo "# snapshot findings at $H (worktree)"
  echo "# stderr: $(tail -1 /tmp/dogfood-cycles.err)"
  echo "#"
  cat "$OUT"
} > /tmp/dogfood-body.$$
report "$H" "snapshot" /tmp/dogfood-body.$$
rm -f "$OUT" /tmp/dogfood-body.$$ /tmp/dogfood-cycles.err
exit "$rc"
