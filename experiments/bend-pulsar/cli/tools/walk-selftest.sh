#!/bin/bash
# `pulsar delta --walk`, `pulsar blame` and `pulsar bisect` self-test: a throwaway repo where an import
# cycle is introduced in one commit, survives a file rename, and is removed again.
# Usage: bash tools/walk-selftest.sh [pulsar-binary]   (needs PULSAR_ENGINE or an engine beside the binary)
set -uo pipefail
BIN=$(cd "$(dirname "${1:-$(dirname "$0")/../target/release/pulsar}")" && pwd)/$(basename "${1:-pulsar}")
T=$(mktemp -d); K=$(mktemp -d); export PULSAR_CACHE_DIR="$K"; trap 'rm -rf "$T" "$K"' EXIT; cd "$T"
git init -q . && git config user.email t@t && git config user.name t
echo 'export const a = 1' > a.ts
echo 'import {a} from "./a"; export const b = a' > b.ts
git add -A && git commit -qm "c1 acyclic"
echo '// two' >> b.ts && git commit -qam "c2 touch"
echo 'import {b} from "./b"; export const a = b' > a.ts && git commit -qam "c3 cycle"
echo '// four' >> b.ts && git commit -qam "c4 touch"
git mv a.ts z.ts && echo 'import {a} from "./z"; export const b = a' > b.ts && git add -A && git commit -qm "c5 rename a to z"
echo '// six' >> b.ts && git commit -qam "c6 touch"
echo 'export const a = 1' > z.ts && echo 'export const b = 2' > b.ts && git commit -qam "c7 cycle broken"
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; shift; for l in "$@"; do echo "$l" | head -4; done; fail=1; }

# delta --walk: one line per commit, the added/removed counts decided by the engine.
out=$("$BIN" delta --walk --commits 6 2>"$K/e1.txt")
[ "$(grep -c '^[0-9a-f]\{12\} ' <<<"$out")" == 6 ] && ok "walk prints one line per commit (6)" || bad "walk lines" "$out"
grep -q '^[0-9a-f]* [0-9-]* +1 -0 ~0 ~0  c3 cycle$' <<<"$out" && ok "the cycle is added by c3" || bad "c3 +1" "$out"
grep -q '^[0-9a-f]* [0-9-]* +0 -0 ~0 ~0  c5 rename a to z$' <<<"$out" && ok "a rename that keeps the cycle adds and removes nothing" || bad "c5 rename" "$out"
grep -q '^[0-9a-f]* [0-9-]* +0 -1 ~0 ~0  c7 cycle broken$' <<<"$out" && ok "the cycle is removed by c7" || bad "c7 -1" "$out"
grep -q '^# walk commits=6 .* added=1 removed=1 .* cache_hits=0 cache_misses=7 ' <<<"$out" && ok "summary: 7 evaluations, all misses when cold" || bad "summary" "$(tail -1 <<<"$out")"
out2=$("$BIN" delta --walk --commits 6 2>/dev/null)
grep -q 'cache_hits=7 cache_misses=0 ' <<<"$out2" && ok "a second walk parses nothing (7 hits)" || bad "warm walk" "$(tail -1 <<<"$out2")"
out=$("$BIN" delta --walk --commits 6 --json 2>/dev/null)
[ "$(grep -c '"type":"step"' <<<"$out")" == 6 ] && grep -q '"type":"summary".*"added":1' <<<"$out" && ok "--json: six step lines and a summary" || bad "walk json" "$out"
out=$("$BIN" delta --walk --since HEAD~3 --findings 2>/dev/null)
grep -q '^  - graph.import-cycle ' <<<"$out" && ok "--since with --findings lists the removed cycle" || bad "walk findings" "$out"

