# Pulsar Agent Guide

## Status: Pulsar is being rewritten

- **Where:** the new Pulsar is built in `experiments/bend-pulsar/`. Its scope is `experiments/bend-pulsar/PRODUCT.md`; read it before any work.
- **The old packages are legacy.** `packages/`, `scripts/` and the docs that describe vectors, personas, readiness and scoring are the 0.3.0 implementation. When the rewrite is usable, it replaces them and ships through the existing npm package as a version bump. No compatibility contract applies: there are no external users.
- **Don't add features to the legacy packages.** Touch them only to keep the build green, or when the rewrite needs to read something from them.
- **Move and delete, don't keep both.** Once a rewrite part is ready, delete the legacy code it replaces.

## Project intent

- **What it does:** deterministic, proven, low-memory checks of code and architecture health, for teams of peer agents. For a git sha, Pulsar reports which findings a change added or removed. Each finding names a file and symbol, and comes with the evidence a peer can check.
- **What it doesn't do:** no single score, no weighted blend, no grades.
- **Memory is a product requirement.** It runs beside many agents, on every sha. Measure peak memory on a large corpus for every change to a hot path.

## Non-negotiable invariants

Pulsar is repository-level, always.
- A repository's policy lives in its committed `.pulsar/` directory and is fingerprinted. Everyone working in the repo shares it.
- A home-directory policy is allowed only as an organization fallback. Output that uses it must say so. A repo-local policy always wins.
- There is no personal or per-agent policy.
- Anything that changes findings has to be visible: rule IDs, sources, activation evidence and fingerprints.

Pulsar's defaults are generic, always.
- A core detector must be statable without naming a technology, a framework or an incident. It needs evidence that it generalises across unrelated repositories. Record that evidence under `experiments/bend-pulsar/research/` or in the detector's notes.
- Anything learned from one repo stays in that repo's rules. Library-specific knowledge, such as which calls are database queries, is data supplied per framework or per repo. The mechanism belongs in core.
- Framework packs, such as an Effect pack, are switched on by evidence and named as framework-specific. They never redefine the generic baseline.
- Defaults must not encode one school of architecture taste.

## Architecture

- **Rust CLI:** handles arguments, git, config reading (tsconfig, package.json, manifests) and parsing. Parsing goes through external parsers: oxc for TypeScript syntax, tsrs for the opt-in type-aware lane, tree-sitter for other languages. The CLI writes compact facts with numeric IDs, runs the engine, and formats the output.
- **Bend engine:** holds the fact store, the detectors, composites and per-sha deltas. Every rule that decides a finding lives here, and the engine never holds source text.
- **Facts:**
  - Facts carry provenance. Detectors map facts to new facts, and composites are detectors over derived facts.
  - Thresholds live explicitly in the rules.
  - Facts are cached per sha and recomputed incrementally.
- **Type-aware detectors** run in a separate opt-in lane. The default lane needs no type checker.

## Proof rules

- **Laws are about the shipped code.** Every engine detector states laws in `LAWS.bend` about the functions the binary runs, never about a model of them. A law ties the binary's entry point to the proven functions.
- **Soundness is the minimum bar.** It means no false positives, proven unconditionally. A proven certificate checker in front of an unproven algorithm is acceptable.
- **Completeness is proven where it matters.** It may be proven relative to runtime certificates, which the binary must report.
- **The gate:**
  - `bend PROOF.bend --verdict` must pass.
  - No `@unsafe`, `?TODO` or foreign code in the engine.
- **Every new law gets a negative control:** a deliberate bug, in a scratch copy, that fails the gate.
- **Weakening a law** (adding a hypothesis, narrowing a quantifier) must be stated in the commit message.
- **Correctness against each language** is shown by differential testing against a reference on real repositories. It can't be proven. Keep the regression corpora and baselines passing.

## Clean room

- Learn from specs, papers, official docs and design write-ups. Existing tools serve only as test oracles. Don't read or port implementation source.
- Bundled components (oxc, tsrs, tree-sitter) are used as dependencies, under their own licences. Ship whatever third-party notices those licences require.

## Tooling

- **Bend:** `~/.bend/bin/bend`. Pin the version the engine was proven with. `bend x.bend -o x.c` emits C that plain clang builds, which is the packaging path.
- **Compilers:** clang 14+ (19+ for `!` parallel calls). Lean 4.34 through elan, for `--verdict`.
- **Rust:** stable with cargo, for the CLI and adapters.
- **Bun:** only for the legacy packages and their tests.

## Anti-patterns

- **Scores, weights, mixers, personas, readiness bands.** Instead: named findings with evidence, and an explicit rule threshold.
- **A detector built from one incident or one repo's taste.** Instead: a generic mechanism, with the repo's specifics as data.
- **Proofs about a copy or a model of the code.** Instead: laws over the shipped functions, plus a law linking the entry point.
- **Holding source text or syntax trees in the engine.** Instead: the adapter streams files and emits facts.
- **Hidden policy that changes findings.** Instead: committed, fingerprinted repo policy, with rule IDs on every finding it affects.
