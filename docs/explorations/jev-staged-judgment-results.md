# Staged judgment: facts, eligibility and policy, against one direct preference question

**Observed:** 2026-09-17. **Scope:** two frozen live batches, 27 live requests each, over 7 instances: three base implementation pairs (extraction, representation, consolidation) plus an obligation-breaking mutant, a byte-identical repeat, an a↔b swap, and a no-policy variant. No production code, score, weight, cache key or adopted calibration changed. This follows [jev-question-shape-results.md](jev-question-shape-results.md) and does not replace its observations.

This workstream tested one hypothesis: **does separating semantic facts, obligation eligibility and policy interpretation produce more useful architectural judgments than one direct preference question?** The two arms hold question formatting constant (structured instructions, `what`/`not_for` options, explicit `insufficient_evidence` outcomes) and differ in architecture: one broad preference question versus a taxonomy walk that retains two branches, a deterministic obligation gate, and a policy request composed only over the candidates eligibility left standing.

### What the two arms do not share

The arms are **not** evidence-identical at the policy stage, and no result below should be read as isolating architecture from evidence. Three separable differences produce the staged arm's outcome, and only the first is a gate effect:

1. **Deterministic gate.** Obligation eligibility is decided by compiler and runtime probes outside the model, so an obligation violation cannot be outvoted. This is what excludes the mutant, and it is independent of any provider answer.
2. **Added evidence.** The staged policy request's state carries `established_facts` that the direct arm never receives: the gate's per-obligation verdicts and violations, the retained taxonomy paths with their probabilities and provenance, and the explicit unknowns. A difference at the policy stage may therefore come from better evidence rather than from the question architecture.
3. **Restricted option set.** Ineligible candidates are absent from `preference_among_eligible`'s options, so the staged question cannot return them. This is a structural constraint, not a judgment.

The direct arm sees the same variants, obligations and policy text, and nothing else. Where the arms agree, no claim is made about which mechanism caused agreement; where they disagree, the three effects above are not separated by this design.

## Design

| Stage | Request | What it produces |
| --- | --- | --- |
| Direct arm | 1 request | `preference` (6 options incl. `incomparable`), `policy_readiness`, `evidence_readiness` |
| A. Semantic facts | 1 request | one directed taxonomy question ("how does `variants.b` differ from `variants.a`") carrying child subtrees as option values, plus one `satisfies`/`violates`/`insufficient_evidence` verdict per obligation per variant |
| B. Retained branches | 1 request | child taxonomy questions for the **two** highest-probability parents; composed from stage-A answers, so its options do not exist before stage A returns |
| C. Policy | 1 request | `preference_among_eligible` whose option set is built from eligibility, plus `unresolved_reason` |

Consumption rules are deterministic and in code:

- Eligibility = the deterministic gate (compiler/runtime probes) **and** every *semantic* obligation answered `satisfies`. A `violates` disqualifies; an `insufficient_evidence` yields `unknown`, which blocks ranking.
- Provider verdicts on *deterministic* obligations are recorded and never consumed. This is what stops Jev being credited for a gate outcome.
- Missing `policy.selected_criterion` → the policy request is not composed; verdict `unranked_missing_policy`.
- One eligible candidate → `determined_by_eligibility`; the criterion is not consulted.
- Branch paths are scored with the vendor cookbook's length-normalized geometric mean over retained branches. That score prunes branches; it is **not** an architectural utility and no composite scalar was built.

The taxonomy (5 roots, 11 nodes) is generic and direction-explicit; its categories are defined before any answer was seen and no case carries an expected verdict. The repository criteria are the same proposed repo-scoped experimental criteria as the previous experiment, and they are **not adopted Pulsar policy**. The mechanical relationship derived by the gate is used only as an independent ruler for evaluation and is never placed in any request state.

## Two authoring defects, found and corrected

Both were defects in my own experiment definition, not in the provider's behaviour. They are retained as negative evidence.

