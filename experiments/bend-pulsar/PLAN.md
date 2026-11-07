# Pulsar rewrite: plan, staff and detector catalog

Scope: `PRODUCT.md`. Contract between the CLI and the engine: `FACTS.md`. Rules: `/AGENTS.md`.

Languages, in priority order: **TypeScript (with a full Effect pack), Rust, Bend.** Others come later through tree-sitter.

## Staff

| Seat | Owns | Model |
|---|---|---|
| **Lead** | `PRODUCT.md`, `FACTS.md`, this plan, integration, reviewing and committing every lane's work. | Opus |
| **Engine** | The Bend fact store, the detectors, composites, per-sha delta, `LAWS.bend`/`PROOF.bend`, negative controls. Two seats once syntax detectors start: graph and history in one, function-level metrics and composites in the other. | Opus for proofs |
| **CLI** | The Rust `pulsar` binary: args, git, cache in `~/.pulsar`, the `.pulsar/` policy and its fingerprint, finding identity, delta, output, exit codes, npm packaging. | Sonnet high |
| **TS adapter** | oxc facts (functions, branches, errors, casts, symbols, exports), `oxc_resolver`, and the tsrs type lane. | Sonnet high |
| **Effect pack** | Effect fact extraction: services, layers, `Effect.fn`, error channels, Schema, `@effect/sql` queries. The pack's catalogs, and the corpus `~/playground/effect`. | Sonnet high |
| **Rust adapter** | Rust facts: `cargo metadata`, the module tree, syntax facts, and the type-lane research and build. | Sonnet high |
| **Bend adapter** | Bend 2 facts. A small Rust parser written from `bend guide`, unless the Bend CLI can already dump a syntax tree. | Sonnet high |
| **History and coverage** | Git history facts (commits, churn, co-change). Coverage ingest: Vitest (Istanbul `coverage-final.json`, lcov) and `cargo llvm-cov` lcov. | Sonnet high |
| **Fidelity** | The corpora, differential tests against references, the memory and speed gate on every hot-path change, and the baselines. | Sonnet high |
| **Research** | Evidence that each detector generalises, written under `research/`, before the detector becomes a default. | Sonnet high |

## Corpora

- **TypeScript:** pulsar, junto, `~/playground/effect`. This covers Effect itself, about 2,000 TS files, including `packages/sql/pg`.
- **Rust:** at least two unrelated crates, chosen by Fidelity, plus `experiments/bend-pulsar/cli`.
- **Bend:** `experiments/bend-pulsar` itself. Pulsar runs on its own engine.

Use snapshots, never the live repos.

## Storage

- **`.pulsar/` in the repo (committed, diff friendly, fingerprinted):**
  - `policy.toml`: scope globs, packs on or off, thresholds that override defaults.
  - `catalogs/*.toml`: the repo's data. Which calls are queries, which are blocking, which read ambient state, layer rules, house patterns.
  - `decisions`: one line per finding key, with the decision and the reason.
  - `baseline`: sorted finding keys.
  - Every file is sorted and one item per line, so a reviewer agent can read the diff.
- **`~/.pulsar/` (never committed):**
  - `cache/<repo-key>/blobs/<oid>.<adapter-version>`: base facts per git blob.
  - `cache/<repo-key>/shas/<sha>`: derived facts and findings.
  - `policy.toml`: the organization fallback only. Output says when it's used.
- **The CLI documents the catalog format** (`pulsar catalog --help`, `pulsar explain <rule>`) well enough for an agent to write a repo catalog without reading Pulsar's source.

## Tasks

**Phase 0, cycles end to end (running).**
- The Rust CLI emits facts for TS and passes the edge diff against 0.3.0.
- The Bend engine reads facts, and its laws pass `--verdict`.

**Phase 1, the product spine.**
1. Finding identity: stable keys (path, container chain, name, kind, ordinal), never line numbers.
2. Per-sha cache in `~/.pulsar`, keyed by blob, with early cutoff on an unchanged interface.
3. `pulsar delta <base> <head>`: findings added and removed, text and JSON lines, scriptable exit codes.
4. The `.pulsar/` policy: format, canonical fingerprint, the org fallback, rule IDs on every affected finding.
5. Inline allows (ticket, reason, expiry), and decisions.
6. Replace the npm binary with a version bump, then delete `packages/`.

**Phase 2, TypeScript syntax facts and detectors.** This lane needs no types. Detectors: catalog groups A, B, C, D and F.

**Phase 3, the Effect pack.** Catalog group E.
- Learn Effect from `LLMS.md`, `ai-docs/` and `.agents/AGENTS.md` in `~/playground/effect` (Effect 4 API: `Context.Service`, `Effect.fn`, `Layer`).
- The Effect repo's own guidelines become candidate pack rules. Each one needs evidence that it applies beyond that repo before it ships on by default.

**Phase 4, history and coverage.**
- Vitest coverage out of the box: `coverage-final.json` (the default `json` reporter) and lcov. Cobertura is optional.
- Rust coverage: `cargo llvm-cov --lcov`.
- Then CRAP, churn, hotspots, co-change and the "risky change" composite.

**Phase 5, Rust.**
- Module and crate graph from `cargo metadata` plus `mod`/`use`.
- Syntax detectors, the same groups as TypeScript.
- Type-lane research: rust-analyzer as a library (`ra_ap_*` crates), versus rust-analyzer's SCIP output, versus rustc's own output. Measure memory on the corpora, then build the winner.

**Phase 6, Bend.**
- Module graph (`import`).
- Function and branch facts.
- `@unsafe` and `?TODO` counts.
- Proof-gate facts: which laws exist for which functions.

