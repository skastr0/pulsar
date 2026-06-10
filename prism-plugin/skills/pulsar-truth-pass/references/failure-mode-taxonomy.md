# Detector failure-mode taxonomy

The recurring classes found across two truth passes (TS pack, rs-pack) and
the aggregation rework. Use as a review checklist for new detectors and
packs; the historical anchors are evidence the class is real, not templates
to pattern-match against — most future instances will be milder.

## 1. Score cliffs

Discontinuous score response to a continuous input. A 0.0001 change in one
signal must never step a verdict.
*Anchor:* the aggregator itself had two cliffs (`localSignalPressure`
jumped 0→0.3 at warn, 0.5625→0.75 at poison); a 0.0014 margin decided a
repo's headline color. Fixed with the continuous poison ramp + grid-sweep
continuity tests.

## 2. Population mismatch (ratio incoherence)

Numerator and denominator drawn from different sets, or sibling counts
summing different populations.
*Anchor:* RS-LD-03 counted closed-domain catch-alls over ALL matches —
stringly-refactoring an enum match (more erosion) raised the score.

## 3. Missing evidence floors

One finding on a tiny denominator zeroes a signal.
*Anchor:* one catch-all in a one-match repo scored 0; the shared pattern is
`min(1, evidence/FLOOR)` (RS-DE-01's 10-impl floor, TS-AD-04, TS-AB-04).

## 4. Monotonicity violations

More erosion produces a higher score, usually from floors/caps interacting
with posture switches or growing denominators.
*Anchor:* RS-LD-04's 0.5 uniform floor applied only at granularCount==0 —
collapsing the last granular error raised the score from 0.01 to 0.5;
RS-DE-02 adding packages could raise the score.

## 5. Authority overreach (tier-washing)

Heuristic or reference-backed evidence exercising verdict-grade authority:
block severity, headline poison, or a self-declared proof-grade tier.
*Anchor:* TS-SEC-03 (entropy heuristic) self-declared tier 1 and block
severity, false-blocking 4/6 fleet repos; a tier-1 *legibility* signal
(function-size) set a repo verdict its auditor rejected. Structural fixes:
`enforceSeverityCeiling`, `hasPoisonAuthority` (tier AND ceiling),
`assertReferenceDataTierFloor`.

## 6. Name-token semantics where resolution is required

Deciding locality/identity by bare-name or substring matching instead of
resolving paths/imports.
*Anchor:* `symbolRoot` read `crate::module::Trait`'s root as
"crate::module", scoring every 3+ segment local path as foreign coupling;
the same class recurred independently in RS-AB-02. Allowlists matching
final path segments only are the same disease.

## 7. Constants, not measurements

A repo class structurally pinned to one score regardless of its qualities.
*Anchor:* SHARED-02 bus factor scored 0.65 on every solo repo; RS-DE-02
breadth pressure hit its cap at 305 lockfile packages (every production
service pays the same tax). Fix: `not_applicable` for vacuous domains, or
redesign the scale.

## 8. Engine facts reported as quality facts

Tool failures, missing data, or environment differences surfacing on the
quality scale.
*Anchor:* one crashed signal zeroed a repo's headline (rs-pack first
contact displayed two healthy repos at 0.00); ambient `@types` resolution
made scores cwd-dependent (fixed by pinning `types: []`). Failures shape
`status`; the score describes what WAS measured; determinism is re-checked
after every aggregation change.

## 9. Citation and message dishonesty

Diagnostics citing nonexistent paths, mislabeled drivers, or claims the
math contradicts.
*Anchor:* SHARED-03 cited a deleted file at churn 1.0; RS-SL-04 labeled
the module count "(driving score)" while the repo total drove it;
inventory diagnostics claimed "not score-bearing" while diluting the
denominator.

## 10. Vacuous or self-silencing tests

Tests that pass when the feature is deleted, fixtures patched to silence a
detector instead of pinning it, contract prose certifying tests that do
not exist.
*Anchor:* RS-DE-02's unused-dependency detection — its own commit's
headline feature — had zero positive-direction coverage; stubbing it to
return nothing passed the full suite. The score floor had no test, and an
agent deleted the floor mid-review without any failure. Pin every claimed
behavior in the direction that matters.

## 11. Compiler/language reality gaps

The detector's model of the language misses idioms the compiler mandates
or the ecosystem standardizes.
*Anchor:* byte-char literals (`b'a'`) not recognized as open-domain
evidence; `#[non_exhaustive]` requiring catch-alls; `#![cfg(test)]` inner
attributes gating whole files; std::ops/Send/Sync/serde::de::Visitor
impls scored as coupling debt. New-pack rule: enumerate the compiler's
mandates and the ecosystem's idioms before scoring deviations from them.

## 12. Perverse incentives

Any scoring rule a rational agent would satisfy by making code worse.
Check explicitly: for each exemption or denominator, ask "what is the
cheapest way to satisfy this, and is it an improvement?"
*Anchor:* the LD-03 population mismatch rewarded stringly dispatch (#2);
exemption-by-literal-arms rewarded removing typed enums.
