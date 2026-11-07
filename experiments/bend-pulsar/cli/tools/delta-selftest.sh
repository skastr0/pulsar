#!/bin/bash
# `pulsar delta` self-test: builds a throwaway repo with an acyclic commit, a commit that adds an
# import cycle, and a commit that breaks it, then checks findings and exit codes.
# Usage: bash tools/delta-selftest.sh [pulsar-binary]   (needs PULSAR_ENGINE or an engine beside the binary)
set -uo pipefail
BIN=$(cd "$(dirname "${1:-$(dirname "$0")/../target/release/pulsar}")" && pwd)/$(basename "${1:-pulsar}")
# The scripted engines below stand in for one section each; the delta section (a `KD` row) always
# runs on the real engine, which they hand such a facts file to.
REAL=${PULSAR_ENGINE:-}
for d in "$(dirname "$BIN")"/.. "$(dirname "$BIN")"/../.. "$(dirname "$BIN")"/../../..; do
  [ -z "$REAL" ] && [ -x "$d/engine/pulsar-engine" ] && REAL=$(cd "$d/engine" && pwd)/pulsar-engine
done
T=$(mktemp -d); K=$(mktemp -d); export PULSAR_CACHE_DIR="$K"; trap 'rm -rf "$T" "$K"' EXIT; cd "$T"
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
grep -q '^+ core.cyclomatic [0-9a-f]* m.ts:1 tangled  cyclomatic 13 > 10 \[cyclomatic 13 .*\] (rule v3)$' <<<"$out" && echo "ok   metric rendering: rule, key, path:line, symbol, value > threshold, rule version" || { echo "FAIL metric rendering"; echo "$out" | head -3; fail=1; }
out=$("$BIN" delta HEAD~4 HEAD~3 --repo . --json 2>/dev/null)
grep -q '"change":"added".*"rule":"graph.import-cycle"' <<<"$out" && echo "ok   json line" || { echo "FAIL json line"; fail=1; }
a=$("$BIN" delta HEAD~4 HEAD~3 --repo . 2>/dev/null | grep -o '^+ [^ ]* [0-9a-f]*'); b=$("$BIN" delta HEAD~4 HEAD~3 --repo . 2>/dev/null | grep -o '^+ [^ ]* [0-9a-f]*')
[ -n "$a" ] && [ "$a" == "$b" ] && echo "ok   key stable across runs ($a)" || { echo "FAIL key stable"; fail=1; }
"$BIN" delta nope HEAD --repo . >/dev/null 2>&1; [ $? == 2 ] && echo "ok   bad rev: exit 2" || { echo "FAIL bad rev"; fail=1; }
[ -z "$(ls -d /tmp/pulsar-delta-* 2>/dev/null)" ] && echo "ok   scratch removed" || { echo "FAIL scratch left behind"; fail=1; }
# --coverage reads the report from the worktree (not the scratch checkout) and is an error if missing.
printf 'SF:m.ts\nDA:2,0\nDA:3,1\nend_of_record\n' > "$T/lcov.info"
err=$("$BIN" delta HEAD~1 HEAD --repo . --coverage "$T/lcov.info" 2>&1 >/dev/null)
grep -q 'coverage reports=1' <<<"$err" && echo "ok   --coverage reads the worktree report" || { echo "FAIL --coverage"; echo "$err" | tail -3; fail=1; }
"$BIN" delta HEAD~1 HEAD --repo . --coverage "$T/none.info" >/dev/null 2>&1; [ $? == 2 ] && echo "ok   missing --coverage path: exit 2" || { echo "FAIL missing coverage path"; fail=1; }
# Without the flag, head finds the report at the repo root (as `pulsar facts` does) and names it on
# stderr; base never does. With no report there, it says none was found. A run that reads coverage
# is never cached.
err=$("$BIN" delta HEAD~1 HEAD --repo . 2>&1 >/dev/null)
grep -q 'coverage read lcov.info' <<<"$err" && grep -q 'head .* cache=off' <<<"$err" && grep -q 'base .* cache=\(hit\|miss\)' <<<"$err" && echo "ok   head discovers a root report, names it, skips the cache; base does not" || { echo "FAIL coverage discovery"; echo "$err" | tail -4; fail=1; }
rm -f "$T/lcov.info"
err=$("$BIN" delta HEAD~1 HEAD --repo . 2>&1 >/dev/null)
grep -q 'coverage none found at the repo root' <<<"$err" && echo "ok   no report at the root: says so" || { echo "FAIL coverage none found"; echo "$err" | tail -3; fail=1; }

