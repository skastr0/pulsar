# Jev semantic judgment: architecture proposal and pre-access spike

**Status:** Proposed; no Jev access or live evaluation used to prepare this document.  
**Date:** 2026-09-16.  
**Repository inspected:** `fe84b1212148564703ebbaff0ee7f3c3df1c668f`.  
**Original change scope:** Documentation and an experimental question catalog only. No active policy, runtime, dependencies, published API, or enforcement changes.

**Follow-up:** A research-only adapter and first live probes now exist; see [measured results and limitations](jev-spike-results.md). This remains the broader proposed architecture, not an inventory of delivered capabilities. Production scoring and enforcement remain unchanged.

Start here for architecture. Use the [evaluation plan and unanswered experiment register](jev-spike-evaluation-plan.md) as the original design record. The machine-readable question bank is retired; templates and recovery live in [jev-research-archive.md](jev-research-archive.md). These artifacts are proposals, not evidence that Jev works for architecture. Nothing under this exploration is automatically loaded as repository policy. Research scripts that would have executed the spike are deleted.

## 1. Decision and intended outcome

Build an optional, provider-independent semantic judgment layer around Pulsar's deterministic evidence and repository-owned calibration. Jev is the first provider to evaluate, not a dependency of the core product contract.

The objective is **operational architectural taste**: Pulsar should identify conditions, interpret them against a declared architectural standard, compare realistic improvements, and give agents a measurable direction. It should distinguish useful duplication from accidental coupling, coherent orchestration from unrelated responsibilities, and a genuine improvement from a metric-only improvement.

The proposed division of responsibility is:

- **Pulsar:** collect evidence, resolve shared policy, construct questions, validate responses, preserve provenance, compose scores, compare changes, and enforce deterministic constraints.
- **Jev or another evaluator:** estimate answers to bounded semantic questions over supplied evidence.
- **A coding/reasoning agent:** investigate missing context, propose candidate designs, implement patches, and explain recommendations when templates are insufficient.
- **Repository maintainers:** own architectural intent and approve policy classes, exceptions, and evaluation standards. They need not label every production instance.

A score means *estimated alignment with this repository's declared criteria under a particular evaluator and evidence set*. It is not a probability that the architecture is correct, proof of behavioral equivalence, or a universal ranking of repositories.

The initial capability is not an autonomous architect. It is a **grounded decision service** for one consequential question: should this abstraction be extracted, retained, or dismantled? The full target includes architecture guidance, refactoring direction, and a replayable semantic scorecard. Begin with evidence sufficient to validate that target rather than building a large unvalidated scorer.

## 2. Existing foundations and actual integration gaps

The following inventory is based on the inspected revision, not an assertion about future `main`. Relative links resolve within this repository; the SHA above fixes the research baseline.

| Existing surface | What is present | What the spike must add or establish |
| --- | --- | --- |
| [Agent guide](../../AGENTS.md), [default philosophy](defaults-vs-programmable-taste.md) | Shared repo/org policy; explicit opt-in taste; generic defaults | Keep semantic taste opt-in and shared, not per-agent or vendor-defined |
| [Calibration contracts](../../packages/core/src/calibration-model.ts) | Typed slots, attributed decisions, processor identity, Effect execution | A validated, read-only semantic reference service; no inference inside slots |
| [Processor architecture](calibration-processor-architecture.md) | Sensors, processors, mixer separation | Preserve raw evidence when adding model interpretations |
| [Self-calibration](../../.pulsar/modules/pulsar-self.ts) | Repo-local role classification and intentional exceptions for integration code | Use as a source of candidate taste examples, not independent ground-truth labels or universal defaults |
| [AI artifact implementation](../../packages/core/src/ai-facts.ts) | Label schema, fingerprints, replay serialization, restricted enforcement ceiling | Distribution-valued judgments, explicit unknown states, input verification and producer trust |
| [AI artifact tests](../../packages/core/src/__tests__/ai-facts.test.ts) | Fixture replay and observer serialization tests | Tests of real semantic correctness and counterexamples; the illustrative fixture score is not a validated evaluator |
| [AI artifact design](ai-classified-fact-artifacts.md) | Pre-scoring production and offline replay contract | Broad loading and runtime integration remain open in that design |
| [Reference-data loader](../../packages/core/src/reference-data-loader.ts) | Glossary, conventions, coverage, contract-freshness and domain-construction loading | No AI-artifact directory loader is wired there at this revision |
| [Agent identity](../../packages/cli/src/agent-identity.ts) | Source-byte input identity and selected reference-policy identity | Separate evaluator policy, source snapshot, artifact-set and cohort identities |
| [Agent workflow](../agent-first.md) | `agent catalog`, `agent config`, `agent score`, `--expect-policy`, incomplete-evidence reporting | Add optional semantic preparation, assessment and comparison without changing existing meanings |

