# Autonomous semantic health POC

This is an opt-in **tool**, not an agent prompt. Pulsar computes the signals, selects source, composes every question, follows the answers through a bounded state machine, and applies the repository's declared penalties. The invoking agent supplies no code excerpts, labels, diagnoses, or proposed refactors.

This source-checkout command is experimental. It does not change published CLI contracts, built-in signal scoring, or the production project-module manifest.

## Run it once

```sh
# No provider calls: inspect deterministic discovery and the selected policy.
bun run dev semantic plan . --trust-project-code

# Requires TYPESAFE_API_KEY in the environment; sends selected source to Jev.
bun run dev semantic run . --trust-project-code

# After a repair, refuse to compare against changed interpretation/configuration.
bun run dev semantic run . --trust-project-code --expect-policy <policyFingerprint>

# Offline: use the exact runPath and runHash printed by a completed run.
bun run dev semantic replay <runPath> <runHash>
```

`run` exits 0 for green, 2 for red, 3 for unresolved/amber, and 1 for configuration or execution errors. `plan` and successful `replay` exit 0 independently of health. Each invocation starts fresh inference; there is no hidden favorable-answer cache or automatic retry. Recorded replay is deterministic; fresh Jev inference is not.

The repository must own `.pulsar/modules/semantic-policy.ts`. There is no personal semantic policy, fallback, or policy-free score. The module exports explicit include/exclude scope, rules, fixed penalties, confidence/margin floors, budgets and optional executable `selectRules(candidate)`. Executing it requires `--trust-project-code`; it is trusted code, not sandboxed. Static owned dependencies are content-hashed and materialized using the existing SDK loader. Arbitrary environment/network reads and external dependency bytes are not covered by this identity.

`--expect-policy` covers semantic module source/configuration, structural assessment policy, the requested model identifier, question version and POC implementation bytes. It cannot pin the server's implementation behind `jev-latest`; responses record their reported model version. Changing the tool or policy creates a different scoring epoch, not a repair.

## Pulsar owns all transitions

```text
runAgentAssessment (repo/org vector + existing modules)
  → full clone-group and complexity-function outputs, never diagnostic top-N
  → repo scope + deterministic ranked/interleaved candidate budget
  → exact function extents + bounded imports/consumers/source context
  → Jev: readiness + semantic relationship
  → when clear, Jev: relationship-specific refinement
  → when clear, Jev: compliance with each explicit applicable repo rule
  → deterministic fixed penalties, unresolved interval, existing hard gates
```

Stage-one labels describe shared rules, distinct rules, integration, forwarding, cohesive operations or mixed responsibilities. They are authored hypotheses, not validated universal architectural categories. The next stage asks a narrower question selected by the clear relationship. Near-ties stop as unknown; this POC does not implement multi-branch retention. The last stage receives the explicit repository criterion and fallible prior judgments alongside the original source.

Jev never invents reported locations. Findings refer to discovery's hashed file/line pointers. Directions such as consolidate a rule or investigate a forwarding boundary are bounded options, not generated patches or proofs of behavior preservation.

## The number has a declared meaning

Each clear violation costs its rule's fixed `penaltyPoints`. Clear compliance or non-applicability costs zero. A missing/ambiguous answer reserves that rule's full possible penalty. Identical rule/member-set observations are deduplicated before inference and aggregation.

With known penalty K and unresolved penalty U, the semantic interval is `[max(0, 100 − K − U), max(0, 100 − K)]`. Incomplete discovery forces the lower endpoint to zero because omitted candidates have unbounded total debt within this sample. The reported semantic score is the lower endpoint. **The upper endpoint assumes all unread evidence is benign; it is not a passing score.**

Green requires complete in-scope discovery, no unresolved judgment, and the policy's `greenAt` threshold. Model-judged debt that brings the upper endpoint below `redBelow` makes the semantic result red; uncertainty alone is amber. The overall `health` score is the minimum of the semantic lower bound and Pulsar's existing readiness score. Existing hard gates remain non-compensating: a semantic pass cannot turn a failed structural gate green.

There is no per-file/per-candidate average. Adding compliant candidates cannot dilute known penalties. It can consume the discovery budget and increase uncertainty, which is exposed rather than rewarded. Removing evidence cannot buy green. Repository scope exclusions remain visible and part of policy identity.

The supplied self-policy is illustrative calibration: 20 points for independently copied shared rules and 15 for unsupported boundaries/mixed responsibilities. Those weights and confidence floors are not empirically calibrated. **Green means only that the declared checks found no disqualifying debt within their detector-reachable scope**, not that every architectural problem is ruled out.

## Receipts and evaluation

Every live run writes an immutable plan and exclusive intent files before egress under `.pulsar/semantic-runs/`. Receipts retain raw provider bodies, exact requests, hashes, request IDs, status and latency. Replay reconstructs every transition, checks exact request identity and hash, validates raw responses against their questions, and recomputes the summary. A caller-supplied run SHA256 protects the entire recorded artifact. Failed/invalid provider responses remain unknown; there is no second stored answer object that can drift from the raw body.

