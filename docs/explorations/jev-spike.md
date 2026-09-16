# Jev semantic judgment spike

**Status:** Pre-access architecture proposal; no live Jev evaluation or runtime integration has been performed. Prepared 2026-09-16. The implementation inventory is pinned to `fe84b1212148564703ebbaff0ee7f3c3df1c668f`; this documentation does not change active scoring policy or defaults.

The goal is to turn Pulsar's grounded signals and repository-owned calibration into architectural judgments, refactoring direction and a replayable semantic scorecard. Jev is the first evaluator to test, not a required foundation of Pulsar.

## Read and execute

| Artifact | Contents |
| --- | --- |
| [Architecture proposal](jev-semantic-judgment-architecture.md) | Evidence packets, explicit taste, provider boundary, judgment artifacts, deterministic replay, score comparability, agent optimization, threat model and 12 implementation work items |
| [Evaluation plan](jev-spike-evaluation-plan.md) | 42 unanswered research questions, 16 case specifications, hypotheses, baseline comparisons, dataset/labeling rules, proposed acceptance gates and a first-access runbook |
| [Question bank](jev-spike-question-bank.json) | 24 structured question templates, required evidence, experiment/case references and request-compilation rules |

There are two deliberately separate question sets: questions **asked of Jev about code**, and questions **the experiments must answer about Jev**. The latter require reviewed examples and observed results, not model assurances.

## First bounded experiment

Start with **extract, retain or dismantle an abstraction**. Materialize the development cases for independent vendor adapters, genuine shared domain rules, policy-dependent preferences and rejection of all offered changes. Compare structural-only Pulsar, a conventional structured-output evaluator and Jev under matched evidence and explicit repository taste.

Before access, prepare reviewed cases, frozen criteria, an offline request compiler and a mock/replay harness. At first access, verify the actual API contract and model identity using public or synthetic inputs before evaluating code. The implementation work items are planned work; the catalog is not an executable harness or adopted configuration.

All research questions remain unanswered, all case specifications await materialization and reviewed labels, and all performance results remain unmeasured. Keep those states explicit when extending this spike. A useful failure should narrow the supported question family or revise the experiment, not be hidden by changing a score or threshold after inspecting the held-out results.