Important implementation observations: `replayAiFactArtifact()` serializes supplied artifacts; it does not itself re-read source files to prove freshness or authenticate their producer. The current AI cache identity contains prompt/model/classifier/input fields, but not a complete new semantic-evaluator policy. The agent reference-policy fingerprint does not currently include a Jev rubric or evaluator manifest. Those are work items, not guarantees to inherit by naming new fields.

The existing design prohibits direct AI hard gates. Preserve that boundary, including for compounds and calibration processors that consume model labels. See [provability tiers](../../ARCHITECTURE.md) and the [AI artifact enforcement contract](ai-classified-fact-artifacts.md).

## 3. TypeSafe capability snapshot and unknowns

Official sources were inspected on 2026-09-16. Recheck at first access; early-access documentation is not a stable compatibility promise.

| Documented capability | Consequence for this proposal |
| --- | --- |
| State plus typed questions; questions evaluated separately against shared state [T1, T7] | Construct self-contained decision packets; compose dependent stages in code |
| Choice returns an option distribution; documented maximum is 255 options [T3] | Closed vocabularies, evidence IDs, and explicit unknown/none outcomes are feasible |
| Score uses 2–10 ordered descriptive levels and returns their distribution [T4] | Evaluate single dimensions; assign Pulsar utility separately from provider level indices |
| Noul returns a yes probability without a separate confidence field [T5] | Do not invent a provider confidence value for binary questions |
| Choice/Score confidence is computed from the returned distribution [T6] | Retain it as provider metadata, not an independent correctness certificate |
| HTTP evaluation endpoint and `jev-latest` documented [T2] | Implement a narrow adapter; determine actual immutable model identity at access |
| No free-form generation in Jev's stated interface [T0, T8] | Candidate designs, rationales and new policy text come from code/templates or a separate agent |
| Published workflow evaluations use model-consensus reference labels in other domains [T9] | They do not validate Pulsar architectural judgments |

TypeSafe's launch claims about speed, efficiency and schema guarantees are provider claims, not measurements of this integration [T0]. Schema-conforming answers can still select the wrong semantic interpretation. Also, isolated API questions do not imply statistically independent errors.

Unresolved before adoption: immutable model pinning, effective context and request limits, account quotas, transport/retry behavior, retention and training terms for submitted code, deployment options, actual latency and cost on repository packets, and judgment quality under repository-specific taste. The experiment register assigns each an explicit test or vendor question. Do not assume fine-tuning, tools, sessions, arbitrary string output, self-hosting, a seed parameter, or per-question state overrides.

## 4. Invariants

1. **One repository, one effective policy.** All agents evaluate the same adopted taste, rubric, utility and structural configuration. Transport locations are not personal policy layers.
2. **Conventional defaults stay conventional.** The semantic feature is disabled unless explicitly activated. This spike does not modify Pulsar's own calibration.
3. **Evidence and interpretation remain distinct.** A dependency edge is an observation; an architectural-role inference is a model judgment; a declared boundary is a policy decision.
4. **No model calls during deterministic scoring.** Online production and offline consumption are separate operations and capabilities.
5. **Probabilistic inputs retain their ceiling.** Derived values cannot erase AI provenance or weaken proven structural gates. Semantic exceptions do not silently suppress a hard finding.
6. **Unknown is not healthy.** Missing, stale, truncated, failed and conflicted evaluations cannot become a passing zero-pressure value.
7. **Policy is frozen during code improvement.** Proposed taste changes are a separate workflow. A policy change is not a code-quality gain.
8. **Hashing is identity, not authority.** An attacker able to edit both an artifact and its hash can forge a consistent pair. Producer authentication needs a separate trust boundary.
9. **Scoring never certifies behavior.** Tests, compiler checks and contract checks keep their own evidence and limited claims.
10. **No implicit learning from acceptance.** Accepted/reverted commits may suggest taste revisions; they do not update authoritative policy automatically.
11. **A recommendation must be scoped and falsifiable.** Identify the affected code, declared criterion, competing options, unknowns, and post-change checks.
12. **The evaluator is replaceable.** Keep raw probability semantics, provider identity and differences visible rather than pretending every provider has equivalent calibration.