# Trend lines: the same function with a larger measured value is `~ worsened`, the reverse `~ improved`
# (measurement only: never counted in `added`, never exit 1).
python3 - <<'PY' > m.ts
print("export function tangled(x: number): number {\n  let r = 0")
for i in range(13):
    print(f"  if (x > {i}) r += {i}")
print("  return r\n}")
PY
git add -A && git commit -qm "one more branch"
out=$("$BIN" delta HEAD~1 HEAD --repo . 2>/dev/null); code=$?
grep -q '^~ worsened [0-9a-f]* m.ts:1 tangled  cyclomatic 13 -> 14' <<<"$out" && grep -q 'worsened=1 improved=0' <<<"$out" && echo "ok   worsened: same key, value grew, old -> new" || { echo "FAIL worsened"; echo "$out" | head -4; fail=1; }
[ "$code" == 0 ] && echo "ok   a trend is not a finding: exit 0" || { echo "FAIL trend changed the exit code ($code)"; fail=1; }
out=$("$BIN" delta HEAD HEAD~1 --repo . 2>/dev/null)
grep -q '^~ improved [0-9a-f]* m.ts:1 tangled  cyclomatic 14 -> 13' <<<"$out" && echo "ok   improved: reverse direction" || { echo "FAIL improved"; fail=1; }
tj=$("$BIN" delta HEAD~1 HEAD --repo . --json 2>/dev/null | grep '"type":"trend"')
grep -q '"change":"worsened"' <<<"$tj" && grep -q '"cyclomatic":{"old":13,"new":14}' <<<"$tj" && echo "ok   trend JSON carries old and new" || { echo "FAIL trend json"; echo "$tj" | head -2; fail=1; }

# A Rust manifest cargo cannot read degrades the Rust graph: every output form must say so.
D=$(mktemp -d); trap 'rm -rf "$T" "$K" "$D"' EXIT
( cd "$D" && git init -q . && git config user.email t@t && git config user.name t
  echo 'x' > README.md && git add -A && git commit -qm base
  printf 'this is not toml [[[\n' > Cargo.toml; mkdir -p src; echo 'pub fn f() {}' > src/lib.rs
  git add -A && git commit -qm "broken manifest" )
out=$("$BIN" delta HEAD~1 HEAD --repo "$D" 2>/dev/null)
grep -q '^! DEGRADED INPUT (head) rust: ' <<<"$out" && grep -q 'degraded=1 coverage=0 ' <<<"$out" && echo "ok   degraded input marked in text" || { echo "FAIL degraded text"; echo "$out" | head -3; fail=1; }
out=$("$BIN" delta HEAD~1 HEAD --repo "$D" --json 2>/dev/null)
grep -q '"type":"degraded","side":"head","lane":"rust"' <<<"$out" && grep -q '"degraded":1' <<<"$out" && echo "ok   degraded input marked in JSON" || { echo "FAIL degraded json"; fail=1; }
"$BIN" facts "$D" -o "$D/f.txt" 2>/dev/null; grep -q '^# degraded rust: ' "$D/f.txt" && echo "ok   degraded input noted in the facts header" || { echo "FAIL degraded facts header"; fail=1; }
# Class-in-context: an ambient read inside Effect code is a finding of the Effect pack's rule, the
# same call outside Effect code is not (classification alone never makes a finding).
E=$(mktemp -d); trap 'rm -rf "$T" "$K" "$D" "$E"' EXIT
( cd "$E" && git init -q . && git config user.email t@t && git config user.name t
  echo base > README.md && git add -A && git commit -qm base
  echo '{"dependencies":{"effect":"*"}}' > package.json
  cat > a.ts <<'TS'
import { Effect } from "effect"
export const f = Effect.gen(function* () {
  const t = Date.now()
  const u = Date.now()
  return t + u
})
export const g = () => Date.now()
TS
  git add -A && git commit -qm "effect code" )
