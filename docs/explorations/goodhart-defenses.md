# Goodhart defenses

## Goal

Keep agent-facing codec feedback useful without turning the scoring system into a target-gaming loop.

## Implemented defenses

### 1. Hidden holdout signals

- a rotated subset of active signals is hidden from the agent-facing view
- holdouts do **not** change scoring or backpressure weights
- they only change what is shown to the agent

### 2. Adversarial rotation

- holdouts rotate on a fixed day window
- rotation is deterministic from timestamp + signal id
- rotation affects visibility only, not stored scores

### 3. Score-velocity meta-check

- compare visible-signal improvement with hidden-signal improvement over the recent window
- if visible signals improve materially faster than holdouts, elevate Goodhart suspicion
- elevated/high suspicion degrades backpressure explicitly

### 4. Diagnostic, not evaluative

- agent prompt surfaces only qualitative diagnostics and policy reminders
- numeric scores stay out of the agent-facing system prompt
- the bridge payload for epistemology is qualitative for the same reason

## Implemented seams

- `packages/codec-core/src/goodhart.ts`
- `packages/codec-core/src/backpressure.ts`
- `apps/opencode-plugin/src/server/agent-constraints.ts`
- `apps/opencode-plugin/src/server/epistemology-bridge.ts`

## Verification

- `packages/codec-core/src/__tests__/backpressure.test.ts`
- `apps/opencode-plugin/test/server.test.ts`
- `apps/opencode-plugin/test/epistemology-bridge.test.ts`

## Design choice

The key constraint is explicit: **taste weights already influence observer scores; they should not become a second hidden enforcement channel**.

So the implementation:

- keeps observer scoring stable
- keeps backpressure thresholds explicit in vector metadata
- uses Goodhart logic to adjust confidence / autonomy level, not to silently reshape weights

## Residual follow-up

The defense stack shipped inline in Wave 4B. Future follow-up is tuning only:

- calibrate holdout ratio per repo size
- tune suspicion thresholds from real histories
- add stronger adversarial simulations if the codec starts scoring agent cohorts directly