## 5. End-to-end architecture

```text
Pinned source snapshot + adopted repo/org policy
                  |
           deterministic collection
                  |
       raw facts + calibrated structural evidence
                  |
    subject inventory + bounded context construction
                  |
           decision packet manifest
                  |
       [explicit online capability boundary]
                  |
       Jev adapter / comparator adapter
                  |
       response validation + trusted recording
                  |
       immutable judgment artifacts + receipts
                  |
          [offline replay boundary]
                  |
        semantic dimensions + coverage + uncertainty
                  |
     structural constraints + comparison + guidance
                  |
           agent proposes / implements
                  |
    independent checks + new snapshot + reassessment
```

There are three logically separate streams: measured source facts, adopted normative policy, and fallible semantic judgments. Carry each stream's provenance through composition. Do not feed previous model classifications into new requests as unqualified facts.

### 5.1 Decision subjects and evidence construction

Use subjects such as a symbol, dependency edge, clone group, module boundary, responsibility cluster, or candidate patch. File-only scoring cannot describe relationships that cross files. Whole-repository judgment is an aggregation goal, not the default unit of inference.

A packet contains a source snapshot ID, stable subject identity, actual source excerpts, caller/callee or import relationships, relevant contracts/tests, applicable policy and approved examples, deterministic observations, and explicit omitted-context metadata. For comparisons, include complete relevant before/after slices and the same obligation set. Source locations use path, symbol/range, blob/content hash and snapshot identity; line numbers alone are not durable evidence.

The context builder is deterministic and bounded. Start with the subject and expand along declared dependency/caller rules until required evidence is present or a recorded budget is reached. Handle unresolved imports, generated sources, binaries, submodules, symlinks and unavailable history explicitly. Never silently truncate code or follow a symlink outside the allowed root.

Every packet has both a **payload fingerprint** over the exact model-visible bytes and an **evidence-manifest fingerprint** over what was considered, included, omitted, redacted and why. A request budget or selection algorithm change can change meaning even when the principal source file does not change.

Maintain a local-only evaluator manifest separately from provider state. Human labels, expected outcomes, split membership, the agent's target score and previous aggregate scores must not enter the normal inference payload. Candidate author names and persuasive patch summaries are omitted in the primary arm. Treat their inclusion as controlled ablations, not helpful default context.

Use structural signals to prioritize, but reserve a predeclared sample of low-signal subjects and inspect module relationships. Otherwise the semantic layer can never discover important problems that existing detectors miss. Scope the first report to the evaluated cohort; do not advertise it as a complete repository architecture score.

### 5.2 Taste specification

Taste comprises a declared principle, scope, positive examples, counterexamples, exceptions, and a statement of the tradeoff. For example:

> In this repository, vendor adapters should evolve independently. Share stable domain transformations, not incidental similarity in retry and lifecycle orchestration.

Another repository may reasonably adopt a different standard. Neither becomes Pulsar's default. Scope can distinguish domain code, public libraries, generated bindings, framework integration and tests, with explicit conflict resolution when multiple policies apply.

Keep three calibrations separate: structural interpretation, normative taste, and empirical probability calibration. Adjusting a duplication weight is not teaching the evaluator a concept. Adding examples is not proving probability calibration. A post-hoc probability transform is not a new architectural principle.

Reuse executable project modules for policy that needs code; do not replace them with a closed JSON DSL. Versioned prose and the question-bank JSON are authoring/reference surfaces. Resolve them into an immutable effective policy manifest with module source hashes, criteria, examples, scope rules, utility maps and activation evidence.

