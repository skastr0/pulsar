# Precision protocol — 0.4.1 new detectors (pulsar-research, reviewer)

Recorded by the lead on the #719 thread (2026-11-07): **for each detector,
sample 20 findings (all of them if fewer), classify each as a true or false
positive, and report TP/sampled with the sample size, the repos, and one
example of each false-positive cause.** Not 20 per side. Fan-out detectors
(N+1, remote-in-loop, batch) are in scope per the same thread.

This file fixes the method once so every detector is measured the same way.

## Detector inventory (0.4.1 scope)

Effect pack, #705 — rule 1 is split into two rule IDs per the lead's ruling
(2026-11-07); precision is reported per leg, and the exception-style leg falls
back to try-blocks-only if it samples below 0.8:

- `effect.promise-style-in-effect-scope` (class 14 leg): await, async fn,
  `.then`/`.catch`/`.finally` on non-catalog values, `new Promise`,
  `Promise.all/race/allSettled/any` in `effect_only` scope.
- exception-style leg (class 15): `throw`, `try {}` in `effect_only` scope.
- `effect.internal-promise-bridge`: `Effect.promise`/`tryPromise` wrapping a
  repo function that is itself promise-style.
- `effect.mixed-module`: one file in `effect_only` scope defining both
  Effect-returning and async functions.
- `effect.throw-or-try-in-gen`: `throw`/`try` lexically inside
  `Effect.gen`/`Effect.fn` bodies.
- rule 5 per-sha counts: metric rows, not findings — sanity-check that counts
  match a construct census, no TP/FP classification.

Class-in-context extensions, #696 (generic mechanisms, pack data):

- batchable-in-loop: a class with a catalog batch form called at loop depth > 0.
- remote-in-loop: `remote` class call inside a loop.
- awaited-io-in-exclusive: awaited `remote`/`query` inside an `exclusive`
  callback.
- constant-partition-key: `partition`/`idFromName`-style call with a literal
  key.
- dropped-async-work: async work produced in an `entry` function and not
  passed to `lifetime`/`waitUntil`.

SQL lane and composites, #695:

- unindexed-filter, fk-without-child-index, index-defeating-predicate,
  offset-pagination, dynamic-sql, schema-drift (drift counts only when the
  schema is complete — the finding must say so).
- composites: hot-unindexed-query, query-fan-out-on-hot-path,
  single-instance-write-hotspot, unbounded-growth, untested-data-access.

Infra and binding drift, #694 + Cloudflare pack:

- declared-vs-read binding drift (alchemy/wrangler declarations vs `env.X`
  and catalog accessor reads).
- any pack-gated rule that emits findings in the 0.4.1 refresh and was not in
  the 0.4.0 freeze (e.g. `effect.ambient-read-in-effect` if newly enabled).

Fan-out, scope addition on the #719 thread: N+1, remote-in-loop, batch —
same protocol, wired end-to-end via the CLI RF rows.

## Method

1. **Source of findings**: the 0.4.1 refresh runs on the frozen sha — the two
   private refresh corpora plus any playground-corpus runs the implementers
   attach. Findings are read from the JSONL/text output at that sha, never
   from a working tree.
2. **Sampling**: per rule id, pool findings across the refresh corpora. Order
   deterministically by (corpus, file, line, finding key) and take a
   round-robin across corpora up to 20, so no single repo dominates; if the
   pool has fewer than 20, take all. The sample and its ordering are recorded
   so the check is reproducible.
3. **Classification**: for each sampled finding, open the source at the pinned
   sha and read the evidence fields. TP = the finding's claim holds at that
   location: the construct is real, the scope is right (not boundary, test or
   interop where the rule excludes them), and the evidence values are
   correct. FP = any of: construct misidentified, scope leak (boundary/test/
   ctx-32 interop firing when excluded), evidence wrong, or the claim does
   not hold at that site.
4. **FP causes**: group false positives by cause; each cause gets one concrete
   example (file#symbol on the task thread; anonymised in committed docs).
5. **Report**: per rule id — `TP/n`, n, corpora contributing, FP causes with
   examples. Posted on the #719 task thread. Committed copies anonymise the
   private corpora ("a private repo") and carry no private paths or symbols.

## Per-detector TP criteria (what "the claim holds" means)

- promise-style leg: the flagged construct is genuinely Promise/async style
  (`await`, `async` fn/arrow, `.then`/`.catch`/`.finally` on a non-Effect
  thenable, `new Promise`, `Promise.*` static) in a file the repo's policy put
  in `effect_only`, outside `boundary`, test and ctx-32 interop.
- exception-style leg: `throw` or a `try {}` block in `effect_only` scope,
  same exclusions. A `throw` inside a synchronous pure helper is still a TP
  for the rule as written (it is exception-style in Effect scope) — severity
  is the operator's call, precision is not.
- internal-promise-bridge: the `Effect.promise`/`tryPromise` callee is a
  repo-local function that itself contains promise-style constructs. FP if
  the callee resolves to an Effect-returning function or a third-party symbol.
- mixed-module: the file defines at least one Effect-returning function and
  at least one `async` function. FP if the "async" is a type position, a
  callback parameter, or the file is boundary-scoped.
- throw-or-try-in-gen: the `throw`/`try` is lexically inside an
  `Effect.gen`/`Effect.fn` body — not a sibling function, not a nested
  non-gen callback.
- batchable/remote-in-loop: the call is inside a loop (syntactic depth > 0)
  and the class resolution is right.
- awaited-io-in-exclusive: a `remote`/`query` call is awaited inside an
  `exclusive` callback.
- constant-partition-key: the partition/idFromName key is a literal, so all
  callers share one partition.
- dropped-async-work: async work in an `entry` function is not passed to
  `lifetime`/`waitUntil`/equivalent — FP if it is retained, awaited, or
  returned.
- SQL detectors: the schema/query facts support the claim (the column is
  unindexed in the declared schema, the predicate defeats the index, the
  query text is non-literal, etc.).
- binding drift: the binding is declared and never read, or read and never
  declared — FP if read through an accessor the catalog does not name.
- fan-out N+1: a per-item query/remote call inside a loop over a collection.
  remote-in-loop / batch: same shape with the remote/batch classes.

## Status

- Protocol fixed; detector inventory may grow as #694/#695/#696 land — new
  rule ids join this list before their findings are sampled.
- `core.cyclomatic` ships as rule v3 in 0.4.1 (parameter and destructuring
  defaults count as decisions). `core.cognitive` ships as v2 (plain else +1;
  ternary +1 plus nesting, also in the else position; a run of like
  operators counts once per expression, not across expressions; `||` counts
  per spec). Neither is a new detector, so neither gets a sample row — but
  TP/FP classification of any sampled finding reads cc/cognitive under the
  v3/v2 semantics, and composites that cite them inherit the new values.
- Generality pre-check for #705: `research/effect-pack-generality.md` @
  8652782 (the bare-`throw` flag is why the exception-style leg reports
  separately with the 0.8 fallback).
- Length v2 on the private-app refresh: expectation handed to pulsar-fidelity
  (77 v1 findings → ~44 v2: 43 structured + 1 linear >300).
