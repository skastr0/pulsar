# Effect pack generality survey — classes 14/15 and the interop exemption (#705)

Pre-ship check requested by the lead: do the #705 constructs generalise across
unrelated Effect repos, and is the ctx-32 interop exemption load-bearing rather
than speculative? Aggregate counts only; nothing here names a private repo,
path or symbol.

## Corpora and method

- **15 TypeScript repos** in `~/playground/effect-*` (public playground corpus;
  one of the 16 directories holds no TS sources and is excluded).
- **A private Effect + SQLite + Cloudflare app** (the low-noise control: already
  Effect-first).
- **A private Effect + React monorepo** (the motivating mixed codebase, mid
  Effect conversion).

Method: ripgrep census over `*.ts`/`*.tsx` (node_modules, dist, build, coverage
and `*.d.ts` excluded). Two passes: (a) occurrence counts of each construct;
(b) file-set intersections approximating what the engine sees — a file counts
for a class when it contains the construct, restricted to files that import
`effect`/`@effect/*` and whose path is not test-shaped (`test|spec|__tests__`).
Occurrence counts include comments and strings, so they are upper bounds; file
counts are the steadier signal. "Effect file" is an import-based proxy for the
policy's `effect_only` scope; the real gate is the repo's `[packs.effect]`
globs.

## Counts (effect-importing, non-test-path files)

| corpus | TS files | effect files | class-14 files | class-15 files | await | async | .then/.catch/.finally | new Promise | Promise.* | throw | try{} |
|---|---|---|---|---|---|---|---|---|---|---|---|
| playground ×15 total | 733 | 471 | 78 | 30 | 110 | 113 | 42 | 13 | 6 | 57 | 25 |
| private CF app | 410 | 105 | 25 | 18 | 143 | 92 | 20 | 1 | 3 | 20 | 34 |
| private monorepo | 3,751 | 641 | 229 | 225 | 1,948 | 879 | 528 | 111 | 76 | 808 | 630 |

Per-repo spread in the playground corpus is wide: two repos are fully Effect
(0 hits of either class) while workshop/intro repos carry 20+ class-14 files.
That is the expected shape for an opt-in, evidence-switched pack.

## Per-rule verdicts

**Class 14 (promise-style) generalises.** `await`/`async`/`.then`-family/
`new Promise`/`Promise.*` occur in 14 of 15 playground repos and both private
repos. `.finally(` is nearly absent everywhere (0–2 per corpus) and
`Promise.all/race/allSettled/any` is rare; the mass is `await`, `async`
functions and `.then`/`.catch` member calls. `new Promise` and the `Promise.*`
statics are real but minor — keep them in the class, expect few findings.

**Class 15 (exception-style) generalises, with one precision flag.** `throw`
and `try {}` appear in ~9 playground repos and both private repos. The flag:
bare `throw` is dense in *idiomatic* Effect library internals — one public
Effect-style repo shows 20 `throw` sites and **0** `try` blocks, all inside
plain synchronous combinator functions (schema/builder helpers), not inside
`Effect.gen`/`Effect.fn` bodies. Under rule (1) as designed (classes 14+15 in
`effect_only` scope), such a repo yields ~20 findings whose value is debatable:
the code is exception-style but not promise-style, and it is not inside a
generator. Options, for the implementer and lead to weigh: (a) keep rule (1)
broad and let the precision protocol measure it; (b) restrict rule (1)'s
class-15 leg to `try` blocks and leave bare `throw` to rule (4), which is
scoped inside `Effect.gen`/`Effect.fn` where the finding is sharpest; (c)
document that `effect_only` globs should exclude pure-internal helper dirs.
Recommend (a) for the first cut — the protocol exists to measure exactly this
— with (b) as the fallback if class-15 precision is poor.

**Rule (3) mixed-module is viable.** Files containing both an `async` marker
and an `Effect.gen`/`Effect.fn` site (file-level upper bound): 9 of 15
playground repos (0–10 files each), 38 files in the private CF app, 225 in the
private monorepo. Boundary-shaped files inflate the private numbers; policy
scoping decides the real count.

**Rule (4) throw-or-try-in-gen has real surface area.** Files containing both
a class-15 construct and an `Effect.gen`/`Effect.fn` site: present in ~12
playground repos, 16 files in the private CF app, 197 in the private monorepo.
File co-occurrence overstates it — the throw may sit in a sibling function —
so the true inside-body rate is an engine/AST question; the precision protocol
measures it on real findings.

**Rule (2) internal-promise-bridge cannot be censused syntactically.** It
needs the CE call edges from #693 plus class-14 membership of the callee;
defer to the engine run. Its precision is covered by the same protocol.

**Rule (5) per-sha counts generalise trivially** — it reports the same
construct census as metric rows.

## The interop exemption (ctx 32) is load-bearing

`Effect.try|tryPromise|promise|sync|callback|async` sites appear in
effect-importing non-test files across every corpus that uses generators:
0–17 files per playground repo, 22 files (68 sites) in the private CF app, 209
files in the private monorepo. In the monorepo, 209 files contain both a
wrapper site and a throw/await/async marker — the overlap the exemption exists
for. Effect's own docs throw and `await` inside `tryPromise`/`try` callbacks,
so without ctx 32 rule (1) would flag documented idiom. The exemption is not
speculative; it is required for precision.

## Boundary concentration (private CF app detail, aggregate only)

In the already-Effect-first private app, `await`/`async` inside
effect-importing non-test files concentrate in the deployable worker entry
(14 files) plus a handful of package files and scripts — exactly the shape the
`boundary` glob list exists to exempt. If a repo's `boundary` globs under-cover
its adapter/entry dirs, rule (1) floods; the policy author carries that load.
Test-shaped paths are covered by the ctx-4 bit, but note the bit is
path-based: test harnesses living under `src/` (fixture/world modules) are not
matched — they escape ctx 4, though they also do not import `effect` and so
stay out of `effect_only` scope unless the policy globs reach them.

## Caveats

- Occurrence counts include comments/strings; file counts are the signal.
- `.catch(` counts subtract `Effect.catch(`-family sites only approximately.
- Callback-style error handling (node-style `(err, value)` callbacks) is in
  the class description but was not censused — it is rare in these corpora.
- "Effect file" = imports `effect`/`@effect/*`; a file can use Effect types
  without importing (re-exports) and be missed, and a file can import effect
  for one type and be mostly promise code — both directions exist.