Human review authorizes policy classes once. Unrecognized cases can produce proposals for new classes, with representative examples and counterexamples; they do not require a permanent manual approval queue for every instance.

### 5.3 Services and implementation boundaries

Prefer internal modules during the spike. Do not create a family of public packages before the experimental boundary is stable.

| Proposed component | Responsibility | Forbidden responsibility |
| --- | --- | --- |
| `JudgmentPolicyResolver` | Resolve adopted taste, questions and utilities | Learn policy silently from recent agent output |
| `DecisionPacketBuilder` | Build bounded, content-addressed evidence | Generate authoritative facts from uncited summaries |
| `JudgmentProvider` | Submit prepared questions and return typed answers | Read arbitrary repo files, run tools, edit policy |
| `JudgmentRecorder` | Validate, record exact responses, attempts and provenance | Select the most favorable retry |
| `JudgmentReferenceService` | Load and verify artifacts offline | Refresh a missing result through the network |
| `SemanticAssessment` | Compute dimensions, unknowns and comparison readiness | Redefine existing structural score semantics |
| `GuidanceComposer` | Connect judgments to candidate directions and checks | Claim generated prose is a Jev-authored rationale |

Use the repository's Effect conventions for services, bounded concurrency, cancellation and typed errors. The provider abstraction must distinguish transport failure, malformed response, unsupported capability and a valid uncertain judgment. A mock/replay provider ships first; TypeSafe SDK imports, credentials and network code stay out of core scoring.

Candidate future source locations are `packages/core/src/semantic-*`, an isolated CLI provider adapter under `packages/cli/src/`, and a research harness under `scripts/`. These are proposed paths, not existing APIs. Promote a provider package only after reuse justifies it.

## 6. Provider adapter contract

The documented HTTP operation is `POST https://api.typesafe.ai/v1/systemone`, using bearer authentication [T2]. The request has `state`, `model`, and a `questions` map. Start with string descriptions for compatibility; validate richer nested criteria against the live API before depending on them.

The accompanying question bank contains valid-looking **question templates**, not an entire API request or active configuration. Its metadata is for the harness. The compiler must prepend `common_instructions` to **every** question, bind the selected criterion/subject in state, and send only `type`, `instructions` and `criteria` from a selected template. Question IDs are correlation keys, not semantic instructions; the provider documents that IDs are not shown to the model [T2].

Do not place `unknown` at the low end of an ordered quality scale. Use a separate readiness/applicability Choice and mark dependent results unconsumed unless that condition is met. Independent questions may share one request, but one answer cannot instruct another answer in that same call. A second-stage reason selection or candidate comparison receives the explicitly recorded first-stage result in a new state.

Record requested model alias, response model string, immutable revision when genuinely available, adapter version, request/response fingerprints, question/rubric identities, usage, region, latency and attempt history. An echoed `jev-latest` is not immutable pinning. When pinning is unavailable, label the inference series unpinned, limit reuse across evaluation epochs, and do not present fresh-inference comparisons as fully controlled. Stored artifacts remain replayable.

Validate all expected question IDs and answer types, option/level keys, finite probabilities in [0,1], distribution sums within a declared tolerance, selected-option membership, score range and returned legend. Preserve the raw response before normalization. Never silently drop unexpected fields that affect meaning or repair a broken probability distribution into a plausible one.

Retries are bounded transport recovery, not additional chances to get a favorable judgment. Pin retry policy and record each attempt; consume the first valid successful answer under that policy. Repeated-inference experiments explicitly request and retain all samples. Do not double-retry through both an SDK and an outer Effect policy. Determine live handling for rate limits, overload, deadlines and cancellation before choosing the adapter's production defaults.

## 7. Judgment artifacts, replay and cache identity

Prefer a new `pulsar.semantic_judgment.v1` schema with a compatibility projection into the existing AI-fact surface, rather than overloading `label.value` indefinitely. The new name describes epistemic status: a judgment is not an established fact.

