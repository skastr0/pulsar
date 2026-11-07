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

## Core

- **Detectors.** Generic and deterministic. Graph and history first (cycles, duplication, unused exports, boundaries, coupling, churn, co-change), then syntax-level ones. Each detector ships with laws in `LAWS.bend`, proven in `PROOF.bend` and passing `--verdict`.
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

- One native binary compiled from Bend. Users need no Bend, Lean or clang. Contributors and CI need Bend, clang and Lean 4.34 (for `--verdict`).
- Parser: open. Either a Bend scanner/parser (go only if it stays under about 10k lines and is competitive on speed), or an external parser that emits facts in a line format, which keeps the parser outside the proofs.

## Open decisions

1. Parser route, decided on the Bend scanner speed results.
2. Whether completeness laws are required for each detector, or soundness alone (no false positives) is the bar.
3. Which detectors make the first cut.
