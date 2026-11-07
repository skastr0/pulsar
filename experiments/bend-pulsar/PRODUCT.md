# Pulsar Bend: product scope

A clean-room rebuild: not a port of Pulsar 0.3.0. These are the decisions made so far, from the 2026-10-09 Junto post-mortem and the 2026-11-07 Bend PoC.

## What it is

A native, proven code-health tool for teams of peer agents. A seat runs it on a git sha. It answers: what did this change add or remove in code and architecture quality, as named findings with file and symbol. It answers fast enough to run on every sha, with memory low enough to run beside many agents.

## Readers

| Reader | Needs |
|---|---|
| The seat that made the commit | The findings its commit added or removed |
| A peer or reviewer seat | A finding it can check: file, symbol, introducing sha, a reproduce command |
| A lead | Which lanes accumulate debt over a commit range |
| The operator | A few trends and the exceptions |

## Facts model

- **One fact store.**
  - Language adapters emit base facts: modules, imports, symbols, definitions, references, functions and branches, commits.
  - Later fact kinds: types, SQL schema and queries.
- **Detectors are functions from facts to new facts.**
  - A composite detector (hotspot = complexity finding and high churn) is a detector whose inputs are derived facts.
  - Composition is unbounded, so detectors form a dependency graph.
- **Every fact carries provenance:** the facts it came from. A finding explains itself down to file and line.
- **Numbers.** Measured numbers may appear in facts. Thresholds live explicitly in the rule that derives a fact. Weighted blends are not allowed.
- **Incremental.** Facts are cached per sha, and a change recomputes only what is downstream of the files it touched.
- **Language-neutral detectors.** A new adapter gets every existing detector. A new detector works in every language with an adapter.
- **Framework packs** are switched on by evidence, such as an Effect pack when `effect` is in `package.json`. They are named as framework-specific and never change the generic defaults.

## Core

- **Detectors.** Generic and deterministic. Graph and history first (cycles, duplication, unused exports, boundaries, coupling, churn, co-change), then syntax-level ones.
  - Each detector ships with laws in `LAWS.bend`, proven in `PROOF.bend` and passing `--verdict`.
  - The minimum bar is soundness (no false positives), proven unconditionally, through a certificate checker where the algorithm itself is hard to prove.
  - Completeness is proven where it matters, and may be proven relative to runtime certificates that the binary reports.
- **Finding identity.** Stable across line shifts, keyed by symbol and path. Baseline, delta, allows and recorded decisions all share it.
- **Facts cached per sha.** A delta is the comparison of two cached fact sets, not a second engine.
- **Delta output.** The findings added and removed, plus counts. Plain text and machine-readable lines. Exit codes a script can act on.
- **The repo's policy.** One per repo, committed and fingerprinted (the invariant in AGENTS.md is unchanged):
  - scope: which paths are production, using real glob semantics;
  - inline allows with ticket, reason and expiry, honoured by every detector;
  - recorded decisions per finding (false positive, accepted debt, must fix), each with a reason;
  - house rules as pattern rules (mechanism in core, patterns in the repo).

## Out

Weighted means, categories, readiness, bands, personas, the quiz, backpressure, review routing, mixers, weights per signal, the legacy command family. The tool does not produce a single number.

## Guardrails

- A core detector must be statable without naming a technology, framework or incident. It needs evidence from several unrelated repos. Anything learned from one repo stays in that repo's rules.
- Every proof is about the shipped code, not a model of it.
- Clean room: learn from specs, papers and docs. Existing tools serve only as test oracles. No ported code.
- Scanner fidelity to the TypeScript grammar can't be proven. It is shown by differential testing against a reference on real repos.

## Runtime

- **The engine is native, compiled from Bend.**
  - `bend main.bend -o x.c` emits one C file, and plain `clang -O2` builds it with no Bend installed. Checked on macOS for bend-cycles: a 1.4 MB C file, a 5 s build, and a binary that links only libSystem.
  - Packagers such as Homebrew and npm can build from the generated C.
  - Contributors and CI need Bend, clang and Lean 4.34 (for `--verdict`). Users need none of them.
- **Parsers are external, written in Rust:** oxc for TypeScript syntax, tsrs for the opt-in type-aware lane, tree-sitter for other languages. They emit facts, and they sit outside the proofs.
  - Fidelity to each language is shown by differential testing.
  - Config reading (tsconfig, package.json) lives in the adapter.
- **Type-aware detectors run in a separate opt-in lane** that pays tsrs's memory. The default lane needs no type checker.
- **Windows:** not supported. Bend has no Windows target (WSL works).

## Decided (2026-11-07)

- **Process shape: a Rust CLI plus the Bend engine.**
  - Rust owns all text work: arguments, git, config, parsing and output formatting.
  - Bend receives only compact numeric facts, so it never pays for its slow strings.
- **Location: this repo, in `experiments/bend-pulsar/` until it is usable.**
  - It then replaces 0.3.0, ships through the existing npm package as a version bump, and the legacy packages are deleted.

## Open decisions

1. Which detectors make the first cut.
2. The fact format v0, informed by `research/fact-stores.md` and `research/fact-extraction.md`.