out=$("$BIN" delta HEAD~1 HEAD --repo "$E" 2>/dev/null)
grep -q '^+ effect.ambient-read-in-effect [0-9a-f]* a.ts:2 f  .*global#Date.now (x2) (rule v1)$' <<<"$out" && echo "ok   class-in-context: Date.now x2 inside Effect.gen is one finding for f" || { echo "FAIL class-in-context"; echo "$out" | head -3; fail=1; }
[ "$(grep -c '^[-+~] effect.ambient-read-in-effect' <<<"$out")" == 1 ] && echo "ok   the same call outside Effect code is not a finding" || { echo "FAIL outside-Effect call reported"; fail=1; }
grep -q '^# metric effect.ambient-read-in-effect call sites: base=off head=2$' <<<"$out" && echo "ok   the rule's call-site count at head is a metric line (2 sites; off at base, which has no Effect dependency)" || { echo "FAIL rule count metric"; grep '^# metric' <<<"$out"; fail=1; }
# The ~/.pulsar cache: a second run on unchanged shas reads derived entries instead of parsing, and
# prints the same result; --no-cache bypasses it.
"$BIN" delta HEAD~1 HEAD --repo . >/dev/null 2>&1   # warm
cold=$("$BIN" delta HEAD~2 HEAD~1 --repo . --no-cache 2>"$K/e0.txt"); warm=$("$BIN" delta HEAD~2 HEAD~1 --repo . 2>"$K/e1.txt")
"$BIN" delta HEAD~2 HEAD~1 --repo . >/dev/null 2>"$K/e2.txt"
[ "$cold" == "$warm" ] && echo "ok   cached result equals the recomputed one" || { echo "FAIL cache changed the result"; fail=1; }
grep -q 'cache=off' "$K/e0.txt" && echo "ok   --no-cache bypasses the cache" || { echo "FAIL --no-cache"; fail=1; }
grep -q "base .* cache=hit" "$K/e2.txt" && grep -q 'head .* cache=hit' "$K/e2.txt" && echo "ok   second run: both shas hit the cache" || { echo "FAIL no cache hit"; cat "$K/e2.txt" | tail -3; fail=1; }

# Renames: delta follows git renames, so a moved file or directory is not a removal plus an addition.
R=$(mktemp -d); trap 'rm -rf "$T" "$K" "$D" "$E" "$R"' EXIT
tangled() { # tangled <ifs>: a function whose cyclomatic complexity is <ifs>+1
  echo "export function tangled(x: number): number {"; echo "  let r = 0"
  for i in $(seq 1 "$1"); do echo "  if (x > $i) r += $i"; done
  echo "  return r"; echo "}"
}
( cd "$R" && git init -q . && git config user.email t@t && git config user.name t
  tangled 13 > m.ts && echo 'export const a = 1' > a.ts && git add -A && git commit -qm base
  git mv m.ts n.ts && git commit -qm "rename a file"
  mkdir sub && git mv n.ts sub/n.ts && git commit -qm "move into a directory"
  git mv sub/n.ts sub/o.ts && tangled 14 > sub/o.ts && git add -A && git commit -qm "rename and edit"
  echo 'export const x = 1' > sub/o.ts && tangled 14 > p.ts && git add -A && git commit -qm "move the function to another file" )
