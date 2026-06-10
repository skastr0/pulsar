---
name: pulsar-truth-pass
description: Pulsar's working method for signal and aggregation work — the truth-pass loop, the detector change checklist, the cheap agent validation harness, and release acceptance gates. Load whenever changing a pulsar signal, score curve, aggregation rule, or pack; when reviewing detector output against a real repo; when validating a release; or when adding a new language pack.
---

# Pulsar Truth Pass

Pulsar's product is trust: an agent either believes the verdicts or routes
around the tool. Truthfulness is therefore the adoption boundary, not a
quality bar. Every change to a signal, curve, or aggregator is judged by one
question: **does the output stay true on real repos, and can we prove it?**

Two standing principles, enforced in code:

- **Authority comes from evidence class.** Block severity requires a
  hard-gate ceiling (`enforceSeverityCeiling`); single-handedly setting a
  headline requires proof-grade tier AND hard-gate ceiling
  (`hasPoisonAuthority`); reference-data consumers may not claim tier 1/1.5
  (`assertReferenceDataTierFloor`). Never grant a verdict surface to
  evidence that cannot carry it.
- **Headlines summarize; minimums point.** The aggregate is max(p-norm,
  authority-gated poison ramp, hard gate). Engine faults (failed signals)
  shape `status`, never the score.

## The truth-pass loop

Run this loop whenever signal semantics change, a new pack lands, or fleet
scores look wrong. Each iteration is: verify → classify → fix → re-validate
→ encode.

1. **Baseline.** Scan the validation fleet (`pulsar score --json` per repo)
   into `.fleet-baselines/<label>/` (kept out of git via
   `.git/info/exclude`). Run scans from inside the worktree — writes outside
   it get sandboxed.
2. **Find.** A few frontier agents per scope, each with a distinct lens
   (detector-vs-language-reality, test honesty, score-curve sanity).
   Structured findings only: file, line, title, mechanism, severity. An
   empty findings list is an honest result. Finders are told to REFUTE the
   code, and to ground every claim in source they actually read.
3. **Verify cheaply.** Cluster findings by file; 2 haiku voters judge ALL of
   a file's findings in one read; escalate only splits/uncertains to the
   main model. Verifiers are READ-ONLY — say so explicitly in the prompt.
   Prefer probe-tests over reader votes when a finding reduces to "delete X
   or feed Y — does the suite notice?". Details and calibration method:
   [references/validation-harness.md](references/validation-harness.md).
4. **Fix fixture-first.** Write the regression fixture, watch it FAIL
   against current code, then fix, then add a positive control proving the
   signal still catches the real thing. One commit per signal or defect
   class. Run the per-fix checklist below.
5. **Re-validate.** Re-scan the fleet; build the band-vs-considered-verdict
   table. Acceptance gates: bands match auditor judgment on nearly every
   repo; ZERO dangerous-direction misses (nothing genuinely troubled goes
   green); real hard-gate blocks survive; determinism holds (identical JSON
   from two different cwds).
6. **Encode.** Every confirmed finding becomes a permanent fixture or a
   tracked work item with the evidence attached. Design-grade items go to
   the batch manifest with their measurements, not to memory. Check the new
   defect against the taxonomy —
   [references/failure-mode-taxonomy.md](references/failure-mode-taxonomy.md)
   — and if it is a new class, add it there.

## Detector change checklist

Apply to every signal/curve change, no exceptions:

- **Fixture-first**: the regression test failed before the fix; a positive
  control pins continued true-positive detection.
- **cacheVersion bump** whenever output semantics change — signal-level,
  plus `OBSERVER_AGGREGATION_CACHE_VERSION` for aggregation changes, plus
  every consumer of a changed shared helper (e.g. all
  `walkAttributedNodes` consumers). Update the pin tests; the pins exist to
  force conscious bumps.
- **Coherent populations**: every ratio's numerator and denominator are
  drawn from the same set, and every emitted count names its population.
- **No cliffs**: score curves are continuous; pin with a grid-sweep test
  (see `observer-local-pressure.test.ts` for the pattern).
- **Monotone**: more erosion can never raise the score; sweep-test when the
  curve has floors, caps, or posture switches.
- **Evidence floors**: a single finding on a small denominator must not
  zero a signal — `min(1, evidence/FLOOR)` scaling.
- **Constants are not measurements**: if a class of repo always produces
  the same score (solo-repo bus factor, ecosystem-normal lockfile size),
  the signal is not measuring — declare `not_applicable` or redesign.
- **Citation hygiene**: diagnostics never cite paths or symbols that do not
  exist at the scored commit.
- **Applicability coherence**: signals sharing an evidence base agree on
  applicability; providers declare `role: "provider"`.
- **Severity within ceiling**: claimed severity is licensed by
  `deriveEnforcement(tier, kind)`; the runtime guard downgrades overclaims
  but the signal should not rely on it.
- **stdout is a data channel**: anything machine-parseable stays clean;
  logs go to stderr (`cli-effect-runtime.ts`).

## Operational rules

- Run tests as `bun run test` (never bare `bun test` from the repo root —
  stale `dist/__tests__` copies run).
- While agents share the working tree: stage commits by explicit path
  (never `git add -A`), audit `git status` before every commit, and treat
  unexplained diffs as agent contamination to revert.
- Secret-shaped test fixtures are assembled at runtime from parts
  (`ts-sec-03.test.ts` pattern) — GitHub push protection scans test
  sources and blocks contiguous tokens.
- Concrete incidents behind these rules:
  [references/operational-pitfalls.md](references/operational-pitfalls.md).

## What NOT to do

- Do not tune a curve or add a floor without a confirmed false positive in
  hand — unfounded tuning is the same disease as unfounded scores.
- Do not let one severe-looking example dominate iteration on minor
  classes; the taxonomy reference holds the heavy examples so day-to-day
  work stays calibrated to the change actually being made.
- Do not mark tracked work done without file-level evidence; partial is
  not done — supersede explicitly or leave open and say what remains.
