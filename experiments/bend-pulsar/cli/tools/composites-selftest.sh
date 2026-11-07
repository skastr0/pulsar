#!/bin/bash
# Fan-out, constant-argument and hot-path rules end to end: a Cloudflare Worker whose head commit
# adds a query inside a loop (reached from `fetch`) and an unindexed filter, checked through
# `pulsar delta`, `pulsar policy` and `[rules] disable`.
# Usage: bash tools/composites-selftest.sh [pulsar-binary]   (needs PULSAR_ENGINE or an engine beside the binary)
set -uo pipefail
BIN=$(cd "$(dirname "${1:-$(dirname "$0")/../target/release/pulsar}")" && pwd)/$(basename "${1:-pulsar}")
T=$(mktemp -d); K=$(mktemp -d); export PULSAR_CACHE_DIR="$K"; trap 'rm -rf "$T" "$K"' EXIT; cd "$T"
git init -q . && git config user.email t@t && git config user.name t
mkdir -p src .pulsar
printf 'name = "demo"\nmain = "src/index.ts"\n' > wrangler.toml
echo 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);' > schema.sql
cat > .pulsar/policy.toml <<'P'
format = "pulsar-policy 0"

[rules]
enable = [
  "sql.unindexed-filter",
]
P
cat > src/index.ts <<'TS'
export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    return new Response("ok");
  },
};
TS
git add -A && git commit -qm base
cat > src/index.ts <<'TS'
export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    const ids = [1, 2, 3];
    return new Response(JSON.stringify(await loadAll(env.DB, ids)));
  },
};
async function loadAll(db: D1Database, ids: number[]) {
  const out = [];
  for (const id of ids) {
    out.push(await one(db, id));
  }
  return out;
}
async function one(db: D1Database, id: number) {
  return db.prepare("SELECT * FROM users WHERE name = ?").bind(id).all();
}
TS
git commit -qam head
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }
out=$("$BIN" delta HEAD~1 HEAD --repo . 2>/dev/null); code=$?
[ "$code" == 1 ] && ok "head adds findings: exit 1" || bad "exit $code, want 1"
for r in cloudflare.query-in-loop cloudflare.hot-query-fan-out cloudflare.hot-unindexed-query sql.unindexed-filter; do
  grep -q "^+ $r " <<<"$out" && ok "added: $r" || { bad "missing: $r"; echo "$out" | tail -6; }
done
grep -q 'added=4 ' <<<"$out" && ok "exactly the four findings" || bad "summary: $(tail -1 <<<"$out")"
pol=$("$BIN" policy --repo . 2>/dev/null)
grep -q $'^rule\tcloudflare.query-in-loop\tv1\tfanout rf=0 class=1 edges=2 none=4$' <<<"$pol" && ok "policy prints the fan-out threshold" || { bad "policy fan-out line"; echo "$pol"; }
grep -q $'^rule\tcloudflare.hot-unindexed-query\tv1\thot rh=1 lane=1 base=4 (sql.unindexed-filter) depth=3$' <<<"$pol" && ok "policy prints the hot-path threshold and base" || bad "policy hot line"
fp=$(grep '^fingerprint' <<<"$pol")
# Turning a rule off changes the fingerprint and removes its findings, and nothing else.
sed -i.bak 's/^enable = \[/disable = [\n  "cloudflare.hot-query-fan-out",\n]\nenable = [/' .pulsar/policy.toml && rm -f .pulsar/policy.toml.bak
git commit -qam "disable the hot fan-out rule"
out2=$("$BIN" delta HEAD~2 HEAD --repo . 2>/dev/null)
grep -q 'cloudflare.hot-query-fan-out' <<<"$out2" && bad "disabled rule still reported" || ok "[rules] disable removes the rule"
grep -q 'added=3 ' <<<"$out2" && ok "the other three remain" || bad "summary: $(tail -1 <<<"$out2")"
[ "$("$BIN" policy --repo . 2>/dev/null | grep '^fingerprint')" != "$fp" ] && ok "fingerprint changed with the policy" || bad "fingerprint unchanged"
# Without the SQL rule on, the hot unindexed rule says why it is off.
printf 'format = "pulsar-policy 0"\n' > .pulsar/policy.toml
"$BIN" policy --repo . 2>/dev/null | grep -q $'^rule-off\tcloudflare.hot-unindexed-query\tbase rule sql.unindexed-filter is not on' && ok "inert hot rule reports its reason" || bad "inert hot rule not reported"