| Record group | Required meaning |
| --- | --- |
| Subject | Repository identity, snapshot, subject ID, scope and source references |
| Evidence | Exact payload hash, selection manifest, included/omitted context and redaction identity |
| Policy | Structural policy, normative criteria, questions, approved examples and utility identities |
| Evaluator | Provider, requested/resolved model, revision status, adapter and empirical calibration version |
| Answers | Raw distributions and provider metadata; no fabricated rationale or Noul confidence |
| Consumption | Applicability, sufficiency, conflict/stale status, unconsumed answers and reasons |
| Provenance | Trusted producer, request/response receipt, attempts, timestamps and storage identity |
| Authority | Tier 3 ceiling and dependency provenance; optional separately reviewed policy artifact links |

`CalibrationConfidence` (`high/medium/low`) and provider numeric confidence are different concepts. Do not map one into the other without a declared, validated interpretation. Model-selected evidence IDs point to supplied snippets; matching their hashes proves the snippets exist, not that they support the judgment. Test evidentiary support separately.

Use distinct identities:

- **Source identity:** code and relevant repository inputs, excluding the generated output store from the new evidence snapshot to avoid self-invalidating loops. Do not silently change the existing `agentInputFingerprint` contract.
- **Evaluation-policy identity:** all interpretation, context-selection, question, example, utility and evaluator-version choices. This must not change during an improvement comparison.
- **Request identity:** exact serialized model-visible payload plus provider request configuration.
- **Artifact-set identity:** exact recorded answers and provenance selected for replay. It changes when new code is assessed; it is not the frozen policy.
- **Cohort identity:** evaluated subjects, obligations, weights and mapping between before/after subjects.

Cache keys include all semantic inputs, not just source-file hashes. A caller, contract, taste example, dependency version or selected model revision change invalidates the affected packet. Changed-context invalidation needs a dependency index; initial conservative invalidation is preferable to false reuse. A dynamic alias cannot safely supply indefinite cache validity.

Replay validates hashes against the selected snapshot, decodes the schema, checks producer trust where required, resolves missing/stale policy, and computes deterministic output. Wall-clock freshness is evaluated against an explicit `as_of` supplied in the replay manifest; deterministic serialization must not insert fresh timestamps or confidence decay on each call. Live freshness views can advance `as_of` without rewriting historical results.

Generated results normally live in repository-scoped runtime state, following the current Pulsar convention. Adopted policy and selected reviewable fixtures may be committed. Do not commit secrets, private code packets, hidden evaluation labels or large raw traces to this public repository. A manifest may reference access-controlled immutable artifacts rather than embedding them.

## 8. Scoring and comparability

Start with a separate semantic scorecard next to the existing structural assessment. Do not change the existing weighted mean, exit behavior or hard-gate logic during the spike.

For subject `s`, criterion `j` and rubric level `k`, let `p[s,j,k]` be the returned probability and `u[j,k]` the repo-owned utility in [0,1]. Define:

```text
q[s,j] = sum_k p[s,j,k] * u[j,k]
```

This is an expected rubric utility, not truth probability. Non-equally spaced utility is allowed but requires explicit policy. A provider's numeric Score is an expected level index; recompute Pulsar utility from the distribution. Do not weight quality by confidence: uncertain good design and confidently bad design are different states.

For a fixed eligible cohort with weights `w[s,j]`, total weight `W`, and observed valid cells `O`:

```text
coverage = sum_(s,j in O) w[s,j] / W
observed_alignment = 100 * sum_(s,j in O) w[s,j] * q[s,j]
                         / sum_(s,j in O) w[s,j]
unknown_mass = 1 - coverage
```

If no valid cells exist, alignment is `null`. With `W = 0`, the assessment is not applicable, not perfect. Publish dimensions, coverage, unknown reasons and obligation status alongside any scalar.

A conservative missing-data sensitivity interval can assign unobserved cells utility 0 or 1. It describes missing-data bounds only; it is **not** a confidence interval and does not include model error. Do not claim statistical precision by treating correlated questions as independent samples. Any empirical uncertainty interval must come from the held-out evaluation design.

### 8.1 The optimization contract

Keep protected structural constraints outside compensation by averages. An increased semantic score cannot erase failing tests or a proven boundary violation. Conversely, a low-confidence semantic concern alone does not become a new CI hard gate.