rcheck() { # rcheck "<label>" "<summary fragment>" <base> <head>
  local label=$1 frag=$2; shift 2
  out=$("$BIN" delta "$1" "$2" --repo "$R" 2>/dev/null)
  grep -q -F "$frag" <<<"$out" && echo "ok   $label" || { echo "FAIL $label"; echo "$out" | tail -3; fail=1; }
}
rcheck "a renamed file keeps its findings"          "added=0 allowed=0 removed=0 unchanged=2" HEAD~4 HEAD~3
rcheck "...and says so in the header"               "renamed_files=1 renamed_findings=2 unmatched_moves=0" HEAD~4 HEAD~3
rcheck "a directory move keeps its findings"        "added=0 allowed=0 removed=0 unchanged=2" HEAD~3 HEAD~2
rcheck "a rename plus an edit matches the findings" "renamed_files=1 renamed_findings=2" HEAD~2 HEAD~1
out=$("$BIN" delta HEAD~2 HEAD~1 --repo "$R" 2>/dev/null)
grep -q 'added=0 allowed=0 removed=0' <<<"$out" && grep -q '^~ worsened [0-9a-f]* sub/o.ts:1 tangled  cyclomatic 14 -> 15' <<<"$out" && echo "ok   the moved and edited function shows as worsened, not removed plus added" || { echo "FAIL moved and edited"; echo "$out" | head -4; fail=1; }
rcheck "a function moved between files stays + and -" "added=2 allowed=0 removed=2" HEAD~1 HEAD
rcheck "...and is counted as an unmatched move"     "unmatched_moves=2" HEAD~1 HEAD
"$BIN" delta HEAD~4 HEAD~3 --repo "$R" --json 2>/dev/null | grep -q '"renamed_files":1' && echo "ok   renamed_files in the JSON summary" || { echo "FAIL renamed_files json"; fail=1; }

# Effect layers: an unprovided service reaches delta as a finding named by file and layer name.
( cd "$E" && cat > app.ts <<'TS'
import { Context, Effect, Layer, ManagedRuntime } from "effect"
export class Db extends Context.Tag("Db")<Db, { q: number }>() {}
export class Mailer extends Context.Tag("Mailer")<Mailer, { send: number }>() {}
export const MailerLive = Layer.effect(Mailer, Effect.gen(function* () {
  const db = yield* Db
  return { send: db.q }
}))
export const runtime = ManagedRuntime.make(MailerLive)
TS
  git add -A && git commit -qm "an app whose runtime misses Db" )
out=$("$BIN" delta HEAD~1 HEAD --repo "$E" 2>/dev/null)
grep -q '^+ effect.unprovided-service [0-9a-f]* app.ts:[0-9]* MailerLive  MailerLive (app.ts) requires Db' <<<"$out" && echo "ok   an unprovided Effect service is a finding, named by file and layer" || { echo "FAIL unprovided service"; echo "$out" | head -4; fail=1; }

# The engine's certificate: a missing CERT line refuses (exit 2); a class-in-context finding the
# CLI cannot resolve is reported as degraded input, never dropped silently.
FE=$(mktemp -d)
printf '#!/bin/sh\necho "pulsar-findings 0"\necho "S 0 0 0"\n' > "$FE/nocert"
printf '#!/bin/sh\ngrep -q "^KD " "$1" && exec '"'"$REAL"'"' "$1"\necho "pulsar-findings 0"\necho "CERT 1"\necho "S 0 0 0"\necho "pulsar-classctx 0"\necho "RCX 99 0 0 0"\necho "RCXS 1"\n' > "$FE/badrcx"
chmod +x "$FE/nocert" "$FE/badrcx"
PULSAR_ENGINE="$FE/nocert" "$BIN" delta HEAD~1 HEAD --repo "$E" --no-cache >/dev/null 2>"$FE/err"; code=$?
[ "$code" == 2 ] && grep -q "certificate line is missing" "$FE/err" && echo "ok   a missing CERT line refuses (exit 2)" || { echo "FAIL missing CERT (exit $code)"; fail=1; }
out=$(PULSAR_ENGINE="$FE/badrcx" "$BIN" delta HEAD~1 HEAD --repo "$E" --no-cache 2>/dev/null)
grep -q 'DEGRADED INPUT (head) class-context: 1 class-in-context finding' <<<"$out" && echo "ok   an unresolvable class-in-context finding is degraded input, not dropped" || { echo "FAIL dropped RCX"; echo "$out" | head -3; fail=1; }
rm -rf "$FE"

