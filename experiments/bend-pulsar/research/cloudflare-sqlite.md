# Cloudflare / SQLite / alchemy checks — what generalises (#690)

Evidence survey for the detectors the Cloudflare+SQLite stack wants. Sources: one private
Effect + SQLite + Cloudflare app ("app A", alchemy IaC, Durable Object SQLite, ~400 TS
files, git-archive snapshot — **no names, paths, symbols or schema identifiers from it
appear here**) and one private Electron + SQLite app ("app B", ~60 tables, ~150 foreign
keys — aggregate numbers only), plus the public `alchemy` IaC framework repo and official
Cloudflare/SQLite docs. All numbers below are counts I measured myself on the pinned
snapshots; commands are described, not committed (private trees).

## (a) Infra binding drift — declared vs used

**Mechanism (technology-free):** deployment config declares named capabilities
(bindings, env vars, secrets); code reads them by name. Two failure shapes:
declared-but-never-read (dead config, leaked surface) and read-but-never-declared
(runtime `undefined`). Stated without any product name: "a name bound at deploy time
has no consumer" / "a consumer has no binding".

**Evidence:**
- App A: two deployables, **27 declared env names, 27 consumed — zero drift**, both
  directions. Consumer-side env typing is not always centralised in one interface;
  the check must union every env-typed surface in the deployable, not just the
  canonical one (observed in one app).
- App B (no IaC): N/A — the mechanism needs a declaration surface to diff against.
- Alchemy corpus: most examples bind through Effect capability services (Layer-provided
  clients), not env names — drift there is "capability declared but never yielded",
  which is a *layer-graph* question, not a name-diff. Worth noting: our existing
  layer/service facts already cover that half.
