# Revealed preference bootstrap exploration

## Goal

Infer a taste vector from evidence the repo already contains without hiding the inference path behind an opaque model.

## Prototype algorithms

Prototype code lives in `packages/codec-core/src/elicitation/revealed-preference.ts`.

### 1. Pairwise comparisons

- **Shape**: compare accepted samples against revised / reverted samples one pair at a time
- **Strength**: easiest to explain; each weight delta can point back to concrete accepted-vs-rejected evidence
- **Weakness**: needs enough labeled contrasts to stop overfitting noisy routine commits
- **Recommendation**: **use this as the default bootstrap algorithm**

### 2. Frequency ranking

- **Shape**: compare accepted mean vs rejected mean per signal
- **Strength**: cheapest deterministic baseline
- **Weakness**: loses the local contrast that makes the result interpretable
- **Recommendation**: keep as a control, not the user-facing default

### 3. Prior-adjusted pairwise

- **Shape**: start from a preset prior, then blend pairwise evidence in as sample count grows
- **Strength**: best cold-start behavior when history is thin
- **Weakness**: if the prior is poor, early results inherit that bias
- **Recommendation**: use only when sample volume is below the minimum reliable threshold

## Minimum data requirement

- **Recommended minimum**: **24 labeled events** (accepted vs revised / reverted)
- Below that, prefer a preset prior and expose the result as low-confidence
- Filter out low-signal events where every tracked signal delta is `< 0.05`

## Reliability

- The pairwise prototype is stable when the repo supplies repeated high-delta comparisons on the same signals
- It is unstable when the history is dominated by routine dependency churn, renames, or broad squash commits
- Reliability should be reported as:
  1. sample count
  2. compared pair count
  3. signal support score (`-1..1`) per weight

## Integration shape

- Keep the bootstrap **proposal-first**, not auto-apply
- Write inferred deltas as a pending proposal under `.taste-codec/proposals/pending/`
- Record supporting evidence in vector provenance if a proposal is later accepted
- Cold start path:
  1. apply a preset
  2. run pairwise quiz if the user wants explicit calibration
  3. let revealed preference refine only after enough repo history exists

## Recommendation

Adopt **pairwise comparisons** as the canonical revealed-preference bootstrap:

1. use accepted vs revised / reverted events
2. ignore low-delta events
3. blend with preset priors only while sample count is below 24
4. surface the result as a pending proposal, never as a silent mutation

This stays closest to the architecture's intent: deterministic, evidence-backed, and explainable enough that a user can reject the proposed vector delta if it misread their history.

## Follow-up

- Build ticket: `TC-073 — Revealed preference bootstrap build`
- Remaining hard problem: extracting reliable accepted / revised / reverted events from raw git history without overstating confidence
