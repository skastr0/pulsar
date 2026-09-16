# Jev semantic judgment spike

**Status:** Research adapter and first live evaluation completed 2026-09-16: 29 requests, including three over real Pulsar source. [Results and runnable commands](jev-spike-results.md). Production scoring is unchanged; adoption gates remain untested. The original architecture inventory is pinned to `fe84b1212148564703ebbaff0ee7f3c3df1c668f`.

The goal is to turn Pulsar's grounded signals and repository-owned calibration into architectural judgments, refactoring direction and a replayable semantic scorecard. Jev is the first evaluator to test, not a required foundation of Pulsar.

## Read and execute

| Artifact | Contents |
| --- | --- |
| [First-access results](jev-spike-results.md) | Real Pulsar scoring-regression probe, development controls and failures, measured usage/latency, receipt hashes, adapter runbook and remaining limitations |
| [Architecture proposal](jev-semantic-judgment-architecture.md) | Evidence packets, explicit taste, provider boundary, judgment artifacts, deterministic replay, score comparability, agent optimization, threat model and 12 implementation work items |
| [Evaluation plan](jev-spike-evaluation-plan.md) | Original 42-question register and 16 case specifications, hypotheses, baseline comparisons, dataset/labeling rules and proposed acceptance gates; partial observations are recorded separately in the results |
| [Question bank](jev-spike-question-bank.json) | 24 structured question templates, required evidence, experiment/case references and request-compilation rules |

There are two deliberately separate question sets: questions **asked of Jev about code**, and questions **the experiments must answer about Jev**. The latter require reviewed examples and observed results, not model assurances.

## First bounded experiment and its limit

The first experiment concerns **extract, retain or dismantle an abstraction**. Jev rejected a hypothetical reuse of the TypeScript score formula in Rust; independent execution confirms that it changes an existing numerical contract. Eleven synthetic development cases also exercise independent vendor adapters, shared domain rules, opposite policies and missing context.

The research harness now compiles bounded requests, records exact responses and replays offline. One failing synthetic candidate's contract verdict changed from `violates` to `meets` after swapping alternatives. All judgments remain descriptive; no semantic scoring gate is enabled.

Independent labels, held-out evaluation, matched conventional-provider comparisons and blinded agent-patch review remain outstanding. The case specifications and broader architecture are not implemented merely because an adapter runs. Keep failures explicit rather than changing thresholds after inspecting evaluation results.