1. **The absent-policy instance still carried the criterion.** Batch 1 composed `focus.criterion` from the subject's policy even when the instance declared no policy, so the "missing policy" case was not missing. The direct arm then answered `policy_readiness = defined` and ranked `a` at 0.89. Fixed: `focus.criterion` is omitted when the instance declares no policy, and a test asserts the criterion string appears nowhere in that state. (The previous experiment's `question-shapes` packet has no `focus` field at all, so its no-policy observation is not affected by this defect.)
2. **A mis-scoped obligation silently became the policy.** Batch 1's scheduler obligation read "the coordination must stay inspectable … without reconstructing them from an interleaved loop" — that restates the preference, so the eligibility gate, not the policy stage, decided consolidation, and the intended unresolved-tradeoff case never reached the policy layer. Reworded to a genuine minimum ("no other module may read or depend on the scheduler's per-batch phase state"), which both variants satisfy.

A third, evaluation-only defect: the mechanical relationship ruler was direction-blind, so it labelled the consolidation pair `helpers_private_single_use` even when the directed question's correct answer was `decomposition_not_via_helpers`. Fixed to follow the direction of the question. Recomputing the frozen batch under the corrected ruler changes **no** reported metric (branch recall is 7/7 under both).

## Results

Batch 2 is the frozen, corrected batch. Batch 1 is retained for comparison. Probabilities are provider outputs, not measured accuracy.

| Probe | Observed | Supported conclusion |
| --- | --- | --- |
| **Obligation-breaking candidate** (`extraction-mutation`, removed severity ceiling) | Gate: `b` ineligible — uncapped `block` escapes at both entry points and the observation suite differs from the unmodified repository. Batch 2 direct arm top label **`b` 0.36** (`neither_meets_minimum` 0.34, `a` 0.24). Batch 1 direct arm top `neither_meets_minimum` 0.38 with `b` 0.29. Staged arm: `b` had no option; verdict `determined_by_eligibility: a` | The direct preference question **selected the mechanically disqualified candidate as its most probable answer** in batch 2 and gave it 0.29 in batch 1. The staged architecture cannot do this, by construction — credited to the gate, not to Jev |
| **Provider obligation verdicts vs the gate** | 32 deterministic obligation verdicts per batch, **0 mismatches** with the compiler/runtime gate across both batches (64/64); 0 `insufficient_evidence` | Jev's obligation *perception* is reliable on this corpus. The failure is in aggregation, not perception |
| **Representation** (static guarantee) | Taxonomy established `contract_or_behavior_differs → static_guarantee_differs` 0.94/0.97, matching the independent `tsc` probes (bare `{status:"hit"}` assignable under A, rejected under B; narrowing works only under B). Policy layer: `prefers_a` **0.38**, `prefers_b` 0.32, `no_separation` 0.29, while `unresolved_reason` answered "the criterion does not settle the remaining question" 0.62. Direct arm: `a` 0.60, `b` 0.26 | **Negative evidence.** Better facts did not produce a better policy interpretation. Both arms failed to apply a criterion that says "prefer representing already-established producer guarantees in the result type". What staged added is a visible near-tie and a self-contradiction signal, not a better answer |
| **Consolidation** (legitimate unresolved tradeoff) | Staged: `prefers_b` 0.48, `prefers_a` 0.30, `no_separation` 0.22. Direct: `a` 0.53, `b` 0.40. The mechanical fact is that the helpers are private and single-use, so the criterion's escape clause ("when it hides an independently useful contract") is underspecified | The two arms **disagree** on the same variants, obligations and policy text, and neither is decisive. Because the staged policy state also carries `established_facts`, this disagreement is not attributable to the question architecture alone. Staged did not produce a stable unresolved-tradeoff verdict; it produced a shallow ranking with a substantial unresolved mass |
| **Missing policy** | Staged: policy request not composed, verdict `unranked_missing_policy`. Direct: `policy_readiness = missing`, `preference` top `equivalent` 0.57 with `insufficient_evidence` 0.35 | The direct question still returns a substantive top label where no policy exists, so a top-label consumer would read a missing-policy case as an equivalence verdict. The staged refusal is deterministic |
| **Identical repeat** (byte-identical requests) | Relationship distribution identical, staged verdict identical (`prefers_b`), direct top identical (`a`); child distributions differ; both arms' distributions differ numerically (staged 0.48/0.30/0.22 vs 0.49/0.29/0.22; direct 0.53/0.40 vs 0.51/0.43) | Top labels reproduced on these requests; the distributions drifted. **Threshold stability was not tested**, so this does not establish whether any particular decision threshold would be reproducible |
| **Swap counterbalance** (a↔b) | Staged label tracked the physical variant (`b`→`a`); direct top also tracked (`a`→`b`); mechanical root stable; provider taxonomy top stable at `internal_decomposition_differs` | Both arms were position-consistent here, which is *better* than the previous experiment's direct-arm flip. This small design does not isolate position sensitivity |
| **Branch retention** | 7/7 recall of the mechanically established path under both rulers. In `extraction-mutation` the two retained branches were `ownership_boundary_differs > shared_owner_single_contract` and `contract_or_behavior_differs > runtime_behavior_differs`, which is exactly the mutant's double nature | Retaining two branches preserved information that a top-label collapse would have discarded. Retention is also what makes the near-ties visible |