Each improvement episode freezes policy and the baseline obligation inventory. Compare mapped subjects on matched criteria and show added/removed/unknown mass explicitly. Splitting one module into ten files must not multiply its contribution. Deleting an implementation does not retire its obligation; legitimate feature retirement requires an explicit scope decision outside the improvement score. New production subjects cannot disappear from a report because they have not been evaluated.

Use a baseline cohort score and a current-coverage/new-obligation report together. There is no universally comparable repository scalar while scope changes are uncontrolled. Subject mapping failures make the affected comparison unknown. Rebaseline only as a separately recorded policy/scope event, with an explanation of the discontinuity.

Before/after preference is measured both through absolute single-dimension rubrics and a criterion-specific pairwise question. Prefer robust improvements that agree across the two views. Re-evaluate both snapshots under a new evaluator before connecting score histories; never compare an old score from one model to a new score from another as though only code changed.

## 9. Architecture guidance and the agent loop

A recommendation record contains the decision subject, criterion and policy IDs, evidence references, candidate IDs, tradeoff, expected dimension changes, uncertainty, alternative/no-change option, implementation constraints and acceptance checks. Template prose may render selected reason codes. Agent-written explanations are separately labeled and checked for support; they are not additional evidence.

Example, illustrative rather than evaluated:

```text
Subject: duplicated vendor adapters
Options: retain both / shared lifecycle superclass / shared domain normalizer
Taste: independent vendor lifecycles; shared stable domain transformations
Potential direction: extract the normalizer, retain separate orchestration
Check: adapter contracts still pass; lifecycle policy remains local;
       mapped boundary and change-locality criteria improve
```

Jev assesses narrow properties of the options. Pulsar composes a recommendation; it does not ask Jev to generate a design out of a score. Candidate quality limits the search: include no change and rejection of all offered alternatives. An unimplemented design receives only a hypothesis-level assessment. Award observed improvement only after evaluating actual changed code and independent checks.

The loop is: snapshot and freeze policy; collect evidence; assess; investigate uncertain cases; generate a small candidate set; compare; implement one patch; run actual repo checks; rebuild affected packets; replay and compare; stop or retain. Predeclare iteration/candidate budgets and stop on plateau, contradiction or exhausted evidence budget. Preserve all proposals and evaluations so repeated querying cannot hide failed attempts.

A coding agent may propose policy updates, but the optimization process cannot adopt its own exemptions. Separate policy updates and source repairs in review/history. The stronger mode puts evaluator credentials, trusted records and held-out labels outside the editing agent's write permissions. Shared writable local files provide convenience, not independent assurance.

## 10. Security and failure behavior

| Threat/failure | Required treatment |
| --- | --- |
| Code comments or docs attempt to instruct the judge | Treat source as untrusted material; tested prompt boundaries; no tools or write privileges for the provider; injected content is an adversarial test case |
| An agent forges favorable artifacts | Authenticate the trusted recorder or use controlled storage; hashes alone are insufficient |
| An agent weakens taste or suppresses obligations | Frozen external policy/cohort identity; report policy mismatch and refuse the improvement claim |
| A model label flows into a hard-gating classifier | Propagate Tier 3 provenance transitively; retain independent structural findings |
| Provider failure, missing answer, malformed JSON, stale code | Emit attributable incomplete/failed semantic status; preserve structural results; never substitute healthy defaults |
| Private code or secrets enter external state | Explicit egress allowlist and payload preview; respect source authorization; approve provider data terms before private packets |
| Trusted project modules read arbitrary environment/network state | Pin dependencies and isolate the evaluator where assurance requires it; `--trust-project-code` is not a sandbox |
| Wrong but confident classification | Measure on held-out cases, retain distribution, cap semantic authority, enable family-specific rollback |

Network permissions belong only to explicit preparation/evaluation. Offline replay must be tested with the network disabled. Deterministic checks of manifests, paths, source hashes and allowed authority can block an invalid assessment artifact; that is not treating a semantic opinion as a code-quality hard gate.