# ---- unbounded growth (RG) and untested data access (RU) ----
cd "$T" && rm -rf ./* .pulsar .git && git init -q . && git config user.email t@t && git config user.name t
mkdir -p src .pulsar
printf 'name = "demo"\nmain = "src/index.ts"\n' > wrangler.toml
echo 'CREATE TABLE events (id INTEGER PRIMARY KEY, kind TEXT, at INTEGER);' > schema.sql
printf 'format = "pulsar-policy 0"\n' > .pulsar/policy.toml
cat > src/index.ts <<'TS'
export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    return new Response("ok");
  },
};
TS
git add -A && git commit -qm base2
cat > src/index.ts <<'TS'
export default {
  async fetch(request: Request, env: { DB: D1Database }): Promise<Response> {
    await record(env.DB, "hit");
    return new Response(JSON.stringify(await report(env.DB)));
  },
};
async function record(db: D1Database, kind: string) {
  return db.prepare("INSERT INTO events (kind, at) VALUES (?, ?)").bind(kind, Date.now()).run();
}
async function report(db: D1Database) {
  return db.prepare("SELECT kind, at FROM events").all();
}
TS
git commit -qam head2
out=$("$BIN" delta HEAD~1 HEAD --repo . 2>/dev/null)
grep -q '^+ cloudflare.unbounded-growth .* report  .*reads events with no row bound, and record inserts into it' <<<"$out" && ok "unbounded growth: an unkeyed read of a table a request inserts into" || { bad "growth finding"; echo "$out" | tail -4; }
grep -q 'core.untested-data-access' <<<"$out" && bad "untested rule fired without a coverage report" || ok "untested data access is silent without a coverage report"
printf 'TN:\nSF:src/index.ts\nDA:2,1\nDA:3,1\nDA:4,1\nend_of_record\n' > lcov.info
out=$("$BIN" delta HEAD~1 HEAD --repo . 2>/dev/null); code=$?
grep -q '^? core.untested-data-access .* record  runs a query and has no coverage data' <<<"$out" && grep -q '^? core.untested-data-access .* report  ' <<<"$out" && ok "untested data access: both query functions have no coverage data" || { bad "untested findings"; echo "$out" | tail -4; }
[ "$code" == 1 ] && ok "only the growth finding counts toward exit 1" || bad "exit $code, want 1 (coverage findings never count)"
sed -i.bak 's/"SELECT kind, at FROM events"/"SELECT kind, at FROM events WHERE id = ?"/' src/index.ts && rm -f src/index.ts.bak && git commit -qam "keyed read"
out=$("$BIN" delta HEAD~1 HEAD --repo . 2>/dev/null)
grep -q '^- cloudflare.unbounded-growth ' <<<"$out" && ! grep -q '^+ cloudflare.unbounded-growth ' <<<"$out" && ok "binding the primary key removes the unbounded-growth finding" || { bad "a read keyed by the primary key is still reported"; echo "$out" | tail -3; }
printf 'format = "pulsar-policy 0"\n\n[rules]\ndisable = [\n  "core.untested-data-access",\n]\n' > .pulsar/policy.toml && git commit -qam "disable untested"
out=$("$BIN" delta HEAD~3 HEAD --repo . 2>/dev/null)
grep -q 'core.untested-data-access' <<<"$out" && bad "disabled untested rule still reported" || ok "[rules] disable turns untested data access off"
exit $fail
