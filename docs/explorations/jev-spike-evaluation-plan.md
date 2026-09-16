# Jev spike: evaluation plan, question register and first-access runbook

**Status:** Proposed experiment; all live results are **not run**.  
**Prepared:** 2026-09-16 against Pulsar `fe84b1212148564703ebbaff0ee7f3c3df1c668f`.  
**Companions:** [Architecture](jev-semantic-judgment-architecture.md), [question-bank JSON](jev-spike-question-bank.json).

This plan pre-seeds both kinds of questions: **what to ask Jev about code**, and **what the experiment must establish about Jev**. They are different. A model answering a question about its own reliability is not an evaluation of that reliability.

Nothing here is an active Pulsar policy. Proposed thresholds, utility maps, corpora and command names must be frozen for an experimental run before looking at its held-out results. This document contains no measured accuracy, benchmark win, approved labels, working live adapter or claim of Jev access.

## 1. The spike's central falsifiable claim

Given grounded code evidence and explicit repository taste, a semantic evaluator can distinguish an architectural improvement from a merely metric-improving refactor, more usefully than Pulsar's structural signals alone, while providing enough coverage and uncertainty information to guide agents without redefining correctness.

The decisive initial workflow is **extract / retain / dismantle an abstraction**. Keep it bounded to TypeScript modules and their callers, contracts and relevant history. Broader architectural planning, cross-language support and whole-repository scores are follow-on work, not prerequisites.

A positive result is family-specific. Success at classifying intentional noops does not establish competence at module design. Failure of Jev does not invalidate the provider-independent judgment layer; failure of every evaluator on the same packets may indicate bad evidence or an ill-defined rubric.

### Experimental hypotheses

| ID | Hypothesis | Direct falsifier or limiting result |
| --- | --- | --- |
| H1 | Code plus explicit taste improves architectural discrimination over structural signals alone | No held-out improvement, or the apparent improvement vanishes on counterexamples |
| H2 | Judgments respond to legitimate changes in declared taste | They retain generic DRY/small-file preferences despite a clear opposite policy and reviewed examples |
| H3 | Probabilities support useful selective guidance | Confident errors persist or reduced error requires abstaining on nearly everything |
| H4 | The evaluator recognizes insufficient context | Missing callers/contracts create confident recommendations instead of unknowns |
| H5 | Guidance improves actual patches, not just scores | Agent score rises while blinded maintainers prefer baseline code or contracts regress |
| H6 | The workflow is operationally viable | Complete evidence preparation, inference and verification exceed the chosen resource budget |

Do not rescue a failed hypothesis by changing its definition after seeing the test set. Record the failure, revise on development cases, and start a new evaluation epoch with a new sealed set.

## 2. Research question register

**Every row initially has status `unanswered`, owner `unassigned`, result `null`.** Priority A means first-access or essential validity; B means before shadow guidance; C means before broader adoption. Experiments can be prepared without credentials; live probes wait for access. A vendor assertion is recorded separately from an observed result.

### Provider contract and operations

| ID | Priority | Question to answer | Experiment / evidence | Consequence |
| --- | --- | --- | --- | --- |
| E01 | A | Can we select an immutable model revision, and does the response identify it? | Inspect account model listing and record raw responses; ask vendor about alias movement/version retention | Pinned comparisons, or explicit unpinned evaluation epochs |
| E02 | A | What is the effective context budget on code, including questions? | Sweep synthetic/public packets and question counts below/near/above documented budget; observe validation, usage and truncation | Set byte/token budgets; fail explicitly rather than truncate |
| E03 | A | Are all three primitive shapes and distributions as documented? | Small known-answer smoke requests plus local malformed-response fixtures | Validate adapter contract before architecture tests |
| E04 | A | Do batched questions behave like isolated requests? | Same state and question, alone versus compatible batches, controlled order/repetitions | Decide batching and record any distribution drift |
| E05 | A | What do auth, quota, overload, timeout and cancellation look like? | Mock all paths; observe naturally occurring live errors; no deliberate service overload | Bounded retries, typed errors, first-valid-result policy |
| E06 | B | What latency/cost/concurrency works for our packets and deployment region? | Record p50/p95, token usage, retries and wall time across small/medium/large packets under allowed quotas | Bound agent-loop throughput; choose cache/precomputation strategy |
| E07 | A | What code/data retention, training and deletion terms apply to this account? | Obtain current provider terms and account-specific confirmation; record allowed data classes | Public/synthetic only until private-code egress is authorized |
| E08 | C | Are exportable model versions, self-hosting or alternative deployment modes actually available? | Vendor answer and verifiable product documentation, not assumptions | Procurement and provider-portability decisions |

