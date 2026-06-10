# Batch 4 manifest — carried forward from the aggregation truth pass

Accumulated from the batch-3 fleet validation and the adversarial review of the
rs-pack truth-pass commits (22 findings confirmed at 3/3 verifier votes; the
well-scoped ones were fixed in batch 3, the design-grade ones live here with
their evidence so they are decisions, not rediscoveries).

## Design-grade rs-pack items (confirmed by adversarial review)

### RS-DE-02 breadth-pressure redesign
`BREADTH_PRESSURE_START=5, SCALE=1200, CAP=0.25` saturates at 305 lockfile
packages. Typical tokio/axum/sqlx services resolve 300–600 packages, so
virtually every production Rust service pays the full 0.25 cap regardless of
hygiene — the same "saturates at toy sizes" defect the original commit fixed at
N=25, moved to N=305. Measured: fractals-agent (clean deps) gets 92% of its
total DE-02 pressure from breadth alone; atlas pays +0.171. The component is a
dependency-count tax, not an entropy signal. Redesign candidates: log-scaled
curve anchored against ecosystem percentiles, or breadth measured relative to
direct-dependency count rather than the resolved closure.

### RS-DE-02 monotonicity violation
Adding duplicate version instances or more packages can RAISE the score
(confirmed): the duplicate ratio's denominator grows faster than its numerator
in reachable configurations. More erosion must never read as healthier.
Couples to the breadth redesign — fix as one curve rework with a
property-based monotonicity sweep like the poison-ramp continuity test.

### RS-DE-02 feature-activation-only dependencies
Deps declared solely for feature unification or linkage (`openssl-sys` style,
optional feature-forwarding deps) have no source references by design and are
flagged unused with no escape hatch. Needs cargo-metadata feature-graph
awareness (a dep referenced by another dep's feature table is not unused), or
a vector-config allowlist as the cheap interim.

### cfg(test) out-of-line module gating (cross-file)
`#[cfg(test)] mod test_support;` in lib.rs gates src/test_support.rs entirely,
but per-file AST walking cannot see it: impls in the out-of-line file count as
production for every rust signal. Same-file gating (`#![cfg(test)]` inner
attributes, comment-interrupted attributes) was fixed in batch 3. The
cross-file case needs a project-level fact — collect cfg(test)-gated module
declarations during fact collection, resolve to file paths (dir/X.rs,
dir/X/mod.rs), and consult that set wherever testGated is derived. Touches all
walkAttributedNodes consumers; deserves its own commit series with per-signal
regression tests.

### RS-DE-01 locality model residue (minors, confirmed)
- Renamed workspace sibling deps (`dsl = { path = "../dsl", package =
  "bridge-dsl" }`) are scored foreign — workspace membership should be decided
  by the package graph, not name tokens.
- Bare-name locality can mask genuinely foreign traits (workspace-wide
  bare-name union admits any same-named foreign trait), and crate-root impls
  self-mask. The name-token model needs replacing with use-resolution against
  the import table — bigger than a patch.
- Allowlist matching is final-segment-only: `foreigncrate::Display` is
  exempted by segment name. Needs path-qualified allowlists (std::ops::Add vs
  bare Add) once use-resolution exists.

### RS-DE-02 diagnostics coherence (minors, confirmed)
- `top_n_diagnostics: 0` drops the score-breakdown diagnostic that the code
  comment guarantees "rides above the cap" — make the breakdown unconditional
  or fix the comment.
- Token-presence matching over raw file text lets comments/identifiers mask
  dead deps; honest fix is matching against `use`/path facts instead of file
  text (pairs with the use-resolution work above).
- Depth diagnostics warn at depth 8–9 while depth pressure starts at 10 —
  align the thresholds or label the 8–9 range as advisory-only.

## Deferred from batch 3 (pre-existing list)

- CLI paper cuts: `--signal --json` support, backpressure no-history display
  (score=1.00 + yellow), TS-AB-04 "Dead interface" wording.
- `knownFailureModes` made executable: each declared failure mode cites the
  fixture that proves it (the contract pattern batch 3 started with
  `assertReferenceDataTierFloor` and the cacheVersion pin tests).
- RS-SL-04 expensive-clone heuristic verification (fractals' old 0.20 minimum;
  the aggregation reshape de-fanged it, the heuristic itself is still
  unaudited).
- RP-01 small-repo confidence floors — only if fleet evidence shows the
  hotspot signals dominating unfairly post-reshape (batch-3 validation showed
  they do not).
- Tier-declaration audit beyond reference data: heuristic evidence claiming
  tier 1 (the SEC-03 pattern) is still only caught by review; consider
  evidence-class declarations on signals that contract tests can check.

## Standing validation assets

- `.fleet-baselines/` (git-excluded): pre/post-batch3 score JSON for the
  9-repo fleet; the comparison loop in the batch-3 close-out is reusable.
- The adversarial-review workflow journal (resumable, find-phase cached) is
  the template for reviewing future pack commits — with the cost lesson
  baked in. The first run (3 lenses × commits → 3 frontier voters per
  finding) burned ~300 agents because every voter re-read the same files.
  The canonical cheap shape, validated at batch-3 close:
  1. **Find** with few frontier agents (judgment-heavy; ~3 per commit).
  2. **Verify by file-cluster, not per finding**: one voter judges ALL
     findings against a file in a single read; 2 voters per cluster on
     `model: "haiku"`; escalate only split/uncertain verdicts to the main
     model. ~45 mostly-haiku agents replace ~280 frontier agents.
  3. **Prefer probe-tests over reader-votes** where a finding reduces to
     "delete X / feed Y, does the suite notice" — one builder writing
     throwaway probes verified 9 behaviors (and caught a live bug) for a
     fraction of the reader-vote cost, and every confirmed finding becomes
     a permanent fixture that re-runs for free.
  4. Verifiers must be explicitly READ-ONLY — two probe agents edited
     source mid-review (deleted the DE-02 score floor, rewrote RS-AD-01's
     pressure max); only explicit staging and the floor pin caught it.
