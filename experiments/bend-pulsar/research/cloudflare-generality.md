# Cloudflare group-I generality survey — public corpus (#690 follow-up)

Second pass on `research/cloudflare-sqlite.md`: the private-app evidence is
supplemented by a sweep of the **public `alchemy` examples corpus** (39
`cloudflare-*` example apps @ local checkout, the same tree the framework ships).
Question per PLAN.md group-I detector: does the mechanism appear in more than one
unrelated repo, and does it ship on by default or stay opt-in?

Private-app claims stay aggregate ("app A", "app B") per the #690 privacy rule;
public example names below are fine to cite.

## Fact availability across the corpus

| Fact | Coverage | Evidence |
|---|---|---|
| SQL text (.sql migrations) | 12 of 39 examples | drizzle- and hand-written migrations in `cloudflare-d1-drizzle`, `cloudflare-effect-sql-d1`, `cloudflare-dev`, `cloudflare-website-vinext`, `cloudflare-tanstack-rpc-drizzle`, `cloudflare-durable-object-sql`, plus non-CF DB examples |
| SQL via tagged templates / Effect SQL | ~4 examples | `cloudflare-effect-sql-d1`, `cloudflare-dev` (Hyperdrive), drizzle `sql` in schema files |
| DO SQLite (`storage.sql.exec`) | 2 examples | `cloudflare-durable-object-sql`, `cloudflare-agent` (`src/tools/Sql.ts`) |
| DO classes / entry points | ~16 files | `extends DurableObject` in `cloudflare-worker-async`, `cloudflare-dev`; fetch handlers in nearly all; `queue(batch)` in `cloudflare-dev` AsyncWorker + `cloudflare-worker-async`; scheduled/alarm in 2 |
| Infra declarations | ~15 `alchemy.run.ts` with `env:` blocks | bindings consumed via `env.X` (BACKEND×12, BUCKET×7, ASSETS×4, …) **and** via Effect capability services — two consumption styles confirmed |
| `idFromName`/`getByName` partition keys | 28 call sites | DO examples |
| `blockConcurrencyWhile` | **0** | entire corpus |

## Per-detector verdicts (PLAN.md group-I order)

**SQL lane facts (#692)** — real but minority coverage: ~12/39 examples have SQL
text, ~4 use tagged templates, 2 use DO SQLite. The lane must activate on
evidence (a `.sql` file, a `sql` template, a query-class call), never assume.
**Ship the lane; detectors inherit its opt-in.**

**Unindexed filter / FK coverage / index-defeating predicate / schema drift** —
SQLite-relevant schema exists in only ~2 examples (`d1-drizzle`,
`durable-object-sql`); FK clauses appear in 1 CF migration file. App B (private)
carried the real FK signal. **Opt-in.** The mechanism is sound; the corpus is
too thin for always-on findings.

**Offset pagination** — essentially absent (1 `LIMIT`, 0 `OFFSET` in CF examples).
**Opt-in; lowest priority.**

**Unbounded read** — `SELECT` without `LIMIT` is common in examples, but examples
are demos; reachability-from-entry makes it noisy. **Opt-in composite only**
(the "unbounded growth" composite needs the table-written-from-entry leg anyway).

**Dynamic SQL** — **one clear hit**: `cloudflare-agent`'s SQL tool executes an
arbitrary `sql` parameter through `storage.sql.exec` — query text that is a tool
argument, not a literal/template. Exactly the detector's target. **Opt-in**
(wrapped in an AI tool boundary here — arguably intentional, but worth a
finding).

**Repeated call in loop / N+1** — **two public hits**:
`cloudflare-dev` AsyncWorker's `queue(batch)` loops `storage.put` per message;
`cloudflare-dev` TailWorker maps `env.EVENTS.get(key)` over a list (parallel
`Promise.all`, still per-item remote calls). Plus app A's 3 sites and the
1,101-CS corpus. **Opt-in** until iteration-combinator pack data lands (#696);
syntactic `loop_depth` misses `Effect.forEach` shapes.

**Remote call in loop** — same hits as above; `remote` class needs the Cloudflare
pack's binding catalog (`env.X.get/put/fetch`, DO stubs, `waitUntil` siblings).
**Opt-in with the pack.**

**Awaited I/O inside exclusive section** — `blockConcurrencyWhile`: 0 uses.
`Semaphore`/`Mutex` hits are DB-pool transaction wrappers in non-CF examples.
Combined with app A's zero uses and its documented transaction-await hazard:
**guard value only, opt-in pack rule.** Curated callback list is mandatory —
app-level serial queues await by design.

**Constant partition key** — 28 `idFromName`/`getByName` sites; examples use
both literal-ish and dynamic names. Needs the `partition` class + literal-arg
detection. **Opt-in with the Cloudflare pack.**

**Discarded async work in entry** — no `waitUntil` misuse found in examples, but
entry-point facts (#693) are the prerequisite. **Opt-in.**

**Module-level mutable state / grow-only collection** — no `^let`/`new Map`
module state in CF example `src/`; DO classes keep state in `ctx.storage`, which
is the *correct* pattern. Weak corpus signal. **Opt-in; needs research.**

**Infra binding drift** — strongest public signal: ~15 examples declare `env:`
blocks in `alchemy.run.ts`, consume via `env.X` **and** Effect capability
services. Two consumption styles means the "used" side must union `env.X`
reads, capability yields, and typed `Env` interfaces — exactly the trap app A's
non-central env type demonstrated. Declared side parses alchemy resource props.
**Recommend ON when the infra pack activates** (it's the pack's core check);
keep the finding pack-gated per #690.

## Composites

All five PLAN.md composites depend on legs that are themselves opt-in. No
composite earns always-on status from this corpus. The "hot unindexed query"
composite is the most defensible first composite once #695 lands, because its
legs (unindexed filter + entry reachability + churn) each have independent
corpus support.

## Bottom line for #695/#696

- **Ship on by default:** nothing in group I. Every detector is pack-gated and
  evidence-triggered; the only candidate for ON-by-default-with-pack is binding
  drift, and only inside the cloudflare/infra pack.
- **Build order stands** from `cloudflare-sqlite.md`: binding drift → N+1 →
  SQL schema facts → await-in-gate. The public sweep adds: dynamic SQL and
  partition-key detectors have real (if thin) public hits worth their pack-data
  cost; offset pagination and module-state are the weakest.
- **Prerequisite confirmed:** #693 call-edges/entry-points and #694 infra facts
  gate almost every row. Without them the SQL detectors have no reachability leg.
