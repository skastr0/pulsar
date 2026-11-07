#!/bin/bash
# `pulsar delta` self-test: builds a throwaway repo with an acyclic commit, a commit that adds an
# import cycle, and a commit that breaks it, then checks findings and exit codes.
# Usage: bash tools/delta-selftest.sh [pulsar-binary]   (needs PULSAR_ENGINE or an engine beside the binary)
set -uo pipefail
BIN=$(cd "$(dirname "${1:-$(dirname "$0")/../target/release/pulsar}")" && pwd)/$(basename "${1:-pulsar}")
T=$(mktemp -d); trap 'rm -rf "$T"' EXIT; cd "$T"
git init -q . && git config user.email t@t && git config user.name t
echo 'export const a = 1' > a.ts
echo 'import {a} from "./a"; export const b = a' > b.ts
git add -A && git commit -qm acyclic
echo 'import {b} from "./b"; export const a = b' > a.ts && git commit -qam cycle
echo 'export const a = 1' > a.ts && git commit -qam broken
echo 'import {b} from "./b"; export const a = b' > a.ts
mkdir -p .pulsar
cat > .pulsar/decisions.toml <<'D'
format = "pulsar-decisions 0"
allow = [
  { key = "78c5bd807667298b", rule = "graph.import-cycle", reason = "legacy pair, tracked in #12" },
]
D
git add -A && git commit -qm "cycle again, allowed by decision"
# A function whose cyclomatic complexity is 13 (twelve ifs), added in its own commit.
python3 - <<'PY' > m.ts
print("export function tangled(x: number): number {\n  let r = 0")
for i in range(12):
    print(f"  if (x > {i}) r += {i}")
print("  return r\n}")
PY
git add -A && git commit -qm "add a tangled function"
fail=0
check() { # check "<label>" "<expected exit>" "<expected summary fragment>" args...
  local label=$1 want=$2 frag=$3; shift 3
  out=$("$BIN" delta "$@" --repo . 2>/dev/null); code=$?
  if [ "$code" == "$want" ] && grep -q -F "$frag" <<<"$out"; then echo "ok   $label"; else echo "FAIL $label (exit $code, want $want)"; echo "$out" | tail -3; fail=1; fi
}
check "cycle added: exit 1"       1 "added=1 allowed=0 removed=0" HEAD~4 HEAD~3
check "cycle removed: exit 0"     0 "added=0 allowed=0 removed=1" HEAD~3 HEAD~2
check "net zero: exit 0"          0 "added=0 allowed=0 removed=0 unchanged=0" HEAD~4 HEAD~2
check "same sha: exit 0"          0 "added=0 allowed=0 removed=0" HEAD HEAD
check "allowed by a committed decision: exit 0" 0 "added=0 allowed=1 removed=0" HEAD~2 HEAD~1
check "metric findings added (cyclomatic and npath): exit 1" 1 "added=2 allowed=0 removed=0" HEAD~1 HEAD
out=$("$BIN" delta HEAD~1 HEAD --repo . 2>/dev/null)
grep -q '^+ core.cyclomatic [0-9a-f]* m.ts tangled  cyclomatic 13 over 10' <<<"$out" && echo "ok   metric rendering names rule, file, symbol and evidence" || { echo "FAIL metric rendering"; echo "$out" | head -3; fail=1; }
out=$("$BIN" delta HEAD~4 HEAD~3 --repo . --json 2>/dev/null)
grep -q '"change":"added".*"rule":"graph.import-cycle"' <<<"$out" && echo "ok   json line" || { echo "FAIL json line"; fail=1; }
a=$("$BIN" delta HEAD~4 HEAD~3 --repo . 2>/dev/null | grep -o '^+ [^ ]* [0-9a-f]*'); b=$("$BIN" delta HEAD~4 HEAD~3 --repo . 2>/dev/null | grep -o '^+ [^ ]* [0-9a-f]*')
[ -n "$a" ] && [ "$a" == "$b" ] && echo "ok   key stable across runs ($a)" || { echo "FAIL key stable"; fail=1; }
"$BIN" delta nope HEAD --repo . >/dev/null 2>&1; [ $? == 2 ] && echo "ok   bad rev: exit 2" || { echo "FAIL bad rev"; fail=1; }
[ -z "$(ls -d /tmp/pulsar-delta-* 2>/dev/null)" ] && echo "ok   scratch removed" || { echo "FAIL scratch left behind"; fail=1; }
exit $fail
