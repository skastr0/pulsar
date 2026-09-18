# Jev semantic judgment spike

**Status:** Research machinery retired. Distilled specifications, question templates, counterexamples and snapshot recovery live in [jev-research-archive.md](jev-research-archive.md). Companion archives: [POC / Quartz](jev-poc-archive.md), [ownership evaluation](jev-ownership-evaluation-archive.md).

Three follow-up workstreams completed on real Pulsar code: policy clarity (116 requests), maintenance utility (13), and staged judgments (58, including development and a retained confounded batch). These follow [29 first-access requests](jev-spike-results.md) and [12 question-shape requests](jev-question-shape-results.md). Precise repository policy improved development-case agreement; bounded ownership questions were useful. Neither architectural impossibility nor a trustworthy architecture score has been demonstrated. Production scoring and adopted calibration are unchanged. The original architecture inventory is pinned to `fe84b1212148564703ebbaff0ee7f3c3df1c668f`. Harness sources are recoverable at snapshot `f09151f07e493ac9c76c84c32c38aed31df4669b`.

The goal is to turn Pulsar's grounded signals and repository-owned calibration into architectural judgments, refactoring direction and a replayable semantic scorecard. Jev is the first evaluator to test, not a required foundation of Pulsar.

## Read and execute

| Artifact | Contents |
| --- | --- |
| [Policy-clarity results](jev-policy-clarity-results.md) | Operational boundary definitions, opposite-policy controls, label sensitivity, missing/conflicting policy, and the limits of an incomplete format control |
| [Maintenance-utility results](jev-maintenance-utility-results.md) | Four real change requirements, 24 compiler/runtime patch checks, ownership agreement, prose-plan limitations, and corrected Score decoding |
| [Staged-judgment results](jev-staged-judgment-results.md) | Taxonomy walking, deterministic obligation gates, explicit missing-policy refusal, direct/staged comparison, and retained experiment-authoring failures |
| [Question-shape results](jev-question-shape-results.md) | Oracle-designed real Pulsar extraction, consolidation and representation experiment; flat/structured, order, repeat, mutation and missing-policy controls; implications for repository-owned judgment |
| [First-access results](jev-spike-results.md) | Real Pulsar scoring-regression probe, development controls and failures, measured usage/latency, receipt hashes, adapter runbook and remaining limitations |
| [Architecture proposal](jev-semantic-judgment-architecture.md) | Evidence packets, explicit taste, provider boundary, judgment artifacts, deterministic replay, score comparability, agent optimization, threat model and 12 implementation work items |
| [Evaluation plan](jev-spike-evaluation-plan.md) | Original 42-question register and 16 case specifications, hypotheses, baseline comparisons, dataset/labeling rules and proposed acceptance gates; partial observations are recorded separately in the results |
| [Research archive](jev-research-archive.md) | Durable index, JQ-01–JQ-24 templates, request shapes, former test invariants, snapshot blob map. The JSON question bank is retired |

There are two deliberately separate question sets: questions **asked of Jev about code**, and questions **the experiments must answer about Jev**. The latter require reviewed examples and observed results, not model assurances.

## What the follow-ups support

- **Repository policy remains data, not a Pulsar default.** Operationalizing a boundary changed the development judgments; changing the policy's direction changed the selected implementation. These are experiments with proposed criteria, not adoption of those criteria or evidence of universal architectural correctness.
- **Use deterministic gates for deterministic obligations.** The staged consumer excluded a known breaking candidate and refused to rank without policy. Those protections belong to code, not to model reliability. Staging did not establish better policy interpretation and supplied additional evidence, so it is not a matched-evidence proof of superiority.
- **Inspect distributions and question scope.** Close rankings are not confident reversals. Three reported maintenance contradictions were artifacts of rounding a Score mean instead of inspecting its distribution. Some expected labels and experimental controls were also defective; the reports preserve the corrections and raw evidence.
- **The score-optimization goal is still untested.** Ownership agreement and policy-sensitive rule application do not demonstrate that optimizing a scalar yields better architecture. The next useful experiment is a held-out real maintenance change with actual candidate diffs, fixed repo-owned policy, independent behavioral checks and blinded outcome review, comparing guidance with and without Jev. No new composite score is justified by these results alone.

**Integration verification (2026-09-17, historical):** at the snapshot, `bun run typecheck:jev` passed and `bun run test:jev` passed **81 tests, 0 failures**, including independent compiler/runtime probes. Offline replay validated the 116 policy, 13 maintenance and 58 staged receipts. The staged archive's per-request bodies were also checked against raw responses and stored parsed answers independently of its replay implementation. No further inference was needed during integration. The worker's earlier load-sensitive timeout is retained in its report; it did not recur in this combined run. Those commands and tests are retired; this document is not an executed suite.

## First bounded experiment and its limit

The first experiment concerns **extract, retain or dismantle an abstraction**. Jev rejected a hypothetical reuse of the TypeScript score formula in Rust; independent execution confirms that it changes an existing numerical contract. Eleven synthetic development cases also exercise independent vendor adapters, shared domain rules, opposite policies and missing context.

The research harness now compiles bounded requests, records exact responses and replays offline. One failing synthetic candidate's contract verdict changed from `violates` to `meets` after swapping alternatives. All judgments remain descriptive; no semantic scoring gate is enabled.

Independent labels, held-out evaluation, matched conventional-provider comparisons and blinded agent-patch review remain outstanding. The case specifications and broader architecture are not implemented merely because an adapter runs. Keep failures explicit rather than changing thresholds after inspecting evaluation results.