## Cost

Batch 2: 27 egress attempts, 232,181 input / 5,858 output tokens, estimated **$0.00975** under the recorded $0.042/M input and free-output assumption (not verified account billing). Orb-observed latency: **p50 142.5 ms, p95 276.2 ms, max 391.2 ms**.

| Arm | Requests | Input tokens | Output tokens | Mean latency |
| --- | --- | --- | --- | --- |
| Direct | 7 | 54,290 | 1,262 | 151.2 ms |
| Staged | 20 | 177,891 | 4,596 | 156.5 ms |

Staged costs **3.28×** the input tokens and 2.86× the requests for the same 7 instances, and adds two sequential round trips per instance (stage B needs stage A; stage C needs B and the gate). Per-request latency is comparable, so the extra cost is composition, not slower inference.

## What this establishes, and what it does not

Established:

- **The deterministic gate, plus the restricted option set, made the obligation violation non-compensating.** The mutant was excluded because compiler and runtime probes decided it, and because an ineligible candidate is absent from `preference_among_eligible`'s options. Jev contributed no part of that outcome, and the direct preference question — which had to weigh an obligation violation against a preference — gave the disqualified candidate its top label.
- **The deterministic composition rule made a missing policy non-ranking.** The staged arm did not send the policy request at all. That is a code rule, not a provider behaviour.
- **Jev's obligation verdicts agreed with independent compiler/runtime evidence on 64/64 deterministic questions**, so separating facts from policy is not needed to fix *perception*.
- **Retaining two taxonomy branches preserved the ambiguity** that a top-label collapse destroys, and made near-ties and self-contradictions visible.

Not established:

- That the staged policy stage is **more accurate**. On representation it reproduced the direct arm's choice while its own `unresolved_reason` answer contradicted it. Because the staged policy state additionally carries `established_facts`, any policy-stage difference is confounded with added evidence, and this design does not separate them.
- That a stable "unresolved tradeoff" verdict exists for the consolidation criterion. The two arms disagreed and the staged distribution was shallow.
- Anything about held-out accuracy, human labels, decision thresholds, or production enforcement. Author-proposed criteria are not independent human labels, and no composite scalar was built or validated.

Architectural hazard worth recording: **a mis-scoped obligation is invisible and silently becomes the policy.** Batch 1's scheduler obligation was a preference in obligation clothing, and eligibility — a non-compensating gate — decided the case before the policy stage ran. Any future use of this shape needs obligation texts reviewed as minima, independently of the preference they might resemble.