**Phase 7, data and performance.** Catalog group G.
- SQL facts from migrations and from `sql` tagged templates. `@effect/sql-pg` is supported out of the box through the Effect pack's catalog.
- Repo catalogs supply everything else.

**Phase 8, the TypeScript type lane (tsrs).** Inferred `any`, floating promises, exact Effect error and requirement channels. It's opt-in because of memory, not because of tsrs maturity.

**Phase 9, ship.** Linux build, Homebrew formula, npm per-platform binaries, licence notices.

## Detector catalog

**Lanes:**
- **S** = syntax only;
- **R** = module or name resolution;
- **T** = type lane;
- **G** = git history;
- **C** = coverage.

**Status:**
- **core** = generic default, which needs research evidence first;
- **pack** = framework-specific, switched on by evidence;
- **repo** = mechanism in core, patterns from the repo's catalog.

**A. Errors**

| Detector | Lane | Status |
|---|---|---|
| Swallowed error: an empty catch, a catch that only logs, a promise `.catch(() => {})` | S | core |
| A thrown error that loses its cause (rethrow without `cause`) | S | core |
| `throw` of a non-Error value | S/T | core |
| Rust: a `Result` discarded (`let _ =`, `.ok()` dropped), `unwrap`/`expect`/`panic!` outside tests | S | core |
| Effect: `catchAll`/`catch` to `void`, `orDie` or `ignore` on a typed error, `throw` inside `Effect.gen`, untagged errors (`new Error` in the error channel) | S, exact with T | pack |

**B. Type safety**

| Detector | Lane | Status |
|---|---|---|
| Explicit `any`, `as` casts, `as unknown as`, non-null `!`, `@ts-ignore`/`@ts-expect-error`, the `Function` type | S | core |
| Inferred `any`, unsafe member access on `any` | T | core |
| Rust: `unsafe` blocks, `transmute`, truncating `as` numeric casts, `#[allow(...)]` | S | core |
| Bend: `@unsafe`, `?TODO`, foreign code | S | core |
| Suppression debt: every lint and type suppression, added or removed per sha | S | core |

**C. Combinatorics and control flow**

| Detector | Lane | Status |
|---|---|---|
| NPath complexity, the number of acyclic paths (Nejmeh 1988), with an explicit threshold | S | core |
| Cyclomatic and cognitive complexity, nesting depth, function length | S | core |
| Boolean flag parameters, and functions with many optional parameters (callers' combinations multiply) | S | core, needs research |
| A non-exhaustive branch on a finite set (a `switch` over a union with no `never` check; a Rust `_ =>` over an enum) | S, exact with T | core |

**D. Implicit structure**

| Detector | Lane | Status |
|---|---|---|
| Implicit state machine: a variable or field assigned from a finite set of literals at k or more sites and branched on at k or more sites, with no single transition function | S | core, needs research |
| Stringly typed: the same string literals compared in many files where no union or enum names them | S | core, needs research |
| Ambient reads: environment, clock, random or global mutable state read outside the boundary modules the repo names | S | repo (the catalog lists the reads; Effect's list is in the pack) |
| Module-level mutable state (`let` at module scope, Rust `static mut`, singletons) | S | core |

**E. Effect pack**

| Detector | Lane | Status |
|---|---|---|
| The service and layer graph: services (`Context.Service`, `Effect.Service`, tags), layers, `Layer.provide`/`provideMerge`/`merge`, and `yield*` of a service | S, exact R channel with T | pack |
| On that graph: layer cycles, a service built in two places, a requirement never provided, hub services, a layer used across a boundary the repo forbids | S/T | pack |
| `Effect.runPromise`/`runSync` inside Effect code (escaping the runtime) | S | pack |
| A `fork` without a scope or join, and resources acquired outside `acquireRelease`/`Scope` | S | pack |
| A Schema and a hand-written type describing the same shape (contract drift) | S/T | pack |
| `@effect/sql` queries: `sql` templates, `SqlResolver`, `SqlSchema`, `Model.makeRepository`, as query facts for group G | S | pack |

**F. Architecture and duplication**

| Detector | Lane | Status |
|---|---|---|
| Import cycles (proven, running) | R | core |
| Boundary violations against the repo's layer rules | R | repo |
| Unused exports, dead modules | R | core |
| Clones: duplicated function bodies after normalising names | S | core |
| Duplicated contracts: structurally equal types, interfaces or schemas defined in two or more places | S, exact with T | core, needs research |
| Public API churn per sha: exports added, removed or changed | R | core |
| Rust: crate cycles, trait-impl fan-in, `pub` surface churn | R | core |

**G. Data and performance** (see `research/data-perf-detectors.md`)

| Detector | Lane | Status |
|---|---|---|
| A query call reachable from a loop (N+1) | R, call graph | repo, plus the pack catalog |
| A blocking call in async or Effect code | R | repo, plus the pack catalog |
| A foreign key with no covering index | schema | core |
| A query filtering on a column with no index, reported only on a hot path | schema + R | core |
| Static hot-path weight, used to rank findings rather than produce them | R | core |

**H. History and coverage** (see `research/composite-signals.md`)

| Detector | Lane | Status |
|---|---|---|
| Churn concentration, with bots excluded by the catalog | G | core |
| Hotspot: high complexity and high churn | S+G | core |
| CRAP: complexity and missing coverage, per function | S+C | core, needs research |
| Risky change: CRAP and churn | S+C+G | core composite |
| Co-change not explained by imports | R+G | core |
| A changed function with no covering test in the same sha | S+C+G | core |

## Open questions for research

1. The best way to get Rust types into facts within the memory bar.
2. Whether Bend 2 can dump a syntax tree, or needs its own small parser.
3. Evidence for each "needs research" row.
