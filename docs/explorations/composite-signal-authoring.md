# Composite Signal Authoring

## Purpose

Composite signals turn multiple deterministic facts into one deterministic
diagnostic hypothesis. They are not a place to smuggle human taste, model
judgment, or hidden project exceptions. A composite is valid when a reader can
trace the result from named primitive outputs, through declared normalization
and weights, into a visible score and rationale.

The current executable SDK lives in
[packages/core/src/composite.ts](../../packages/core/src/composite.ts) and is
tested in
[packages/core/src/__tests__/composite.test.ts](../../packages/core/src/__tests__/composite.test.ts).
`TS-RP-01-hotspots` is the reference mixed-pack implementation across
[packages/ts-pack/src/signals/ts-rp-01-hotspot-model.ts](../../packages/ts-pack/src/signals/ts-rp-01-hotspot-model.ts)
and the signal registration in
[packages/ts-pack/src/signals/ts-rp-01-hotspots.ts](../../packages/ts-pack/src/signals/ts-rp-01-hotspots.ts).

## Mental Model

Pulsar has four separate interpretation layers:

1. Primitive signals collect raw evidence.
2. Calibration processors interpret evidence under repo, framework, or
   technology policy.
3. The active vector decides how much the repository cares about each signal.
4. Composite signals diagnose interactions between primitive facts.

A composite should not make a raw fact more true. It should state a narrower
diagnosis such as "review risk is high because churn, complexity, ownership
concentration, coverage gap, and logical coupling are all present."

Composites must not claim:

- design intent;
- business correctness;
- security correctness;
- that missing input facts are healthy;
- that a score explains itself without the primitive values and policy that
  produced it.

## Composite Contract

Every production composite must define:

- primitive input ids and aliases;
- whether each input is required or optional;
- a stable factor path for each input;
- a weight for each input;
- raw value extraction for explanation output;
- normalization semantics for comparable scoring;
- missing-input handling;
- final score semantics;
- rationale text;
- enforcement ceiling;
- cache and fingerprint contributors.

The SDK exposes three helper functions:

- `compositeSignalInputs(specs)`: converts author specs into signal input
  dependencies and produces cache fingerprints for the input policy.
- `resolveCompositeInputs(specs, inputOutputs)`: resolves canonical ids and
  aliases from upstream signal outputs.
- `buildCompositeExplanation(args)`: builds the public explanation with
  primitive inputs, raw values, normalized values, missing inputs, weights,
  final score, rationale, and enforcement ceiling.

The SDK input state is intentionally small:

- `present`;
- `missing_optional`;
- `missing_required`.

Domain-specific absence states belong in primitive outputs or composite output
metadata. For example, coverage can be `absent`, `unknown`, `not_configured`,
or `zero`; the composite SDK only knows whether the coverage output was
provided. `TS-RP-01-hotspots` therefore exposes `inputFactStates` separately
from SDK input presence.

## Cache Contract

Composite cache correctness has two levels.

Input policy fingerprints are produced from:

- aliases;
- optionality;
- factor path;
- weight;
- declared semantic `cacheFingerprint`.

If an input spec uses `rawValue` or `normalize`, it must declare
`cacheFingerprint`. Function source text is not enough because helpers can
change transitively. Bump the fingerprint whenever raw extraction,
normalization, or input interpretation changes.

Signal-level `cacheVersion` is still required when the composite's score,
ranking, output shape, or diagnostic semantics change. `TS-RP-01-hotspots`
sets `cacheVersion: "risk-hotspot-v2-composite-policy-v1"` in
[packages/ts-pack/src/signals/ts-rp-01-hotspots.ts](../../packages/ts-pack/src/signals/ts-rp-01-hotspots.ts)
for the Risk Hotspot v2 semantic shift.

## TypeScript Composite Example

This is the smallest useful shape for a language-specific composite:

```ts
const INPUTS = [
  {
    id: "TS-LD-01-cyclomatic-complexity",
    aliases: ["TS-LD-01"],
    factorPath: "inputs.complexity",
    weight: 0.6,
    cacheFingerprint: "example-complexity-normalization-v1",
    rawValue: (value) => ({ maxComplexity: value.maxComplexity }),
    normalize: (value) => clamp01(value.maxComplexity / 50),
  },
  {
    id: "TS-LD-02-size-distribution",
    aliases: ["TS-LD-02"],
    factorPath: "inputs.size",
    weight: 0.4,
    cacheFingerprint: "example-size-normalization-v1",
    rawValue: (value) => ({ files: value.files.length }),
    normalize: (value) => clamp01(value.maxFileLoc / 1000),
  },
] satisfies ReadonlyArray<CompositeInputSpec>
```

The signal then uses:

```ts
inputs: compositeSignalInputs(INPUTS)
compute: (config, inputs) =>
  Effect.sync(() => {
    const resolved = resolveCompositeInputs(INPUTS, inputs)
    if (resolved.hasMissingRequiredInputs) {
      return neutralOutputWithExplanation(resolved)
    }
    return scoreResolvedFacts(resolved)
  })
```

This pattern is TypeScript-specific because both inputs are TypeScript pack
signals. The composite can still use shared SDK helpers and a standard
explanation.

## Shared Fact Example

Shared fact signals should be conservative. They collect facts that downstream
composites can interpret, but they should avoid hard project-specific meaning.

Examples already in the repo:

- `SHARED-CHURN-02-recency-weighted-churn` records decayed churn and raw window
  churn. It does not decide whether churn is bad.
- `SHARED-COV-01-coverage-facts` reads lcov and Istanbul coverage data. It
  distinguishes source states and leaves thresholds to downstream composites.
- `SHARED-COCHANGE-01-logical-coupling` emits co-change pairs with support,
  confidence, and timestamps. It does not decide whether a pair must be merged.