# SQL rules: opt-in through policy (an SR row per enabled rule), and the engine's SQX lines become
# findings named by file, table and column. A scripted engine stands in for the SQL section.
Q=$(mktemp -d); trap 'rm -rf "$T" "$K" "$D" "$E" "$R" "$Q"' EXIT
( cd "$Q" && git init -q . && git config user.email t@t && git config user.name t
  echo base > README.md && git add -A && git commit -qm base
  mkdir -p .pulsar && printf 'format = "pulsar-policy 0"\n[rules]\nenable = [\n  "sql.unindexed-filter",\n]\n' > .pulsar/policy.toml
  printf 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);\nSELECT id FROM users WHERE name = '"'"'x'"'"';\n' > q.sql
  git add -A && git commit -qm "a schema and an unindexed filter" )
"$BIN" facts "$Q" -o "$Q/../q.facts" >/dev/null 2>&1; grep -q '^SR 4$' "$Q/../q.facts" && echo "ok   an enabled SQL rule becomes an SR row" || { echo "FAIL SR row"; fail=1; }
rm -f "$Q/../q.facts"*
printf '#!/bin/sh\ngrep -q "^KD " "$1" && exec '"'"$REAL"'"' "$1"\necho "pulsar-findings 0"\necho "CERT 1"\necho "S 0 0 0"\ngrep -q "^SR " "$1" || exit 0\necho "pulsar-sql 0"\necho "SQD 1 0 1"\necho "SQX sql.unindexed-filter site 0 2 1 0"\necho "SQS 1"\n' > "$Q/../fake-sql"; chmod +x "$Q/../fake-sql"
out=$(PULSAR_ENGINE="$Q/../fake-sql" "$BIN" delta HEAD~1 HEAD --repo "$Q" --no-cache 2>/dev/null)
grep -q '^+ sql.unindexed-filter [0-9a-f]* q.sql:2 -  unindexed-filter on users.name (1 site)' <<<"$out" && echo "ok   an SQX line is a finding named by file, table and column" || { echo "FAIL SQL finding"; echo "$out" | head -4; fail=1; }
rm -f "$Q/../fake-sql"


# Effect-only scope (policy [packs.effect]): promise-style code is a finding only in files the repo
# declared effect-only; the same code elsewhere is not.
W=$(mktemp -d); trap 'rm -rf "$T" "$K" "$D" "$E" "$R" "$Q" "$W"' EXIT
( cd "$W" && git init -q . && git config user.email t@t && git config user.name t
  echo base > README.md && git add -A && git commit -qm base
  echo '{"dependencies":{"effect":"*"}}' > package.json
  mkdir -p .pulsar core lib
  printf 'format = "pulsar-policy 0"\n[packs.effect]\neffect_only = [\n  "core/",\n]\n' > .pulsar/policy.toml
  printf 'export async function f(x: number) {\n  return await Promise.resolve(x)\n}\n' > core/a.ts
  cp core/a.ts lib/b.ts
  git add -A && git commit -qm "promise-style code in and out of the effect-only scope" )
out=$("$BIN" delta HEAD~1 HEAD --repo "$W" 2>/dev/null)
grep -q '^+ effect.promise-style-in-effect-scope [0-9a-f]* core/a.ts' <<<"$out" && echo "ok   promise-style code in an effect-only file is a finding" || { echo "FAIL effect-only scope"; echo "$out" | head -4; fail=1; }
! grep -q 'lib/b.ts' <<<"$out" && echo "ok   the same code outside the effect-only scope is not" || { echo "FAIL out-of-scope file reported"; fail=1; }

