# Signal Authoring

This is the production checklist for adding or changing Pulsar signals. It
applies to built-in packs, shared signals, and future first-party packs.
Prototype documents may explore signal shapes, but this file is the canonical
bar for production work.

## Core Rule

A signal is acceptable only when its claim, substrate, score semantics, and
failure modes are explicit and tested on real repository-shaped fixtures.

Do not add a signal because a score feels useful. Add it when the evidence can
support the claim and the implementation can prove that claim deterministically.

## Routing

Use Forge for ordinary implementation, refactoring, and tests.

Use Oracle before implementation when a signal depends on taste, enforcement
authority, an unclear legitimacy boundary, or a disputed taxonomy.

Use Survey before implementation when the signal's evidence claim depends on
external research, empirical support, or framework-specific facts not already
encoded in the repo.

## Signal Contract

Every production signal must have an explicit contract, either in the signal
source, its test matrix entry, or a directly linked design document.

Required fields:

- `signal id`: canonical id and aliases.
- `kind`: primitive or compound.
- `tier`: provability tier and enforcement ceiling.
- `evidence class`: syntax, type, runtime boundary, domain invariant,
  architecture dependency, temporal history, test/coverage, ownership,
  model/proof, AI-labeled fact, or repo policy.
- `claim shape`: the strongest legitimate claim the signal can make.
- `non-claim shape`: what the signal must not imply.
- `applicable region`: language, framework, file role, architectural tier,
  risk tier, boundary, or declared repo fact.
- `absence semantics`: how the output distinguishes zero, absent, unknown,
  not configured, insufficient evidence, and not applicable states.
- `calibration surface`: slot id, policy type, rule provenance, and
  deweight/non-applicable behavior when the interpretation is taste-laden.
- `composite consumers`: named composite diagnoses that use this primitive, or
  a statement that the signal is a standalone structural check.
- `enforcement ceiling`: hard gate, soft gate, review route, informational, or
  research-only.
- `cache contributors`: config, calibration, input facts, source artifacts,
  reference data, project modules, or AI label artifacts that affect output.
- `known false positives`: at least one concrete pattern, or an explicit note
  that none is known yet.
- `known false negatives`: at least one concrete pattern, or an explicit note
  that none is known yet.

## Required Test Evidence

Every registered signal must appear in its pack's signal contract matrix and
cite evidence for these categories:

- `identity`: registration exposes the canonical id, aliases, title, tier, kind,
  and cache version expected by the pack.
- `config`: defaults and config schema decode correctly, including sanitized
  thresholds and diagnostic limits.
- `positiveFixture`: a real fixture produces the intended pressure.
- `negativeFixture`: a real fixture that should not produce pressure stays
  healthy.
- `applicability`: empty, missing, not-configured, insufficient-evidence, and
  not-applicable states are explicit where relevant.
- `score`: score movement matches the declared semantics, including thresholds,
  floors, monotonicity, and neutral states.
- `diagnostics`: diagnostics are deterministic, bounded, located, stable, and
  do not overclaim.
- `factorLedger`: score-affecting config, calibration, and policy factors are
  visible in the factor ledger.
- `cacheSemantics`: cache versions and dependency fingerprints change whenever
  score, output, diagnostics, input interpretation, reference data, or
  calibration semantics change.

Add conditional evidence when relevant:

- `compoundInputs`: required for compound signals or signals with declared
  inputs.
- `gitContext`: required when git revision, diff, history, blame, or worktree
  state can affect output.
- `referenceData`: required when conventions, glossaries, coverage reports,
  lockfiles, manifests, AI facts, or other external facts affect output.
- `calibration`: required when project modules or policy slots can change
  interpretation or score pressure.
- `integration`: required when the observer, CLI, built package, or cross-pack
  execution path is part of the correctness claim.

## Fixture Substrates

Tests should run the same substrate the signal uses in production.

- TypeScript signals should use real `ts-morph` projects or repository
  fixtures, not mocked score blobs.
- Rust signals should use real Cargo/tree-sitter/RustProjectLayer fixtures.
- Shared history signals should use git repositories or structured history
  fixtures that exercise the real history loader.
- CLI and observer assertions should run the real observer or CLI path when the
  signal contract includes integration behavior.
- Composite signals should consume actual primitive outputs or intentionally
  shaped primitive-output fixtures that preserve absence states and raw values.

Mocking is acceptable only around slow or external boundaries, and the mock must
preserve the public substrate contract being tested.

## Primitive Signal Checklist

Before adding a primitive signal:

- Name the evidence class and claim limit.
- Decide absence semantics before writing score code.
- Choose the real substrate and fixture style.
- Add positive, negative, empty, and edge fixtures.
- Add missing/not-configured/insufficient-evidence fixtures where applicable.
- Add or justify the calibration surface if interpretation is taste-laden.
- Declare composite consumers, unless the signal is a standalone structural
  check.
- Define diagnostic ordering, severity, location, hash, and data payloads.
- Define factor ledger entries for every score-affecting config or policy.
- Define cache contributors and bump `cacheVersion` for semantic changes.
- Add the signal to the pack registry and the pack signal contract matrix in
  the same change.

## Composite Signal Checklist

Before adding a composite signal:

- List required and optional primitive inputs.
- Give every input an alias, factor path, weight, and cache fingerprint when
  raw extraction or normalization uses callback-backed logic.
- Preserve raw primitive values and domain-specific absence states in the
  composite explanation.
- Keep required-input absence neutral unless an explicit repo or product policy
  says otherwise.
- Prove final score semantics independently from primitive signal tests.
- Add at least one fixture where ranking changes because of non-size or
  non-count inputs.
- Assert primitive ids, aliases, raw values, normalized values, missing inputs,
  weights, final score, rationale, enforcement ceiling, and diagnostics.

## Review Gates

A signal is not ready when:

- the score claims more than the evidence can prove;
- missing evidence is treated as healthy zero;
- diagnostics are plausible prose without reproducible source evidence;
- config or calibration affects score without factor-ledger attribution;
- score-affecting reference data or calibration is absent from cache semantics;
- tests assert only a final score and not the underlying evidence;
- CLI or observer behavior is claimed without exercising that path;
- taste-laden interpretation lands in generic defaults without explicit
  calibration or a documented non-tunable rationale.

## Validation

Use `bun` for all checks.

For a narrow signal change, run the affected package tests and the contract
matrix test. For cross-pack, CLI, observer, cache, or public-surface changes,
run:

```bash
bun run verify
```

The minimum acceptable final state for a production signal change is:

- the signal is registered exactly once;
- the contract matrix covers the registered signal id;
- there are no `pending` contract entries unless the work intentionally lands
  as incomplete and is not part of a production release;
- all cited evidence points to executable tests or explicit docs;
- cache and factor-ledger behavior are covered when score semantics change.
