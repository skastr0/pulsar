# Zero-finding census — 0.4.1 detectors on real code (#719 support)

Lead ruling (2026-11-07): detectors with zero findings across all corpora cannot
be sampled; they ship in 0.4.1 only with fixtures that fire and stay silent, and
the release notes mark them unsampled on real code. This census is the evidence
for that marking: which 0.4.1 detectors produced findings on real repositories,
and which stayed silent because no corpus reached their inputs.

## Method

- Engine: own build at `a79e27e` (`/tmp/pulsar-engine-a79`), facts from
  `cli/target/release/pulsar facts` at the same tree.
- 26 repositories: the 22-repo sampling corpus (junto, a private Cloudflare
  app, opencode, effect, uploadthing, confect, t3code, alchemy,
  effect-http, deepseek-harness, evolu, paperclip, todo-playground, codex,
  smithers, workbooks.sh, contextplus, composer-api, buzz, canvas-ui,
  codecanary, impeccable) plus four dependency-scan additions chosen for
  Cloudflare/SQLite signals (cua, examples, sst, vercel-examples). Codex was
  covered by another seat. The private app is reported by aggregate counts
  only; its paths, symbols and line refs stay out of this document.
- Policies: each repo's committed `.pulsar/` where present, else built-in
  defaults; sampling policies for the private corpora per the precision
  protocol. Vendored `.repos/` dirs are inside the scanned tree where the repo
  vendors them (t3code); per-repo policy decides scope.
- A detector "fires" when its output section prints at least one finding line
  (`SQX`, `HX`, `NX`, `GX`, `BFX`, `KX`, `UX`, plus the effect layer-graph and
  classctx tags for completeness).

## Findings per 0.4.1 detector

| detector | findings | repos | verdict |
|---|---|---|---|
| sql.unindexed-filter | 15 | deepseek-harness only | sampled-able (n=15) |
| sql.schema-drift | 2 | deepseek-harness only | sampled-able (n=2) |
| sql.dynamic-text | 0 | — | unsampled on real code |
| sql.fk-unindexed | 0 | — | unsampled on real code |
| sql.index-defeat | 0 | — | unsampled on real code |
| sql.offset-param | 0 | — | unsampled on real code |
| cloudflare.query-in-loop | 1 | private app | 1 TP verified (run-site `yield* sql.unsafe` per iteration); build-vs-run fix pending |
| cloudflare.hot-query-fan-out | 0 | — | unsampled on real code |
| cloudflare.hot-unindexed-query | 0 | — | unsampled on real code |
| cloudflare.unbounded-growth | 1 | private app | known FP family (PK credit), fix pending |
| cloudflare.binding-drift | 5 | private app 2, t3code 3 | 1 TP (t3code Worker.DB), 4 known-FP escape family, fix pending |
| core.untested-data-access | 0 | — | unsampled (needs coverage data; no CV rows in these scans) |
| constant-partition-key | 0 | — | unsampled on real code |

Effect layer-graph rules are not zero anywhere they reach: `LHUB` 118,
`LDUP` 9, `LS` 10 lines across confect, effect-http, effect, examples, junto,
opencode, t3code, todo-playground, uploadthing and the private app
(degraded-root counts vary; the private app's five roots all reach opaque
layers per the #688 run).

## Why the SQL zeros are a coverage gap, not verified silence

The SQL section runs only when schema rows (`SR`) exist, and `SR` rows come
only from `.sql` files parsed in the hard-wired SQLite dialect
(`cli/src/driver.rs`). Across 26 repos:

- `SR > 0` in exactly one repo: deepseek-harness (56 `.sql` files → SR 6).
- paperclip (77 `.sql`), alchemy (37), opencode (111), codex (39), buzz (33),
  sst (5), t3code (4), the private app (3), smithers (2), composer-api (2),
  vercel-examples (1): all `.sql` content is Postgres/MySQL/drizzle migrations
  that does not parse as SQLite → SR 0 → `SQD` incomplete, no `SQX`.
- DDL defined in code never reaches the schema model. Observed patterns:
  1. `yield* sql`CREATE TABLE …`` literal template (todo-playground
     DatabaseService.ts, t3code Migrations) → `QS` kind-5 site,
     parsed, but no `SR`.
  2. `ctx.storage.sql.exec(`CREATE TABLE …`)` inline template in a
     Durable Object worker bootstrap.
  3. `sql.unsafe(`CREATE TABLE …`)` / `session.run(sql`…`)` with dynamic
     identifiers (paperclip db client, opencode
     effect-drizzle-sqlite) → `QS` flag 64 dynamic.
  4. Exported `const X_SCHEMA_SQL = `…`` executed via `database.exec(CONST)`
     on node:sqlite `Database` (junto state-schema modules, alchemy example
     schema files) → `exec` is not a catalog query symbol, zero sites.
- Driver reality: `better-sqlite3`, `node:sqlite`, `bun:sqlite`, `drizzle-orm`,
  `pg`, `mysql2`, `@libsql` appear across the corpus but produce no catalog
  query sites (evolu better-sqlite3 → QS 0; junto node:sqlite with
  QS 741 that are mostly flag-64 dynamic text via helpers).

Consequence for the release table: the four zero-finding SQL rules and the
two hot composites are **unsampled on real code** — the detectors are
fixture-covered but no corpus exercised their inputs. This is a fact-coverage
gap (#740 tracks dialect-from-evidence, DDL-from-embedded-SQL, and driver
catalogs), not evidence the detectors stay silent where facts exist.

## Cloudflare family status

Every Cloudflare finding in the completed set belongs to a known FP family
under active fix: build-site query credit (pulsar-graph's #688 blocker),
PK-key credit in unbounded-growth (pulsar-composites), env-escape in
binding-drift (pulsar-history). The family has zero confirmed real-code TPs
until those fixes land and fidelity's resample runs; the private app's
query-in-loop finding is the expected survivor (verified run-site).

Caveat: the alchemy engine run was still in flight when this census closed
(machine load ~240, engine CPU-starved). It is structurally bounded — SR=0
means `SQD`-incomplete, so no `SQX`/`GX`/lane-1 `HX` can print — but it can
still add `NX` or `BFX` rows; if it does, the table's Cloudflare counts move
and this file gets a follow-up line.

## Per-repo data

Delivered to pulsar-rs for #740 on the task thread: per-repo QS/SR/DT counts,
`.sql` file counts, driver imports, and the five DDL-in-code patterns above.
Facts files: `/tmp/s2-<repo>.facts` (ephemeral; regenerate with
`pulsar facts <repo> -o /tmp/s2-<repo>.facts`).
