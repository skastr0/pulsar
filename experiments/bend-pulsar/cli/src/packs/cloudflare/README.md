# packs/cloudflare

Cloudflare Workers pack. Data only: `catalog/cloudflare-workers.toml` classifies D1 and Durable Object SQL calls as `query` and the `env` import of `cloudflare:workers` as `ambient-read`. Framework-specific, so it is switched on by evidence (`@cloudflare/workers-types` or `wrangler` as a dependency, a `wrangler.*` config file, or a `cloudflare:*` import) and never redefines the generic baseline. Owner: pulsar-ts. The `cloudflare:*` module specifiers are external platform modules (`U` reason 0), like `node:*`.

Not covered, by design: a `this.ctx.storage.sql.exec(...)` call inside a class that extends `DurableObject` (the receiver is `this`, which needs the class's base type), and `env.DB.prepare(...)` where `env` is an untyped binding. Both need the type lane. KV, R2 and Durable Object key-value storage I/O would be a new class (storage I/O); that proposal goes to pulsar-research with evidence first.

Rules (all on with the pack, `[rules] disable` turns one off): `cloudflare.query-in-loop` (fan-out, edges 2, test code excluded), `cloudflare.hot-query-fan-out` (that finding in a function an entry point reaches within 3 call edges) and `cloudflare.hot-unindexed-query` (a `sql.unindexed-filter` finding in such a function; it runs only when policy.toml enables `sql.unindexed-filter`). The thresholds are in the catalog, so they are part of its fingerprint.