# blame: the cycle at an older head is introduced by c3, also after the rename in c5.
head3=$(git rev-parse HEAD~2)
out=$("$BIN" blame "$head3" --commits 6 2>/dev/null)
grep -q 'introduced [0-9a-f]* [0-9-]* c3 cycle' <<<"$out" && grep -q 'unreconciled=0' <<<"$out" && ok "blame at c5: the cycle was introduced by c3, across the rename" || bad "blame c5" "$out"
key5=$(grep -o 'graph.import-cycle [0-9a-f]*' <<<"$out" | head -1 | awk '{print $2}')
out=$("$BIN" blame "$head3" --json --commits 6 2>/dev/null)
grep -q '"type":"blame".*"before_window":false' <<<"$out" && ok "blame --json" || bad "blame json" "$out"
out=$("$BIN" blame --commits 6 2>/dev/null)
grep -q 'findings=0 ' <<<"$out" && ok "blame at HEAD (cycle gone): no findings" || bad "blame head" "$out"
out=$("$BIN" blame "$head3" --since HEAD~4 2>/dev/null)
grep -q 'introduced before' <<<"$out" && ok "a finding present at the start of the range is 'introduced before'" || bad "blame before" "$out"

# bisect: exit codes, and the commit. A key is the finding's identity at the head given, so the
# search runs at c4 (before the rename); a key from after the rename is absent before it.
head4=$(git rev-parse HEAD~3)
key=$("$BIN" blame "$head4" --commits 6 2>/dev/null | grep -o 'graph.import-cycle [0-9a-f]*' | head -1 | awk '{print $2}')
out=$("$BIN" bisect "$key" "$head4" --commits 6 2>/dev/null); code=$?
[ "$code" == 0 ] && grep -q 'c3 cycle' <<<"$out" && ok "bisect finds c3 (exit 0)" || bad "bisect found ($code)" "$out"
out=$("$BIN" bisect "$key5" "$head3" --commits 6 2>/dev/null); code=$?
[ "$code" == 0 ] && grep -q 'c5 rename' <<<"$out" && ok "bisect does not follow a rename: the re-keyed finding starts at c5 (blame follows it)" || bad "bisect rename ($code)" "$out"
"$BIN" bisect "$key" --commits 6 >/dev/null 2>&1; [ $? == 1 ] && ok "bisect: key absent at head -> exit 1" || bad "bisect absent"
"$BIN" bisect "$key" "$head4" --since HEAD~4 >/dev/null 2>&1; [ $? == 3 ] && ok "bisect: present at the start of the range -> exit 3" || bad "bisect widen"
"$BIN" bisect nothex >/dev/null 2>&1; [ $? == 2 ] && ok "bisect: a malformed key -> exit 2" || bad "bisect key syntax"
git checkout -q "$head4" 2>/dev/null
"$BIN" bisect --test "$key" >/dev/null 2>&1; [ $? == 1 ] && ok "bisect --test: present -> exit 1 (bad)" || bad "test present"
git checkout -q HEAD~2 2>/dev/null
"$BIN" bisect --test "$key" >/dev/null 2>&1; [ $? == 0 ] && ok "bisect --test: absent -> exit 0 (good)" || bad "test absent"
"$BIN" bisect --test "$key" nosuchrev >/dev/null 2>&1; [ $? == 125 ] && ok "bisect --test: cannot evaluate -> exit 125 (skip)" || bad "test skip"
git checkout -q master 2>/dev/null || git checkout -q main 2>/dev/null
git bisect start "$head4" "$(git rev-list --max-parents=0 HEAD)" >/dev/null 2>&1
res=$(git bisect run "$BIN" bisect --test "$key" 2>/dev/null)
grep -q 'c3 cycle' <<<"$res" && ok "git bisect run drives pulsar bisect --test and lands on c3" || bad "git bisect run" "$res"
git bisect reset >/dev/null 2>&1
[ -z "$(ls -d /tmp/pulsar-delta-* 2>/dev/null)" ] && ok "scratch removed" || bad "scratch left behind"
exit $fail