`bun scripts/jev-poc-smoke.ts` creates disposable TypeScript/Git development repositories, runs the real signal engine and unchanged semantic pipeline, and retains receipts. It compares delegation, copied rule bodies, independent same-shaped rules, and repair. No expected outcome or fixture description is passed into discovery or Jev. These small authored cases test end-to-end operation, **not held-out accuracy**.

The separate mutation fixtures in `scripts/jev-poc/challenges.ts` operate on real Pulsar code: a duplicated rule, a forwarding wrapper, independent same-shaped rules, healthy-file padding and a low-ranked duplicate. Their tests establish detector reach and selected behavioral preservation; they do not by themselves validate semantic score movement. Notably, the wrapper appears in the full complexity inventory despite producing no over-threshold diagnostic. Top-N diagnostics alone would miss it.

See [taxonomy research](jev-autonomous-taxonomy.md) for alternative questions and proposed extensions, not the implemented API contract. Earlier [staged experiments](jev-staged-judgment-results.md) justify explicit gating and ambiguity reporting; they did not establish better policy judgment accuracy.

## Observed on 2026-09-17: autonomous operation, unproven repair target

**The command runs autonomously and its receipts replay, but the health number is not yet a trustworthy repair target.** These development experiments used 31 provider calls: 10 and 15 on Pulsar under question versions v1 and v2, plus two and four on the corresponding smoke fixtures. There were no automatic retries. One question-design revision separated clone relationships from single-function responsibilities and made readiness task-specific; thresholds and penalties were not lowered to obtain favorable answers.

The first smoke setup was invalid: placing disposable repos beneath `.pulsar` caused the production parser to exclude them, yielding empty inventories and vacuous semantic green. Those zero-call results are not positive evidence. Smoke repos now live outside hidden tool-state directories, the smoke driver checks the analyzed-function count, and discovery treats an empty in-scope candidate inventory as incomplete.

With corrected roots, v1 left both copied and independent rules amber after one call each. Under v2:

| Development case | Semantic interval | Calls | What the receipts establish |
| --- | --- | --- | --- |
| Delegated owner | [100, 100], green | 0 | No applicable clone rule; not a positive Jev judgment |
| Copied rule | [80, 100], amber | 2 | `shared_rule` probability 1.00; `independent_owners` 1.00, but refinement readiness 0.57 misses the 0.60 floor |
| Independent same-shaped rules | [80, 100], amber | 2 | `independent_rules` 0.80; `distinct_policy_inputs` 0.96, but refinement readiness says insufficient evidence with probability 0.75 |
| Repaired delegation | [100, 100], green | 0 | Applicable clone disappears; this does not establish correct rejection of the independent-rules control |

All four overall health results remain red under the existing structural assessment. The semantic facts differ, but **the final semantic score does not distinguish copied debt from legitimate independent rules**. A repair-induced increase alone therefore does not establish useful discrimination. These are authored development cases, not held-out evaluation; the five real-repository mutation fixtures have not been scored through Jev.

The real Pulsar v2 run discovered 7,223 candidates, 7,152 in policy scope, and selected eight (four clone groups and four functions). All four requested parser extents resolved. The sample remained incomplete, so the semantic lower endpoint was zero. Fifteen validated responses reported model `jev-1.13.0`, consuming 167,613 input and 1,751 output tokens. The result was semantic **[0, 80], red**: one violation judgment, one satisfied rule, and six unknowns.

The violation is **not validated debt**: candidate `clone-group:TS-SL-01-duplication:5d502cd31d4f9fca` went from `mechanical_similarity` to `mechanics_only`, then received `violated` under the shared-domain-rule criterion. The current policy question can revise fallible prior judgments, but this sequence supplies no independently verified justification for that reversal. It must not be used as a confident instruction to refactor. The v1 Pulsar run had instead returned [0, 100], amber, with one satisfied and seven unknown rules. Neither run established whole-repository semantic health.

Receipt anchors (paths relative to the repository):

| Run | Recorded artifact | SHA256 |
| --- | --- | --- |
| Pulsar v1 | `.pulsar/semantic-runs/1789671879112-b2d951d7/run.json` | `7963afa4f6dd01f4c02bce75b7f6525e71d00f4f89fe237dfcfe9fd80fa2135f` |
| Pulsar v2 | `.pulsar/semantic-runs/1789672064108-76a458cb/run.json` | `7fa58d4f565cf3b111ea00350e6b23cdcd967191150d96a9f2b01425029d3f40` |

The v1 source is preserved at [the initial implementation commit](https://github.com/skastr0/pulsar/commit/5e4d6f6); v2 intentionally rejects v1 question versions during replay. The review archive `jev-autonomous-poc-2026-09-17.tar.gz` retains both source snapshots, plans, intents, raw receipts, smoke sources/results, verification logs and a checksum manifest. Recorded absolute temporary paths describe the original runs; replay needs only the extracted run file and its recorded SHA256, not the original source directory.

Final local verification: `bun run test:jev` → **144 pass, 0 fail** across 10 files; `bun run typecheck:jev` → exit 0. CLI replay of Pulsar v2 and all four v2 smoke runs reproduced their summaries without provider calls. This verifies execution, integrity and aggregation, not semantic accuracy or repeatability of fresh inference. Before treating this score as an optimization objective, held-out opposing-policy controls must demonstrate debt discrimination, and contradictions between semantic facts and policy verdicts need an explicit treatment.