# effect.throw-or-try-in-gen (ctx bit 128): throw and try directly in an Effect.gen or Effect.fn body
# are findings; inside Effect.try or Effect.tryPromise, in a helper nested in the body, or in a test
# they are not. Pack-gated: no effect_only policy needed.
G=$(mktemp -d); trap 'rm -rf "$T" "$K" "$D" "$E" "$R" "$Q" "$W" "$G"' EXIT
( cd "$G" && git init -q . && git config user.email t@t && git config user.name t
  echo base > README.md && git add -A && git commit -qm base
  echo '{"dependencies":{"effect":"*"}}' > package.json
  cat > g.ts <<'TS'
import { Effect } from "effect"
export const fires1 = Effect.gen(function* () {
  if (Math.PI > 4) throw new Error("x")
  return 1
})
export const fires2 = Effect.fn("fires2")(function* (s: string) {
  try { return JSON.parse(s) } catch { return 0 }
})
export const quiet1 = Effect.gen(function* () {
  const a = yield* Effect.try({ try: () => { throw new Error("y") }, catch: () => "e" })
  const b = yield* Effect.tryPromise({ try: async () => { try { return 1 } finally { } }, catch: () => "e" })
  const helper = (n: number) => { if (n < 0) throw new Error("z"); return n }
  return a + b + helper(1)
})
TS
  sed -e 's/fires1/inTest1/; s/fires2/inTest2/g' g.ts > g.test.ts
  git add -A && git commit -qm "throw and try in and out of Effect.gen bodies" )
out=$("$BIN" delta HEAD~1 HEAD --repo "$G" 2>/dev/null)
grep -q '^+ effect.throw-or-try-in-gen [0-9a-f]* g.ts:2 fires1 .*syntax#throw (x1) (rule v1)$' <<<"$out" && echo "ok   a throw directly in an Effect.gen body is a finding" || { echo "FAIL throw in Effect.gen"; grep throw-or-try <<<"$out"; fail=1; }
grep -q '^+ effect.throw-or-try-in-gen [0-9a-f]* g.ts:6 fires2 .*syntax#try (x1) (rule v1)$' <<<"$out" && echo "ok   a try directly in an Effect.fn body is a finding" || { echo "FAIL try in Effect.fn"; grep throw-or-try <<<"$out"; fail=1; }
[ "$(grep -c '^[-+~] effect.throw-or-try-in-gen' <<<"$out")" == 2 ] && echo "ok   not inside Effect.try, Effect.tryPromise, a nested helper or a test" || { echo "FAIL rule 4 reported outside the generator body"; grep throw-or-try <<<"$out"; fail=1; }

# effect.mixed-module: a file in effect_only scope with Effect code and an async function is a
# finding; the same file named as a test is not (FC carries the test bit, ctx_none 4).
M=$(mktemp -d); trap 'rm -rf "$T" "$K" "$D" "$E" "$R" "$Q" "$W" "$G" "$M"' EXIT
( cd "$M" && git init -q . && git config user.email t@t && git config user.name t
  echo base > README.md && git add -A && git commit -qm base
  echo '{"dependencies":{"effect":"*"}}' > package.json
  mkdir -p .pulsar src
  printf 'format = "pulsar-policy 0"\n[packs.effect]\neffect_only = [\n  "src/",\n]\n' > .pulsar/policy.toml
  printf 'import { Effect } from "effect"\nexport const e = Effect.gen(function* () {\n  return 1\n})\nexport async function a() {\n  return 2\n}\n' > src/m.ts
  cp src/m.ts src/m.test.ts
  git add -A && git commit -qm "Effect code and an async function in one module, and in a test" )
out=$("$BIN" delta HEAD~1 HEAD --repo "$M" 2>/dev/null)
grep -q '^+ effect.mixed-module [0-9a-f]* src/m.ts' <<<"$out" && echo "ok   a module with Effect code and an async function is a finding" || { echo "FAIL mixed-module"; grep mixed-module <<<"$out"; fail=1; }
! grep -q 'mixed-module .*src/m.test.ts' <<<"$out" && echo "ok   the same module as a test file is not" || { echo "FAIL mixed-module fired in a test file"; grep mixed-module <<<"$out"; fail=1; }

exit $fail