A human-reviewed architectural role may become explicit reference policy and enable a deterministic boundary rule. Merely signing off a model's numeric score does not turn future semantic predictions into structural proofs. Separate policy ratification, instance review and deterministic rule extraction.

## 11. Delivery sequence and code-touch map

All new commands below are proposed interface names, not runnable today: `pulsar semantic prepare`, `evaluate`, `replay`, `compare`, and `bench`. Keep the existing `pulsar agent` protocol intact until an explicitly versioned extension is designed.

| Work item | Timing | Proposed change and acceptance evidence |
| --- | --- | --- |
| PJS-01: freeze experimental contract | Before access | Maintainer selects initial taste, question families, error costs and gates; record unresolved disagreements |
| PJS-02: corpus and labels | Before access | Materialize repository-shaped before/after cases; group split by decision lineage; no invented labels |
| PJS-03: artifact and policy schema | Before access | Decode/validation tests; schema versioning; explicit unknowns and transitive ceiling |
| PJS-04: mock/replay harness | Before access | Deterministic serialization, no-network test, invalid/stale/forged artifacts rejected |
| PJS-05: evidence builder | Before access | Content-addressed source/caller/contracts packets; deterministic budgets and omissions |
| PJS-06: request compiler | Before access | Compile the question bank; prepend common instructions per question; validate mappings and applicability masks |
| PJS-07: provider contract probe | First access | Authenticate with a public/synthetic smoke packet; record actual capabilities/model identity; no private code by default |
| PJS-08: transport adapter | After probe | Bounded concurrency/retries, raw response records, budget accounting and cancellation tests |
| PJS-09: narrow evaluation | After access | Run preregistered baseline/ablation experiments; inspect errors before adding families |
| PJS-10: offline runtime consumption | After narrow success | Extend reference-data loading and identity logic; reproduce existing structural behavior with semantic mode disabled |
| PJS-11: shadow guidance loop | After narrow success | Compare actual candidate patches under fixed policy; no score-driven gate changes |
| PJS-12: opt-in integration | After evidence review | Versioned scorecard, family-specific enablement, rebaseline/rollback procedure and published limitations |

Likely integration touches: `ai-facts.ts` for compatibility, new semantic schema/assessment modules, `reference-data-loader.ts` for offline loading, `agent-identity.ts`/`agent-runtime.ts` for identities, and observer/agent serialization for explicit semantic completeness. Avoid importing provider code into any signal compute function. If production signals are added later, follow [signal authoring](../signals/authoring.md) and update the appropriate contract matrix in the same implementation change.

Rollback disables a failing semantic family or provider without deleting artifacts or rewriting history. Structural scoring continues. Enabled-but-unavailable semantic coverage stays incomplete; deliberately disabled mode is reported as disabled. Neither is a falsely clean semantic assessment.

## 12. Spike exit decision

Adopt Jev only for the question families supported by evidence. Valid outcomes include: semantic architecture comparison is promising; Jev is useful only for narrow classifications; a conventional evaluator is better; evidence construction is the bottleneck; or the current rubrics fail to express taste reliably. Preserve the provider-independent architecture in each case.

The next action is to materialize the first abstraction-decision cases and freeze the experimental contract, not to implement every proposed service. The [evaluation plan](jev-spike-evaluation-plan.md) defines the questions, controls, gates and recording format that make the first live session useful.

## Sources

Primary TypeSafe documentation; accessed 2026-09-16. Capability statements above are sourced here; implementation and experimental choices are Pulsar proposals.

- **T0:** [Introducing System One Models & Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), published 2026-09-15.
- **T1:** [Introduction](https://docs.typesafe.ai/introduction).
- **T2:** [HTTP API reference](https://docs.typesafe.ai/api).
- **T3:** [Choice](https://docs.typesafe.ai/primitives/choice).
- **T4:** [Score](https://docs.typesafe.ai/primitives/score).
- **T5:** [Noul](https://docs.typesafe.ai/primitives/noul).
- **T6:** [Confidence](https://docs.typesafe.ai/confidence).
- **T7:** [State](https://docs.typesafe.ai/concepts/state).
- **T8:** [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).
- **T9:** [Workflow evaluation methodology](https://evals.typesafe.ai/).
