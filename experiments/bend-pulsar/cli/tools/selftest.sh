#!/bin/bash
# Resolution and usage self-test: builds a throwaway git repo, runs `pulsar facts`, and checks
# the edges FACTS.md says must exist. Usage: tools/selftest.sh [path-to-pulsar-binary]
set -euo pipefail
BIN=$(cd "$(dirname "${1:-$(dirname "$0")/../target/release/pulsar}")" && pwd)/$(basename "${1:-pulsar}")
T=$(mktemp -d)
trap "rm -rf \"\$T\"" EXIT; [ -n "${KEEP:-}" ] && trap - EXIT
cd "$T"
git init -q .
mkdir -p src/lib/deep pkgs/core/src pkgs/app/src apps/web/src/feature
w() { mkdir -p "$(dirname "$1")"; cat > "$1"; }
w tsconfig.base.json <<'J'
{ // JSONC comment
  "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } }
}
J
w tsconfig.json <<'J'
{ "extends": "./tsconfig.base.json", "include": ["src", "pkgs"] }
J
w apps/web/tsconfig.json <<'J'
{ "compilerOptions": { "baseUrl": "src", "paths": { "~/*": ["./*"] } } }
J
w pkgs/core/package.json <<'J'
{ "name": "@org/core" }
J
w pkgs/core/src/index.ts <<'J'
export const core = 1
J
w pkgs/core/src/util.ts <<'J'
export const util = 1
J
w pkgs/app/package.json <<'J'
{ "name": "@org/app" }
J
w pkgs/app/src/main.ts <<'J'
import { core } from "@org/core"
import { util } from "@org/core/util"
import "react"
export const m = core + util
J
w src/a.ts <<'J'
import { b } from "./b.js"           // .js -> .ts            (a -> b)
import { c } from "./lib"             // directory index        (a -> lib/index)
import { d } from "@lib/deep/d"       // extends + paths        (a -> lib/deep/d)
import { e } from "src/lib/e"         // baseUrl from extends   (a -> lib/e)
import type { T } from "./types"      // type-only              (hv=0 ht=1)
import { type U, V } from "./uv"      // V unused counts as value (hv=1 ht=1)
import { W } from "./w"               // only in type position  (hv=0 ht=1)
import type {} from "./empty-type"    // empty type clause      (hv=0 ht=1)
import {} from "./empty"              // empty clause           (hv=0 ht=0)
import { X } from "./x?worker"        // query suffix: not a module
export { Y } from "./y"               // Y is an interface in y.ts: type-only (hv=0 ht=1)
export * from "./star"                // form 2 hv=1
import "./side"                       // form 1
import fs from "node:fs"
let w: W
export const q: typeof b = b
J
w src/b.ts <<'J'
export const b = 1
J
w src/lib/index.ts <<'J'
export const c = 1
J
w src/lib/deep/d.ts <<'J'
export const d = 1
J
w src/lib/e.ts <<'J'
export const e = 1
J
for f in types uv w empty-type empty x y star side; do echo 'export const v = 1' > src/$f.ts; done
echo 'export interface Y {}' > src/y.ts
w apps/web/src/main.ts <<'J'
import { f } from "~/feature/f"       // nearest tsconfig only: baseUrl src + paths
export const g = f
J
w apps/web/src/feature/f.ts <<'J'
export const f = 1
J
echo 'export const x = 1' > src/types.d.ts
git add -A >/dev/null
git -c user.email=selftest@pulsar -c user.name=selftest commit -qm selftest   # history facts need a HEAD
OUT=$T/facts.txt
"$BIN" facts "$T" -o "$OUT" 2>/dev/null
id() { grep -n -x -F "$1" "$OUT.paths" | cut -d: -f1 | awk '{print $1-1}'; }
fail=0
expect() { # expect "<src>" "<dst>" "<form hv ht>"
  s=$(id "$1"); d=$(id "$2")
  if grep -q -x "I $s $d $3" "$OUT"; then echo "ok   $1 -> $2 [$3]"; else echo "FAIL $1 -> $2 [$3]"; grep "^I $s $d " "$OUT" || echo "  (no I fact)"; fail=1; fi
}
absent() { s=$(id "$1"); d=$(id "$2"); if grep -q "^I $s $d " "$OUT"; then echo "FAIL unexpected $1 -> $2"; fail=1; else echo "ok   no edge $1 -> $2"; fi; }
expect src/a.ts src/b.ts "0 1 0"
expect src/a.ts src/lib/index.ts "0 1 0"
expect src/a.ts src/lib/deep/d.ts "0 1 0"
expect src/a.ts src/lib/e.ts "0 1 0"
expect src/a.ts src/types.ts "0 0 1" || true
expect src/a.ts src/uv.ts "0 1 1"
expect src/a.ts src/w.ts "0 0 1"
expect src/a.ts src/empty-type.ts "0 0 1"
expect src/a.ts src/empty.ts "0 0 0"
expect src/a.ts src/y.ts "2 0 1"
expect src/a.ts src/star.ts "2 1 0"
expect src/a.ts src/side.ts "1 1 0"
absent src/a.ts src/x.ts
expect pkgs/app/src/main.ts pkgs/core/src/index.ts "0 1 0"
expect pkgs/app/src/main.ts pkgs/core/src/util.ts "0 1 0"
expect apps/web/src/main.ts apps/web/src/feature/f.ts "0 1 0"
grep -q '^F .* 0$' "$OUT" && echo "ok   non-prod flags present"
exit $fail