A shared fact output should expose:

- measured entities such as files, modules, commands, or pairs;
- source identity such as tool, path, git window, or manifest;
- absence state where source discovery can fail or not apply;
- `compositeConsumers` so new facts are justified by diagnostic use;
- cache contributors such as time window, parser version, or source artifact
  fingerprint;
- enforcement ceiling that is usually informational, trend, or review-routing.

## Mixed-Pack Example: Risk Hotspot v2

`TS-RP-01-hotspots` is now a mixed-pack composite. It keeps the canonical id
`TS-RP-01-hotspots` and alias `TS-RP-01`, but resolves both TypeScript and
shared primitive inputs:

- `TS-LD-01-cyclomatic-complexity`;
- `SHARED-CHURN-01-recent-churn`;
- `SHARED-CHURN-02-recency-weighted-churn`;
- `SHARED-02-bus-factor`;
- `SHARED-COV-01-coverage-facts`;
- `SHARED-COCHANGE-01-logical-coupling`.

Legacy behavior remains active when rich optional facts are absent. In that
mode, the score follows churn x complexity and the explanation still shows the
optional inputs as missing rather than silently ignoring them.

Risk Hotspot v2 activates when richer facts are present. Its output records:

- `riskModel`;
- `riskFilesConsidered`;
- `riskPressure`;
- per-file `riskFactors`;
- `inputFactStates` for recency-weighted churn, ownership, coverage, and
  co-change.

This split matters because SDK presence is not enough. Coverage output can be
present while coverage itself is `absent` or `unknown`. Ownership output can be
present but `not_applicable`. Co-change output can be present and measured as
`zero`. A composite that collapses those states into zero loses evidence.

## Signal Evidence Contract

Every production signal and composite should publish the following contract in
code comments, docs, or a future machine-readable registry.

```text
signal id:
aliases:
kind: primitive | compound
tier:
evidence class:
claim shape:
non-claim shape:
applicable region:
absence semantics:
calibration surface:
composite consumers:
enforcement ceiling:
cache contributors:
known false positives:
known false negatives:
```

Contract fields:

- `evidence class`: syntax, type, runtime boundary, domain invariant,
  architecture dependency, temporal history, test/coverage, ownership,
  model/proof, AI-labeled fact, or repo policy.
- `claim shape`: the strongest legitimate claim the signal can make.
- `non-claim shape`: what the signal cannot infer.
- `applicable region`: language, framework, file role, architectural tier, risk
  tier, boundary, or declared repo fact.
- `absence semantics`: how output distinguishes `zero`, `absent`, `unknown`,
  `not_configured`, and `not_applicable`.
- `calibration surface`: slot id, policy type, rule provenance, and
  deweight/non-applicable semantics.
- `composite consumers`: the named diagnoses that use this primitive.
- `enforcement ceiling`: hard gate, soft gate, review route, informational, or
  research-only.
- `cache contributors`: config, calibration, input facts, source artifacts,
  reference data, project modules, or AI label artifacts that affect output.
- `known false positives` and `known false negatives`: at least one concrete
  pattern each, or an explicit statement that none is currently known.

## Authoring Checklist

Before adding a primitive:

- Name the evidence class and claim limit.
- Decide whether absence means zero, absent, unknown, not configured, or not
  applicable.
- Declare at least one composite consumer, unless this is a standalone hard
  structural check.
- Add deterministic fixtures for measured, missing, and edge states.
- Add or justify the calibration surface if the interpretation is taste-laden.
- Declare the maximum enforcement level.
- Add cache/fingerprint tests for any score-affecting source, config, policy,
  or reference-data change.

Before adding a composite:

- List required and optional primitive inputs.
- Give every input a factor path and weight.
- Add raw value extraction and normalization for every score-bearing input.
- Declare `cacheFingerprint` for every input with callback-backed raw or
  normalized semantics.
- Keep required-input absence neutral unless the repo has explicitly accepted a
  different policy.
- Preserve domain-specific absence states in the composite output when SDK
  input presence is not enough.
- Snapshot or assert primitive ids, aliases, raw values, normalized values,
  missing inputs, weights, final score, rationale, and enforcement ceiling.
- Add at least one fixture where the composite ranking changes because of
  non-size or non-count inputs.
- Bump the signal `cacheVersion` when score, ranking, output shape, or
  diagnostic semantics change.

## Review Gates

A composite is not ready if:

- raw primitive outputs disappear behind a single score;
- optional input absence is treated as a healthy zero;
- weights or normalization are not visible;
- cache fingerprints do not change when input interpretation changes;
- the rationale claims intent or quality beyond the evidence;
- the signal can hard-gate without a low-false-positive evidence class and
  explicit repo acceptance;
- tests only prove the primitive signals work, not the composite interaction.

The review question is not "is the number plausible?" The review question is
"can a reader reproduce why this diagnostic exists, what evidence it used, what
it did not know, and what would make it improve?"

## TC-309 Validation Record

Validation type: markdown-only authoring artifact.

Local checks:

- `git diff --check -- docs/explorations/composite-signal-authoring.md` passed.

Independent reviews:

- Grok MCP blocker-only review: PASS on composite contract, examples, evidence
  contract, layer distinctions, checklist, and SDK/test references; one residual
  path-precision issue was addressed by linking the model and signal
  registration files separately.
- Normal requirements review: initial FAIL on missing markdown links and a
  missing validation record; addressed by adding explicit links to SDK,
  tests, reference implementation files, and this validation section.

Verification note:

- Full `bun run verify` was not rerun for TC-309 because the glyph is docs-only
  and does not change executable source, package metadata, tests, build inputs,
  or generated artifacts.