- Generalisation: the same two-sided contract exists in wrangler.toml bindings
  (vars/secrets/D1/KV/R2/DO/services — https://developers.cloudflare.com/workers/wrangler/configuration/),
  k8s env/secretKeyRef, GitHub Actions vars/secrets vs `${{ }}` uses, SAM/CDK env.
  Name-diff is cheap, deterministic, high-precision.

**Threshold:** none (binary per name). **Default:** the *data* (parse alchemy env
blocks / wrangler config into declared-name facts) can be always-on per pack; the
*finding* should be a pack rule (cloudflare/infra pack), ON when the pack activates.
Recommend build.

## (b) SQLite schema facts

Two sub-checks from the task's "group G":

**FK without covering index.** SQLite does **not** auto-index foreign-key columns
(only PK/UNIQUE get implicit indexes — SQLite docs, foreign-key support section).
Child-side FK columns need explicit indexes for join/delete performance.
- App A: **zero FOREIGN KEY clauses** — its schema style avoids FKs entirely
  (app-level integrity). The check finds nothing here; that is honest evidence the
  corpus doesn't exercise it.
- App B: 59 tables, ~150 FK clauses (column- and table-level). After crediting
  PRIMARY KEY/UNIQUE/explicit-index leftmost-prefix coverage, roughly **60–80 FK
  column sets lack a covering index** (my parser's noise-adjusted estimate; ~15%
  uncertainty from composite/inline forms). Many are composite home/scope-style key
  columns — plausibly queried by design, plausibly fine because the tables are small.
  Severity is performance-smell, not correctness: an FK column without an index only
  hurts if it's actually joined/filtered.
- **Threshold:** none per se; meaningful only with query-usage context (does any
  query filter/join on the FK column?). Recommend: emit the fact, let the finding
  require either an unindexed *queried* column or report as informational.
  **Default: opt-in.**

**Query filtering on an unindexed column.** App A declares its indexes as data
separately from the code and writes WHERE clauses as SQL string literals — the two
sides are both extractable. Its index discipline is already good: inspected query
sites filter on indexed columns. App B's queries are ORM-generated, so the check
applies to literal SQL only — document that boundary. CREATE TABLE sources: `.sql`
files, inline `exec("CREATE TABLE …")` strings in code, and generated DDL from typed
schema DSLs.
**Default: opt-in** until a second corpus shows real hits; needs a small SQL parser
for the subset we emit facts on (SELECT … WHERE col op, CREATE TABLE, CREATE INDEX).

## (c) Query reachable from a loop (N+1)

**Mechanism (technology-free):** a stateful/remote call fact transitively reachable
from a loop body, where the loop iterates a data-dependent collection — the classic
N+1. We already have the ingredients: CT loop nodes, call edges, and (per pack) a
"query/IO call" classification — same shape as the Effect-pack symbol catalog.

**Evidence in App A:** **3 call sites where a query, storage or network call is
reachable from a loop or per-element iteration callback** — one issues a SQL
statement per map entry, one writes storage per pending item in an event handler,
one makes a network call per message in a webhook loop. A second corpus (an
Effect + SQL app, measured by pulsar-ts-effect on its pinned snapshot) shows the
same shape at larger scale: of 1,101 query call
sites, 121 sit in syntactic loops and 1,053 run in an Effect context where
iteration combinators (`Effect.forEach` and friends) hide the loop from a
syntactic `loop_depth` — the N+1 mechanism needs iteration combinators as pack
data, not just loop nodes.
- Important severity note: DO `storage.sql.exec` is **synchronous** — an N+1 there
  costs CPU and input-gate hold time, not network round-trips. D1 (HTTP API) *would*
  be round-trips; App A uses DO SQLite only, no D1 bindings. The check should still
  fire (batching helps both), but evidence wording must not claim round-trips.

**Threshold:** binary (query-call reachable from loop body), maybe require the loop
bound to be data-dependent (collection iteration), not a fixed small range.
**Default: opt-in** — false positives exist (intentional per-item commits, tiny
fixed sets); ship the reachability fact first, tune on corpora.

## (d) Await inside an exclusive gate (DO hazards that generalise)

Task candidate was "awaiting I/O inside `blockConcurrencyWhile`". Cloudflare's own
docs refine it: the callback *is* async by contract; the hazards are (1) >30 s →
object reset, (2) a throw → object terminated/reset, (3) blocking all other events →
head-of-line latency. The generalisable mechanism is: **await/yield inside a callback
that holds an exclusive gate or is documented must-not-yield** — the same class as
Rust clippy's `await_holding_lock` and the "don't hold a DB transaction across network
I/O" rule.

- App A: **zero `blockConcurrencyWhile` uses.** Its own code comments document the
  equivalent hazard: awaiting unrelated I/O inside a storage-transaction callback
  can stall the object until the runtime resets it. The team knows the rule; a
  detector would be a guard, not a discovery.
- Gate functions are pack data: `blockConcurrencyWhile`, `storage.transaction`,
  `transactionSync` (sync — no hazard), and any app-level serial queue (holding it
  across unrelated awaits *is* the designed behaviour there, so the callback list
  must be curated, not syntactic).
- **Threshold:** binary per await-in-gate-callback. **Default: opt-in pack rule.**

## Ranked build list

1. **(a) Binding drift** — cheapest, highest precision, directly serves the operator's
   app. Config parse → declared-name facts; diff vs all env-typed consumer surfaces.
   Ship as cloudflare/infra pack rule.
2. **(c) N+1 reachability** — reuses CT loop + call facts; classify query/IO calls via
   pack catalog (same pattern as Effect pack). Opt-in until corpus-tuned.
3. **(b) SQLite schema facts** — real evidence in app B (~60–80 uncovered FKs); needs
   the SQL-subset parser; emit facts always, findings opt-in.
4. **(d) Await-in-gate** — narrowest; pack-curated callback list; guard value only.

## Method note

Counts measured on pinned snapshots (a private Effect + SQLite + Cloudflare app,
git-archive, 546 files; a private Electron + SQLite app's schema files; the public
`alchemy` framework repo @ 0a3a419). FK/index analysis is a regex-level parse of DDL
strings — stated uncertainty ±15%; a real implementation needs a proper SQLite DDL
parser. No private-repo identifiers, paths, symbols, schema names or fixtures appear
above; all corpus-derived claims are aggregate counts or paraphrase.