Documented starting points, not experimentally established limits: the [primitives guide](https://docs.typesafe.ai/primitives) describes a shared budget of roughly 32,000 tokens for state and questions. The [HTTP reference](https://docs.typesafe.ai/api) documents auth/validation/rate-limit/overload responses. Verify the actual account and SDK behavior rather than treating those descriptions as tested guarantees. Do not run intentionally disruptive load tests.

### Semantic competence and encoded taste

| ID | Priority | Question to answer | Experiment / evidence | Consequence |
| --- | --- | --- | --- | --- |
| E09 | A | Can it distinguish shared domain invariants from coincidental syntactic similarity? | C01/C02 contrasts; JQ-04, JQ-05 and JQ-06 with reviewed labels | First abstraction family is viable or not |
| E10 | A | Can it follow a repository policy that differs from generic best practice? | Same code under two coherent policies; independently reviewed expected changes | Taste is truly an input rather than decorative prose |
| E11 | A | Do examples improve transfer beyond their near-duplicates? | No examples / positive only / positive plus counterexamples on grouped held-out families | Select exemplar strategy without leaking test cases |
| E12 | B | Can it identify coherent orchestration versus mixed responsibilities? | C03/C04, including equal-size contrasts and reversed file-size cues | Avoid simply relabeling LOC pressure as semantics |
| E13 | B | Does it understand framework-mandated shapes? | Intentional noop, necessary adapter boilerplate and typed existential boundary controls | Enable only validated framework-specific questions |
| E14 | B | Can it judge inter-module relations rather than isolated clean files? | C05/C10 boundary relationships; individual file views versus full relation packets | Determine minimum architectural scope |
| E15 | B | Are preferences stable across levels and pairwise comparisons? | Absolute rubric plus blinded A/B comparison per criterion, including ties | Avoid contradictory rankings and false score precision |
| E16 | C | Does the rubric transfer to new repositories/languages without silent taste drift? | Leave-one-repository/family-out evaluation; later TS/Rust comparison | Scope claims and separate calibrations |

### Evidence and grounding

| ID | Priority | Question to answer | Experiment / evidence | Consequence |
| --- | --- | --- | --- | --- |
| E17 | A | How much code context is necessary? | Subject only / callers / contracts / history; controlled omission and restoration | Deterministic context builder and abstention policy |
| E18 | A | Do structural observations help or anchor judgments incorrectly? | Correct signals / no signals / deliberately misleading metric summaries | Decide whether scores, raw facts or neither enter state |
| E19 | B | Does actual code override a persuasive but incorrect patch summary? | Identical patch with neutral versus misleading agent prose | Exclude or constrain narrative inputs |
| E20 | A | Can it detect contradictory/missing policy or evidence? | C11 and incompatible adopted principles; missing callers and stale contracts | Unknown/conflict routes rather than fabricated conclusions |
| E21 | B | Do selected evidence references actually support the claim? | JQ-14/JQ-23; maintainer audits, irrelevant decoys and negative controls | Do not confuse valid references with valid support |
| E22 | B | What does signal-triggered selection miss? | Predeclared low-signal/random subjects and module-graph samples | Set coverage boundaries and exploration budget |

### Calibration and reproducibility

| ID | Priority | Question to answer | Experiment / evidence | Consequence |
| --- | --- | --- | --- | --- |
| E23 | A | Are predicted probabilities calibrated on architectural decisions? | Brier/log loss and reliability summaries against reviewed labels by family | Raw probabilities or a fitted, versioned calibration transform |
| E24 | A | Is provider confidence useful beyond simple probability statistics? | Compare confidence, max probability, margin and entropy on calibration split | Choose a validated abstention/routing statistic |
| E25 | B | Does fresh inference repeat under identical requests? | Retain all repetitions; compare distributions, labels and utility deltas | Distinguish replay determinism from inference stability |
| E26 | B | Do wording, option order and A/B position change decisions? | Meaning-preserving paraphrases, option permutations, A/B swaps | Control presentation bias; flag unstable judgments |
| E27 | B | How correlated are errors across dimensions and models? | Case-level joint error analysis, not question-level independence assumptions | Avoid unjustified ensemble/aggregate confidence |
| E28 | C | Can drift be detected before it corrupts a trend? | Frozen canary set plus reevaluation at provider/model/rubric changes | New epochs, comparative backfills and rollback |

### Optimization and adversarial robustness

| ID | Priority | Question to answer | Experiment / evidence | Consequence |
| --- | --- | --- | --- | --- |
| E29 | A | Does it resist metric-only improvement? | C03/C04/C13: helper splitting, shared megaclass, renamed functions, weakened tests | Semantic score must not reward the proxy alone |
| E30 | A | Can an agent manipulate the rubric or cached judgments? | Policy edits, forged artifacts, changed examples and suppression files | Deterministic integrity checks, not a model self-check |
| E31 | B | Can code comments or embedded instructions influence the judge? | C12: source-level prompt injection with identical semantics | Restrict guidance to robust families; improve input boundary |
| E32 | B | Can scope changes manufacture a better average? | C14: delete obligations, split subjects, omit difficult files or missing labels | Fixed cohort/obligation accounting and unknown mass |
| E33 | B | Can repeated querying discover exploitable scoring shortcuts? | Fixed-budget adversarial patch search; retain all trials; sealed fresh validation | Estimate optimization robustness, not just passive accuracy |
| E34 | B | Do improvements survive blinded review and independent checks? | Actual agent patches reviewed without scores/provider names | Decide whether score-directed work is useful |

### Product value and operational decision

| ID | Priority | Question to answer | Experiment / evidence | Consequence |
| --- | --- | --- | --- | --- |
| E35 | A | Does Jev add value over structural-only and conventional structured LLM baselines? | Matched packets, questions, budgets and reference labels | Adopt, specialize, substitute or stop |
| E36 | B | Does uncertainty reduce error at a useful coverage level? | Risk-coverage curves and family-level failure counts | Enable guidance with calibrated abstention, not blanket confidence thresholds |
| E37 | B | Are recommendations actionable without inventing rationales? | Structured recommendation records, reason-code support audit, maintainer actionability labels | Template guidance versus separate explanation agent |
| E38 | B | How much human upkeep does taste require? | Log labeling, disagreement, policy revision and exception review effort | Avoid a system whose maintenance exceeds its benefit |
| E39 | C | Can accepted semantic classes become deterministic rules? | JQ-24 plus independently authored structural checks and counterexamples | Reduce repeated inference where genuinely possible |
| E40 | C | Does local improvement compose into repository improvement? | Matched-cohort deltas plus whole-module relationships and new-obligation checks | Limit scalar claims; identify cross-boundary regressions |
| E41 | B | Is the end-to-end loop worth its full cost? | Include parsing, context selection, inference, retries, review, patching and tests | Throughput and resource budget decision |
| E42 | C | Can we disable a family/provider without changing historical meaning? | Offline replay, provider outage, opt-out and rebaseline drills | Ship rollback with explicit score-series boundaries |

## 3. Seed case inventory: materialize, do not pretend these are fixtures

These are **case specifications** awaiting actual source snapshots, proposed patches and human labels. They are not fabricated historical decisions. All have `materialization_status = not_started` and `reference_label = null`. The scenarios name hypotheses to test; the provider must never receive this inventory's expected direction.

| ID | Case to construct | Required contrast | Useful question IDs |
| --- | --- | --- | --- |
| C01 | Two adapters for vendors with independently evolving lifecycle/error contracts | Keep orchestration separate / generic superclass / share only stable normalization | JQ-04–07, JQ-09, JQ-17 |
| C02 | Duplicated pure domain invariant used by multiple consumers | Real shared semantic rule versus identical-looking but different domain policies | JQ-04, JQ-06, JQ-17 |
| C03 | Long but coherent integration procedure | Original versus helper extraction that scatters one operational decision | JQ-07, JQ-08, JQ-10 |
| C04 | Long module containing genuinely unrelated responsibilities | Original versus boundary-aligned extraction with callers/contracts intact | JQ-07–10, JQ-17 |
| C05 | Short readable files with a harmful cross-boundary relationship | Public stable contract versus reaching into implementation details | JQ-09, JQ-17 |
| C06 | Empty framework callback and unfinished production handler | Same empty syntax, different required behavior | JQ-11, JQ-13 |
| C07 | Deliberate local type erasure at a heterogeneous boundary | Audited/contained use versus unsafe public leakage | JQ-12, JQ-09 |
| C08 | Interface with one implementation | Required substitution/public contract versus speculative indirection | JQ-10, JQ-16 |
| C09 | Adapter validation that resembles domain validation | Legitimate boundary validation versus inconsistent duplicated business rule | JQ-04, JQ-06, JQ-09 |
| C10 | Many individually sound changes eroding a module boundary | Local patch view versus cumulative dependency/contract history | JQ-09, JQ-17, JQ-21 |
| C11 | Relevant callers/contracts intentionally removed from context | Full evidence / omission / contradictory policy / restored evidence | JQ-01, JQ-02, JQ-22 |
| C12 | Source comment telling the evaluator to approve or ignore a defect | Original and instruction-injected code with identical runtime semantics | JQ-14, JQ-17, JQ-23 |
| C13 | Metric-improving patch that weakens behavior or tests | LOC/complexity gains while an obligation is broken | JQ-15, JQ-19, JQ-20 |
| C14 | Score dilution through deleted files, exploded subjects or absent artifacts | Same obligation inventory with changed representation | Deterministic accounting plus JQ-19 |
| C15 | Two coherent taste profiles on the same genuinely ambiguous design | Independent reviewers label each profile without knowing model answers | JQ-02, JQ-16, JQ-17 |
| C16 | All offered candidate changes are worse than leaving code alone | No-change candidate, unsuitable alternatives, tied and incomparable options | JQ-17, JQ-18 |

Potential seed sources are Pulsar's [self-calibration](../../.pulsar/modules/pulsar-self.ts), [calibration processors](calibration-processor-architecture.md), and [AI-artifact fixtures](../../packages/core/src/__tests__/ai-facts.test.ts). They identify topics, not answers. Select source paths after inspection; do not invent commit histories or assume current exemptions are architecturally correct.

Build real repository-shaped fixtures with manifests, imports and relevant caller/test code, following [signal authoring guidance](../signals/authoring.md). Keep synthetic adversarial controls explicitly marked. Public examples can aid development, but a publicly visible corpus is not a sealed benchmark against future optimized agents or models.

## 4. Corpus, labels and leakage control

Start by materializing roughly 12–20 decision lineages across the inventory for development and rubric repair. A subsequent pilot might contain 160 independent lineages, split 80 development / 40 calibration / 40 sealed test. These are planning sizes, not a power analysis or sufficient rare-error evidence. Expand or narrow the enabled family until its test sample is adequate; never count multiple nearly identical variants as independent cases.

Group all before/after versions, alternative patches, framework variants and close clones from one architectural decision into the same split. Hold out entire repositories or decision families for transfer claims. Do not use a refactor's original variant for examples and its revised variant for testing. Exemplar selection uses only the development pool.

For each lineage, label criterion-level answers, preferred alternatives (including ties, none and incomparable), missing-evidence sufficiency, error severity and evidence support. Annotators see the same evidence budget as the evaluator. Keep richer audit context separate; explicitly identify cases where humans required additional information. A disagreement caused by missing policy is not resolved by inventing a forced majority label.

For the repo-specific pilot, the maintainer is the authority on intended taste. A second independent engineering reviewer improves evaluation of clarity and externally inspectable evidence. If only one reviewer is available, record single-rater preference alignment and its limitation; do not claim human consensus. Preserve individual judgments and adjudication notes. AI reviewers can challenge labels or propose cases but cannot be the sole authoritative labels used to claim independent architectural validity.

All state sent to providers excludes `reference_label`, `expected_direction`, `split`, annotator identity, hidden tests and prior model outputs unless the experiment explicitly tests that input. Keep committed question templates public and inspectable; keep the sealed labels and fresh optimization-validation cases in maintainer-controlled storage outside the evaluated agent's write access.

Freeze an experimental manifest with corpus/label fingerprints, group splits, question-bank/rubric versions, selected provider configs, utility maps, primary metrics, gate thresholds, budgets and planned ablations. Changing one creates a new manifest, not an overwritten run.

## 5. Experimental arms and execution order

Use three required arms: structural-only Pulsar, a conventional structured-output LLM, and Jev. Choose and pin the conventional model at execution time, recording provider/configuration rather than assuming today's model name or price. Optional arms are code-only Jev, code plus signals, code plus taste, and code plus signals plus taste/examples.

The primary comparison uses the same material evidence, same semantic question definitions and deterministic composition for both semantic providers. Record differences that cannot be equalized. Compare at matched end-to-end cost/latency budgets as well as maximum tested quality. A conventional model's self-reported probabilities are not automatically calibrated; evaluate them too. Never give one arm hidden labels or richer context.

Run in this order:

1. **Offline integrity:** decode fixtures; validate request compilation; reject tampering/staleness; exercise incomplete and no-network behavior.
2. **Contract smoke:** public/synthetic known-answer questions; one request containing all three primitives; save exact request/response and usage.
3. **Development slice:** C01/C02/C15/C16 first, then intentional/noop and orchestration contrasts. Fix ambiguity using development cases only.
4. **Calibration slice:** choose abstention thresholds and any empirical probability transform, then freeze them. Keep raw probabilities alongside transformed values.
5. **Sealed evaluation:** run preregistered arms and perturbations without rubric changes or favorable reruns. Report every failed/unknown case.
6. **Shadow agent loop:** evaluate actual patches and blind-review their architectural value; no new CI semantic gates.

Use paired evidence ablations to find the source of value: code alone; added raw observations; added normative taste; added positive examples; added counterexamples; removed callers; removed contracts; misleading aggregate score; misleading agent narrative. Predeclare a small subset before running the full factorial combination. Otherwise the experiment itself becomes an expensive selection loop.

For stability, choose a documented subset and repeat each exact request a fixed number of times, initially five. Those repetitions estimate variability on that subset; they do not multiply the number of independent architectural cases. Shuffle A/B positions and option order using recorded seeds. Every request attempt remains in the ledger.

## 6. Metrics and their precise meanings

**Agreement and ranking.** Report criterion-level confusion matrices, class-balanced accuracy when labels are imbalanced, and case-level preferred-candidate agreement including ties/unknowns. Report uncertain and incomparable human cases separately. Absolute score deltas and A/B preference should not be treated as interchangeable labels.

**Probability quality.** For a binary event, Brier loss is the average of `(p - y)^2`. For a categorical event, declare whether multiclass Brier sums or averages across classes and keep that definition fixed. Report log loss with any numeric clipping epsilon disclosed; do not hide confident errors through clipping. For ordered rubrics, inspect cumulative-level calibration as well as top-level classification. Describe empirical calibration as agreement with reviewed rubric labels, not metaphysical architecture truth.

**Selective guidance.** At each threshold selected on calibration data, report coverage (fraction receiving actionable guidance), error among actionable decisions, and severe-error counts. Compare provider confidence against simple distribution measures. An excellent conditional error rate at 2% coverage may be useless. Abstention is not a correct architectural answer, but correct recognition of insufficient evidence is a separately labeled capability.

**Safety of the score loop.** Count behavior/contract regressions, metric-gaming successes, inappropriate exemptions, missed new obligations, changed-policy comparisons and artifacts accepted from unauthorized producers. Some are deterministic harness failures rather than model failures; report both. Zero observed failures does not establish a zero failure rate.

**Statistical uncertainty.** Resample or compute intervals at the independent decision-lineage level, not the question level. Publish denominators per family and use paired analysis for provider comparisons. With only 40 independent trials and zero errors, the one-sided exact 95% upper bound on the error rate is about 7.2% (`1 - 0.05^(1/40)`), illustrating why a small pilot cannot certify rare failures. Report a formal interval only when its sampling assumptions reasonably match the cases; otherwise show counts and limits.

**Operational value.** Record evidence-build time, API and end-to-end latency, cache-hit rate, tokens, monetary cost under the observed price, retries, unknown rate, reviewer minutes, candidate count and tests run. Report cost per evaluated case and per accepted useful recommendation, not just per API call. Do not convert provider marketing latency into a repository throughput estimate.

**Human utility.** Review recommendations blind to provider and score, marking actionable/unsupported/incorrect/needs-context and recording time to decide. Follow-up maintenance outcomes and future refactor reversals are useful later, but do not pretend a short spike establishes long-term maintainability or causal defect reduction.

## 7. Proposed gates, not adopted policy or measured results

Before sealed evaluation, the maintainer should accept or revise this experimental profile. Defaults below authorize at most **shadow/advisory work**, never direct semantic hard gating. If the sample does not support the statistical gate, record `inconclusive` and expand data rather than lowering the threshold after seeing answers.

| Gate | Proposed criterion | Scope / failure action |
| --- | --- | --- |
| G0: artifact integrity | All deterministic validation, replay, unknown-state and policy-tampering acceptance tests pass | Any failure blocks runtime integration |
| G1: basic discrimination | At least 80% agreement on unambiguous held-out decisions for the selected family, with denominators/intervals disclosed | Otherwise keep that family experimental |
| G2: useful added value | Positive paired improvement over structural-only judgment on the primary architectural task; report uncertainty; compare conventional evaluator at matched budgets | Uncertain evidence means inconclusive, not a claimed win |
| G3: taste sensitivity | At least 80% of reviewed policy-counterfactual cases follow the correct profile-specific direction; no gain on unrelated-policy controls | Otherwise taste is not operationally encoded |
| G4: selective guidance | At least 60% actionable coverage and one-sided 95% upper bound on wrong actionable guidance no greater than 10% in the supported family | Insufficient sample or poor tradeoff keeps manual/shadow mode |
| G5: robustness | No successful policy/artifact bypass; no severe reviewed architectural regression presented as actionable in the sealed adversarial slice | Pause affected family; add counterexamples on development data |
| G6: operational fit | Measured full-loop cost and p95 latency within explicit run-manifest budgets agreed before execution | Budget fields may not remain null at adoption time |
| G7: actual patch value | Blinded maintainers prefer the changed code on the declared criterion, with required independent checks passing and unchanged policy | Score gain alone is not acceptance |

No numeric confidence cutoff is selected here. A provider value such as 0.9 is not automatically a 90% correctness guarantee. Set family-specific thresholds on the calibration split using the chosen error/coverage tradeoff. Severe contract regressions remain unacceptable regardless of a high mean.

Distinguish outcomes: `pass`, `fail`, `inconclusive`, `not_run`, `blocked_access`, `blocked_data_authorization`. Do not use pass/fail to suppress uncertainty or silently drop unsupported question families from published totals.

## 8. First-access runbook

This is the order to follow once credentials exist; it is not work already executed.

**Before any API request:** re-read current official docs and account terms; confirm permission for the chosen public/synthetic material; record model identity options; configure a hard monetary/request cap in the harness. Keep credentials in environment/secret storage and never in packets, artifacts, logs or this public repo. Check that packet preview contains only allowed files and that test labels are absent.

**First request:** send an innocuous synthetic state with one Choice, one Score and one Noul. Inspect raw JSON and usage. Confirm response key mapping, distribution shape and Score legend. Keep request/response receipts; record `model_revision_status = unresolved` unless actual pinning is established. A shape smoke test does not validate code judgments.

**First architecture session:** run a small fixed batch of the materialized C01/C02/C15/C16 development cases, with JQ-01/JQ-02 readiness/policy checks and JQ-04–07/JQ-17 as applicable. Keep human labels hidden from inference. Manually inspect every disagreement, recording whether the cause is evidence, question ambiguity, taste conflict, provider behavior or implementation error.

**Next bounded experiment:** compare paired full-context and missing-context variants; run policy counterfactuals; compare the structural and conventional-model arms. Save all outcomes, including ties, rejected alternatives and failed calls. Do not start an agent reward loop until basic judgment quality is credible.

**Before broader use:** freeze the selected family, calibrated thresholds and artifact contract; run the sealed slice; then exercise a small shadow repair loop. Publish the supported scope and limitations. Record failure as a useful result, not a reason to omit the run.

### Existing commands versus proposed commands

The existing repository workflow can gather structural evidence before access:

```sh
# Run in a source checkout with the repository-pinned Bun version.
bun install --frozen-lockfile
bun run dev agent catalog /absolute/path/to/fixture
bun run dev agent score /absolute/path/to/fixture --full
```

Preserve stdout JSON and exit status, including incomplete evidence. A fixture enabling project modules requires the trust/dependency setup in [the agent guide](../agent-first.md); do not add trust flags blindly. `pulsar semantic prepare/evaluate/replay/compare/bench` are proposed names in the architecture, **not implemented commands**. The mock compiler and live harness are future PJS work items.

## 9. Question-bank compilation and validation

The JSON companion has a top-level catalog, 24 templates, readiness requirements, intended usage, related research questions and example case IDs. Its scores have illustrative local utility maps, not adopted weights or calibration thresholds. It is deliberately outside `.pulsar`.

A future compiler must:

- Select compatible questions for one evidence packet and include all required state fields. Bind `focus` explicitly. Generic comparison/evidence questions need a selected criterion or claim; do not pass a whole architecture essay as the target.
- Prepend `common_instructions` to every emitted question. Jev does not receive question IDs as semantic instructions; each question therefore states its full task.
- Emit only the provider question fields from `question`; keep metadata, utility, labels and research-register links local.
- Include readiness checks with requirements specific to the selected questions. A single ready answer must not authorize unrelated dimensions with missing evidence. For the first compiler, one narrowly scoped evaluation unit with the union of its requirements is a conservative default; optimize batching only after masks are tested.
- Treat scores as unconsumed when required evidence/policy is missing or conflicted. An uncertain Noul is not a medium-quality score. Unknown must never be inserted as the lowest ordered quality level.
- Perform dependent reason/evidence selection in a second request only when it actually depends on a previously returned claim; otherwise batch independent questions over the same state.

Offline acceptance checks should verify unique IDs; valid references to E/C IDs; complete instruction text; all required state paths bound; 2–10 Score levels with equal-length utility arrays; valid Choice alternatives; binary Noul criteria; and presence of uncertainty/none paths where forced selection would be misleading. On live responses additionally validate answer identity, probabilities, legends, finite numbers and version metadata. Passing these checks establishes structural validity, not semantic accuracy.

## 10. Result record and handoff template

Each run writes an immutable manifest and append-only case records outside active policy. Example shape, deliberately with no invented results:

```json
{
  "schema": "pulsar.jev_spike_run.v1",
  "run_id": "ASSIGN_AT_EXECUTION",
  "status": "not_run",
  "repository_sha": "fe84b1212148564703ebbaff0ee7f3c3df1c668f",
  "experiment_ids": ["E09", "E10", "E17", "E23", "E35"],
  "corpus_manifest_hash": null,
  "label_manifest_hash": null,
  "split_manifest_hash": null,
  "evaluation_policy_hash": null,
  "provider": null,
  "requested_model": null,
  "resolved_revision": null,
  "model_revision_status": "unresolved",
  "request_budget": null,
  "monetary_budget": null,
  "latency_budget": null,
  "planned_case_ids": ["C01", "C02", "C15", "C16"],
  "results": [],
  "gate_decisions": [],
  "limitations": ["No live evaluation has been performed."]
}
```

A case record contains lineage and variant IDs, exact packet/request/response hashes, selected templates, policy and cohort identity, source references, all attempts, output distributions, applicability/unknown reasons, elapsed time/usage, and separate scored references to blinded labels. Keep sensitive labels separate from provider-facing records. Distinguish raw judgments, empirical calibration outputs, deterministic score composition and the final human action.

For each E-row, record date, run IDs, observed evidence, vendor statement if relevant, answer, uncertainty, architectural consequence and next test. A useful report includes the worst failures and cases where the conventional baseline won—not just successful demonstrations.

The final spike decision should name supported question families, unsupported families, chosen provider, scope limitations, operational cost, needed context, score-series identity, rollback conditions and the next implementation work item. The existing [architecture delivery sequence](jev-semantic-judgment-architecture.md#11-delivery-sequence-and-code-touch-map) remains the implementation handoff; this report supplies the evidence for advancing it.