## Receipts and reproduction

Baseline: unpushed local `main` `b124766ea68e95f50466539997a23f4f03983f97` from `delegation-base.bundle`, SHA256 `62767bc58ce511c502730666ff89699d434fc2ced0f8e2f84eb0aafbca061edd`, verified with `git bundle verify`. Work branch `jev-research/inference-composition`.

```text
batch 2 (reported)  run SHA256 f03f93c0224bb9b7012bf02ad7ec54c99f27d24c5b95a1d0c5de0f975b568dd2
batch 2             canonical plan SHA256 b9f38e87e6e1e9d0cb01e77543811c48e72e53096289cf0b3a42b6e5c599381c
batch 1 (retained)  run SHA256 49e5236605e9b857ed361de34272344c8c4eef5598ef1f6256b441bd8d5ea0a7
batch 1             canonical plan SHA256 ff6e6332ae4c0b68e5798dacc85b044c9eda034045a7692a1f379aef0846c42d
batch 1 dev         run SHA256 1e0d40e48f24dedbf1fee5720ba41d9746662bb57982862a24ec7e9756ee6d61
```

All 27/27 batch-2 POSTs returned HTTP 200 and validated on replay. All responses identified `jev-1.13.0`; requests selected `jev-latest`, so immutable version pinning remains unresolved. Requests were 19,813–45,817 bytes. The API key was an authorization header and is in no recorded packet, plan or archive.

Replay re-derives stage B and stage C from the recorded answers and requires byte equality with the request that was sent, so a non-deterministic composition fails replay rather than quietly producing a different judgment. It also fails on a wrong digest, a tampered composed request, and a stage-A answer that no longer supports the recorded child request.

Every `received` record is additionally re-validated against its own provider receipt: the recorded request hash must equal the request replay derived, `validateResponse` must accept the raw body, and the stored parsed answer must equal what that raw body decodes to. A stored answer that drifted from its receipt, a receipt that does not answer its request, and a receipt whose raw body is missing or unparseable each fail replay. All three real runs (batch 2, batch 1, batch 1 dev) pass this validation, and replaying batch 2 reproduces the stored summary byte for byte.

```sh
bun scripts/jev-staged-judgment.ts replay .pulsar/jev-research/staged-judgment/run.json \
  f03f93c0224bb9b7012bf02ad7ec54c99f27d24c5b95a1d0c5de0f975b568dd2
bun run test:jev
bun run typecheck:jev-staged
```

Validation: `bun run typecheck:jev-staged` and `bun run typecheck:jev` passed. `bun run test:jev` reported 51 pass plus **one pre-existing load-sensitive timeout** in the parent's `jev-shape-candidates` representation test, which carries a 5 s budget under full-suite load: it also timed out on the baseline run before any of this work, and passes in isolation at ~4.3 s. This workstream's own file is **17 pass, 0 fail** (`bun test scripts/__tests__/jev-staged-judgment.test.ts`). Those 17 tests cover the real gate verdicts for every subject, direction-aware mechanical labels, taxonomy composition and child-option derivation, branch scoring and retention, eligibility consumption rules, plan tamper detection, receipt re-validation (request hash, raw-body validation, stored-versus-raw equality, missing and unparseable raw bodies, another request's body, and not-attempted records), and a fully synthetic replay that exercises the whole composition path with zero egress.

Still absent: held-out architectural evaluation, an independently labelled policy comparison, a matched conventional-provider baseline, a score-directed agent trial, and a calibrated decision threshold. `extraction-mutation`'s direct-arm result is a single sample; it replicates the previous experiment's direction but is not a rate.

Exact receipts, plans, intents, per-request bodies, raw responses, usage/latency, the corrected-ruler recomputation, and test logs are in `jev-staged-judgment-2026-09-17.tar.gz`. The archive contains no authorization headers.
