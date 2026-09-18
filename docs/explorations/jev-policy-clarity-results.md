# Operationally precise policy wording stabilizes these development judgments

**Observed:** 2026-09-17. **Scope:** 116 live requests over three real Pulsar decision cases. No production code, signal, score, weight, cache, vector, or adopted calibration changed. This is further research, not an adopted repository preference or a production scoring design.

This follows [the question-shape experiment](jev-question-shape-results.md) and corrects one of its readings. It also tests the structured-instruction guidance in [Advanced: structure](https://docs.typesafe.ai/primitives/advanced) and [How to build with TypeSafe](https://docs.typesafe.ai/concepts/how-to-build-with-system-one).

**Headline.** Stating the same repository policy operationally — a boundary definition with `what`, `not_for`, and contrasting examples, plus explicit `focus` and `precedence` — moved every development-case judgment from a near tie or a label-driven split to a stable, decisive answer, and the answers tracked the policy's *direction* rather than the policy's *precision*: flipping the stance at constant precision flipped the physical verdict in all 12 discriminating samples. Serializing that content as JSON objects instead of prose produced the same observed preference outcome on the development cases, but the format arms were not content-matched, so that is outcome agreement rather than a controlled format result. Precision did **not** fix contradictory or absent policy: among 8 samples whose two supplied rules genuinely require incompatible outcomes, the contradiction was reported once; and all 12 samples with no policy produced a preference answer the absent policy does not support.

## Revision after review (2026-09-17)

An external review of the archived work found interpretation defects, and a second review of rev2 found three more in the format claim. This document corrects all ten, in two rounds, without changing any recorded evidence. The three recorded plans, all 116 intents and receipts, and the first archive are **unchanged**; only annotations, analysis code, and this document changed.

| # | Defect | Correction |
| --- | --- | --- |
| 1 | "Twelve fresh samples" contradicted the 8+8 table, and "2-4 observations per cell" contradicted pooled n=8 cells. Some prose described a *cell* as "physically split", which no single sample is. | Batch-local and pooled counts are now stated separately, and cells are described as aggregates. |
| 2 | Repeated label choices were reported as a proven latent "fixed label prior" mechanism, and the cache baseline was called a near tie. | Softened to observed label/position sensitivity. The mechanism claim and the claim that it caused earlier reversals are withdrawn. The cache baseline is described as label-sensitive with a moderate margin; only the observer-batch baseline is a near tie. |
| 3 | The held-out rationale said "no deterministic rule resolves it". | Wrong. Once a policy selects which candidate rule applies, the supplied facts decide the answer. The case tests policy-sensitive rule application, not architectural insight. |
| 4 | Section on obligations implied all obligations were verified and called the test contract "passing". | Declared runtime-context obligations are now separated from repository/test compatibility, and the finite runtime probe is labelled as a probe. |
| 5 | The `opposing_single_callsite` batch was described as an untouched preregistered held-out test. | Described as an exploratory follow-up whose condition was chosen after the degenerate first `opposing` result, with the prediction frozen in the plan before those eight calls. |
| 6 | All 12 `conflict` samples were read as missed contradictions. | The held-out conflict fixture does not require incompatible outcomes, so its 4 samples are excluded. 8 genuine-conflict samples remain. |
| 7 | `equivalent` under missing policy was called correct abstention. | It is not. It declines an A/B ranking but asserts an equivalence the absent policy does not support. |

### Second review round (2026-09-17)

A further review of rev2 found that the format manipulation was described as a content-matched control when it is not. Three more corrections, again documentation-only.

| # | Defect | Correction |
| --- | --- | --- |
| 8 | "Format alone changes nothing" was presented as a controlled finding. | Narrowed to observed **outcome** agreement between format arms at the same substance level. The control is incomplete and is now described as such. |
| 9 | The frozen batch was described as 9/7/8 conditions. | It used **8 conditions for observer-batch, 7 for cache and 8 for the held-out case** (23 cells, 92 requests). The ninth held-out condition, `opposing_single_callsite`, did not exist when the frozen batch was built; it was measured in its own batch. |
| 10 | "All three runs reproduce byte-for-byte" was wrong. | Replay re-validates every recorded response and reproduces the same sample set and the same per-sample choices and readiness values (16/92/8, 0 failures). The summary JSON is **not** byte-identical to the pre-revision summary, because cells now carry annotation-derived fields. |

Because the annotation fields feed the case digest, `prepare` now produces a different `casesHash` than the recorded plans carry. The recorded plans and receipts are untouched and still replay: `replay` validates a recorded plan against its own digest, re-validates all 116 recorded responses, and reproduces the same sample set and the same per-sample choices (16/92/8 samples, 0 failures). What changed is the analysis output, not the evidence: the summary now includes `samplesByBatch`, `distinctBatchOrderRepeatCombinations` and `conflictForcesIncompatibleOutcomes`, so the summary bytes differ from the pre-revision summary.

## The correction this experiment tests

The earlier report recorded consolidation `A 0.60 / B 0.36` followed by `A 0.43 / B 0.52` on a byte-identical repeat, and cache preference flipping from physical `optional` to physical `union` after a label swap. The correction under test is that this is primarily **indecision under an underspecified criterion**, not a confident architectural reversal.

Sixteen fresh samples on the original wording (8 per case: 4 in the exploration batch and 4 in the frozen batch, same wording, both orders, 2 repeats per order per batch) support that reading as follows.

| Case (original wording) | Pooled n | Batch-local n | Physical top choice | Mean top probability | Mean margin | Label choices |
| --- | ---: | --- | --- | ---: | ---: | --- |
| Observer batch protocol | 8 | exploration 4, frozen 4 | 4 a / 4 b | 0.52 | 0.09 | 4 a / 4 b |
| Cache representation | 8 | exploration 4, frozen 4 | 4 a / 4 b | 0.70 | 0.49 | **8 a** |

These two cells are different in kind, and the earlier report's single "near tie" framing does not cover both.

- **Observer batch protocol** is a genuine near tie: no sample favours either variant strongly, and the label choice itself is mixed.
- **Cache representation** is not a near tie. Mean top probability 0.70 and mean margin 0.49 describe a moderately confident answer that is **label-driven**: every one of the 8 samples chose the label `a`, so the physical verdict follows the counterbalancing order rather than the code.

Where the wording does not determine an answer, the model often answers with a constant label rather than varying at random. That is an **observed** pattern in this packet set: in 5 of the 24 measured cells the label choice was constant across every sample while the physical top choice differed between orders (`CACHE amb_prose` label `a` 8/8; `OBS amb_struct` label `b` 4/4; `CACHE amb_struct` label `a` 4/4; `CACHE conflict` label `a` 4/4; `FRESH prec_policy_only` label `b` 4/4). The pattern is evidence of label/position sensitivity. It is **not** proof of a latent "fixed label prior" mechanism, and it is **not** proof that the reversals recorded in the earlier experiment were caused by this pattern; that experiment did not counterbalance the way this one does. Two cells (`OBS amb_prose`, `FRESH amb_struct`) split on the label itself, so constant-label behaviour is not universal.

The practical consequence is unchanged and is the reason to counterbalance: a "reversal" observed without counterbalancing can be a label-assignment artifact rather than a changed architectural judgment.

## Design

The treatment is a 2x2 factorial — **substance** (ambiguous vs operationalized) x **format** (prose vs structured) — applied uniformly to the policy text and to the preference question's instructions and option descriptions, plus five additional conditions. The ambiguous and operationalized policies state the *same direction*; only the precision of the boundary definition differs.

| Condition | Policy | Question wording | Purpose |
| --- | --- | --- | --- |
| `amb_prose` | original wording, prose | original, terse | baseline |
| `amb_struct` | original wording, same keys, `null`/empty fields | original, structured | format arm at ambiguous substance; not content-matched, see below |
| `prec_prose` | operationalized, prose | explicit `focus`/`precedence`, option `what` only | substance at constant format |
| `prec_struct` | operationalized, same content as objects | operationalized, structured | format arm at precise substance; not content-matched, see below |
| `prec_policy_only` | operationalized policy | **original terse question** | separates the policy half from the question half |
| `opposing` | operationalized, opposite direction | operationalized | is the rubric operational or a hidden preference? |
| `opposing_single_callsite` | operationalized, opposite direction, held-out case only | operationalized | exploratory follow-up where `opposing` is degenerate |
| `no_policy` | `{}` | operationalized | must not produce a supported preference |
| `conflict` | two binding rules, opposite directions, no precedence | operationalized | must report the tradeoff, not pick |

**Counts.** Every request is a separate call. The design gives **2 repeats per order per batch**, so a single-batch cell holds 4 samples and a cell pooled from two batches holds 8. Counterbalancing is by physical variant (`a` labelled `a` in order 0, `b` in order 1), recorded per request. `samplesByBatch` and `distinctBatchOrderRepeatCombinations` are reported per cell in the merged analysis so pooled and batch-local counts cannot be confused.

| Batch | Purpose | Conditions | Requests |
| --- | --- | --- | ---: |
| `exploration` | pilot on development cases | `amb_prose`, `prec_prose` | 16 |
| `frozen` | all cases, all conditions | 8 conditions for observer-batch, 7 for cache, 8 for the held-out case (23 cells) | 92 |
| `heldout_opposing` | exploratory follow-up, held-out case only | `opposing_single_callsite` | 8 |

Questions are independent, so the four questions in a packet do not consume each other's answers.

### The format control is incomplete

The prose and structured arms were intended to carry identical content so that any difference could be attributed to serialization. Inspection of the recorded plans shows they do not, and this limits what the format comparison can support.

1. **Option-level `not_for` is dropped in every prose arm.** `serializeOptions` emits only `what` when the treatment is prose, so `prec_prose`, `prec_policy_only`, `opposing`, `opposing_single_callsite`, `no_policy` and `conflict` all sent preference options without their `not_for` sharpenings. Only `amb_struct` and `prec_struct` sent them.
2. **`policy_readiness` and `obligations_preserved` option texts differ by format, not only by substance.** Those two questions select their option text from a format flag, so the structured arms use the precise option definitions even when the substance is ambiguous. `amb_struct` therefore received precise `policy_readiness` and `obligations_preserved` definitions alongside an ambiguous policy and ambiguous preference options — a substance leak into the ambiguous condition for those two secondary measures.
3. **Content parity therefore holds only for the policy text and the `evidence_readiness` options.** The preference question's *primary* content (`what`) is matched between `amb_prose` and `amb_struct`, but `prec_struct` additionally carries preference-option `not_for` text that `prec_prose` does not.

Consequences for reading the results:

- The `amb_prose` versus `amb_struct` comparison is **not** a clean format control, because the structured arm received richer option definitions for two of the four questions.
- The `prec_prose` versus `prec_struct` comparison is **not** a clean format control either, because the structured arm received preference-option `not_for` text as well.
- `policy_readiness` and `obligations_preserved` cannot be used to separate format from substance at all. Their values happened to agree across format arms (both ambiguous arms returned `defined` in every sample), but that agreement is not evidence of a format effect.
- What survives is an **outcome-level** observation about the preference answer: within each substance level, the two format arms returned the same physical verdict on the development cases. That is agreement of observed outcomes, not a controlled isolation of serialization.

This defect was found after the calls and is recorded rather than repaired. Fixing it would change request content, and no further calls were made.

**Cases.** `observer-batch-protocol` and `cache-lookup-representation` are the development cases from the previous experiment; their wording was inspected as a pilot before the frozen batch and then re-run unchanged (both batches carry the same `casesHash 2926632f…`). `factor-policy-boundary` is the **held-out** real Pulsar decision, never used to tune wording: whether the named boundary `configFactorOverridesOf` in `packages/core/src/factor-ledger.ts` stays a separately exported function or is inlined into its only production caller. The held-out case reuses the development cases' helper-boundary rubric verbatim, so it measures rubric transfer rather than freshly tuned text.

**Expected outcomes are agent-authored, not human ground truth.** Each case carries a rationale, the independent evidence bearing on it, a compatibility note per variant, and a note on whether a deterministic rule alone decides it. None of that enters provider input; a test asserts the requests contain no expectation text, no `variants.` reference in the policy, and no variant source path in the policy.

## Independent evidence, and what it does not establish

Computed outside provider input by the retired `bun scripts/jev-policy-clarity.ts evidence` command ([snapshot](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-policy-clarity.ts)), and asserted by retired tests.

| Case | Check | Result |
| --- | --- | --- |
| Observer batch protocol | Pre-existing behavioral suite executes both variants and asserts equal outputs, signal results, inactive ids, metadata, profiles, invocation counts and batch inputs | Equal; no behavioral difference to judge |
| Cache representation | Fixed-clock runtime lookup comparison plus `tsc` on the consumer module | Lookups identical; both variants' consumers compile |
| Factor-policy boundary (held-out) | `tsc` on the module, `tsc` on the existing test module, runtime context over 5 probed inputs | Both variants compile the module (exit 0); variant `b` **fails the existing test module** (`error TS2305: Module '"../factor-ledger.js"' has no exported member 'configFactorOverridesOf'`); contexts identical over the 5 probed inputs |

**Declared obligations are not repository compatibility.** The held-out case declares runtime-context obligations: the resolved context fields, and the `resolvedConfig` read-back invariant. Variant `b` preserves both over the probed inputs — the inlined body still reads back from `resolvedConfig`, though the comment documenting the invariant is gone. Variant `b` is nevertheless **not a verified applicable refactor**, because the existing test module imports the removed export and no longer typechecks. Adapting that test was not part of this experiment.

**A finite probe is not a proof.** "Identical over 5 probed signal/vector inputs" does not establish "identical for any signal and vector". The Noul answer discussed below speaks to the declared obligations over the supplied evidence; it says nothing about compatibility or about unprobed inputs.

**Where a deterministic rule already decides, say so.** The observer-batch case is decided by call-site and ownership counting (four private helpers, one call site each, one owner). The cache case is decided by a compiler probe plus one explicit sentence of the policy. The held-out case has two *candidate* rules that select different variants, and no rule decides it **until a policy selects which rule applies**; once selected, the supplied facts determine the answer. So in all three cases the policy's contribution is choosing a rule, not discovering a fact, and a provider agreeing with the agent expectation is evidence that the stated rule was applied rather than evidence of architectural insight.

## Results

All 116 requests returned HTTP 200 and validated on replay. Every response identified `jev-1.13.0`.

`n` is pooled. `local n` gives the batch split.

| Case | Condition | n | local n | Physical top choice | Mean top p | Mean margin | Label choices |
| --- | --- | ---: | --- | --- | ---: | ---: | --- |
| Observer batch | `amb_prose` | 8 | explore 4 / frozen 4 | 4 a / 4 b | 0.52 | 0.09 | 4 a / 4 b |
| Observer batch | `amb_struct` | 4 | frozen 4 | 2 a / 2 b | 0.50 | 0.04 | b x4 |
| Observer batch | `prec_prose` | 8 | explore 4 / frozen 4 | **b x8** | 0.95 | 0.92 | 4 a / 4 b |
| Observer batch | `prec_struct` | 4 | frozen 4 | **b x4** | 0.93 | 0.88 | 2 a / 2 b |
| Observer batch | `prec_policy_only` | 4 | frozen 4 | **b x4** | 0.96 | 0.94 | 2 a / 2 b |
| Observer batch | `opposing` | 4 | frozen 4 | **a x4** | 0.99 | 0.98 | 2 a / 2 b |
| Observer batch | `no_policy` | 4 | frozen 4 | `equivalent` x4 | 0.65 | 0.49 | equivalent x4 |
| Observer batch | `conflict` | 4 | frozen 4 | a x4 | 0.76 | 0.64 | 2 a / 2 b |
| Cache | `amb_prose` | 8 | explore 4 / frozen 4 | 4 a / 4 b | 0.70 | 0.49 | a x8 |
| Cache | `amb_struct` | 4 | frozen 4 | 2 a / 2 b | 0.69 | 0.48 | a x4 |
| Cache | `prec_prose` | 8 | explore 4 / frozen 4 | **b x8** | 0.99 | 0.99 | 4 a / 4 b |
| Cache | `prec_struct` | 4 | frozen 4 | **b x4** | 0.99 | 0.98 | 2 a / 2 b |
| Cache | `prec_policy_only` | 4 | frozen 4 | **b x4** | 1.00 | 0.99 | 2 a / 2 b |
| Cache | `no_policy` | 4 | frozen 4 | b x4 | 0.60 | 0.38 | 2 a / 2 b |
| Cache | `conflict` | 4 | frozen 4 | 2 a / 2 b | 0.74 | 0.54 | a x4 |
| Held-out | `amb_prose` | 4 | frozen 4 | a x4 | 0.67 | 0.39 | 2 a / 2 b |
| Held-out | `amb_struct` | 4 | frozen 4 | 3 a / 1 b | 0.61 | 0.27 | 1 a / 3 b |
| Held-out | `prec_prose` | 4 | frozen 4 | a x4 | 0.63 | 0.39 | 2 a / 2 b |
| Held-out | `prec_struct` | 4 | frozen 4 | a x4 | 0.73 | 0.59 | 2 a / 2 b |
| Held-out | `prec_policy_only` | 4 | frozen 4 | 2 a / 2 b | 0.64 | 0.34 | b x4 |
| Held-out | `opposing` | 4 | frozen 4 | a x4 | 1.00 | 0.99 | 2 a / 2 b |
| Held-out | `opposing_single_callsite` | 8 | follow-up 8 | **b x8** | 0.73 | 0.59 | 4 a / 4 b |
| Held-out | `no_policy` | 4 | frozen 4 | a x4 | 0.58 | 0.36 | 2 a / 2 b |
| Held-out | `conflict` | 4 | frozen 4 | a x4 | 0.91 | 0.87 | 2 a / 2 b |

Agent-proposed expectations were physical `b` for the two development cases and physical `a` for the held-out case. Read as aggregates: each cell contributes one top choice per sample, so "4 a / 4 b" means the 4 samples under one labelling chose `a` and the 4 under the other chose `b`.

### 1. Substantive clarification decides the development cases

On the two development cases, every operationalized cell is physically stable (`distinctPhysicalTopChoices = 1`) and decisive (margin 0.88-0.99), and matches the agent expectation in 16/16 observer-batch samples and 16/16 cache samples. The pooled baselines are physically split across their 8 samples (4 a / 4 b in each case) with margins 0.09 and 0.49.

The held-out case is only partly the same. Its `prec_prose` and `prec_struct` cells are physically stable (a x4 each), but `prec_policy_only` is not (2 a / 2 b), and its margins (0.39 and 0.59) are far below the development cases'. Across all 24 cells, 17 have a single distinct physical top choice.

### 2. Format arms agreed on the observed preference outcome, within the limits of an incomplete control

This is an outcome-level observation, not a controlled isolation of serialization, because the format arms were not content-matched (see [the format control is incomplete](#the-format-control-is-incomplete)).

Within each substance level the two format arms returned the same physical verdict on the development cases. `amb_prose` and `amb_struct` both split (4 a / 4 b from 8 samples, and 2 a / 2 b from 4 samples) with similar margins (0.09 vs 0.04; 0.49 vs 0.48). `prec_prose` and `prec_struct` both selected physical `b` throughout (8/8 and 4/4) with margins within 0.04.

What this does **not** establish: that serialization is neutral. The structured arms additionally received preference-option `not_for` text, and `amb_struct` received precise `policy_readiness` and `obligations_preserved` definitions despite its ambiguous substance, so a format effect could be present and masked, or a substance effect could be present in the structured arms for those two secondary questions. `policy_readiness` and `obligations_preserved` therefore cannot be used to separate the two factors.

One further observation: `amb_struct` produced a constant label choice on both development cases; the prose form already did so for cache, but not observer-batch. On the held-out case `amb_struct` returned 3 a / 1 b where `amb_prose` returned a in all 4 samples. With the control incomplete, this cannot be attributed to serialization as such.

### 3. The gain comes from the policy, not from restating the question

`prec_policy_only` keeps the original terse question and changes only the policy. On both development cases it reproduces the full operationalized result (observer-batch `b` x4 margin 0.94; cache `b` x4 margin 0.99). So the decisive ingredient is the policy's boundary definition, not the explicit `focus`/`precedence` in the question.

On the held-out case the opposite holds: `prec_policy_only` collapsed to a constant label choice (`b` x4, physical 2 a / 2 b). For the contested case, the policy alone was not enough; the question's explicit scope carried it.

### 4. The rubric tracks policy content, not a hidden preference

This is the strongest positive evidence, and the two predictions were frozen in the case definition (and therefore hashed into the plan) before their own calls.

- `observer-batch` `opposing` (same precision, opposite stance): physical **a** in 4/4 samples, margin 0.98, against 8/8 physical `b` under the declared stance. This condition and its prediction existed before the frozen batch was called.
- `held-out` `opposing_single_callsite` (a rule that counts only multiple *production* call sites and explicitly refuses to count a test consumer or a documented invariant): physical **b** in 8/8 samples, margin 0.59, against 16/16 physical `a` under the declared and name-every-step stances.

**How to read the second result.** It is an **exploratory follow-up, not an untouched preregistered confirmatory test.** The condition was chosen *after* observing that the held-out case's first `opposing` condition was degenerate — the name-every-step stance also selects physical `a`, so it cannot discriminate. The prediction for the new condition was written into the case definition and hashed into plan `71df96c4…` before those eight calls, so it could not be retro-fitted, but the condition itself was selected with knowledge of an earlier result. Treat it as a pre-registered *follow-up* whose design was informed by a prior observation.

The held-out case remains the informative one for rubric transfer, and the reason is narrower than "no rule decides it": the case has two candidate rules that select different variants, and the policy selects between them. Once selected, the supplied facts determine the answer.

### 5. Counterevidence: missing and conflicting policy are not handled reliably

This is where operational precision failed.

| Condition | `policy_readiness` | Preference produced | Fixture forces incompatible outcomes |
| --- | --- | --- | --- |
| `no_policy` (observer-batch) | `missing` 4/4 | `equivalent` 4/4 | n/a |
| `no_policy` (cache) | `missing` 4/4 | physical `b` 4/4, margin 0.38 | n/a |
| `no_policy` (held-out) | `missing` 4/4 | physical `a` 4/4, margin 0.36 | n/a |
| `conflict` (observer-batch) | `conflicting` 1/4, `defined` 3/4 | physical `a` 4/4, margin 0.64 | yes |
| `conflict` (cache) | `defined` 4/4 | 2 a / 2 b, margin 0.54, label `a` x4 | yes |
| `conflict` (held-out) | `defined` 4/4 | physical `a` 4/4, margin 0.87 | **no — excluded** |

**Conflicting policy is essentially undetected, over the fixtures that actually conflict.** The held-out `conflict` cell is a **fixture-design failure** and is excluded: rule one keeps a named boundary that "carries a contract of its own", and the author reading is that this boundary does (a separate test targets it), so both rules select physical `a`. That cell never required incompatible outcomes, so its 4/4 `a` cannot be counted as a missed contradiction. Over the **8** samples whose two rules genuinely require incompatible outcomes:

- the contradiction was reported as `conflicting` **once** (one observer-batch sample, which still returned a top choice);
- all 8 samples produced a top choice rather than `incomparable`;
- the observer-batch samples chose physical `a` regardless of labelling (margin 0.64), and the cache samples followed the label (`a` x4, margin 0.54) rather than resolving the contradiction.

The `conflict` fixture flag is recorded per case in the case definitions and surfaced per cell in the merged analysis as `conflictForcesIncompatibleOutcomes`, so this separation is mechanical rather than retrospective.

**Missing policy never produced a supported preference answer.** `policy_readiness` was `missing` in 12/12 samples, and the preference question returned **no** `insufficient_evidence` sample:

- 8 samples ranked a variant (`cache` physical `b` 4/4; held-out physical `a` 4/4);
- 4 samples (observer-batch) returned `equivalent`.

The observer-batch result is **not** correct abstention. It declines to rank `a` against `b`, which is better than a false ranking, but it asserts that the variants are materially equivalent — a positive claim the absent policy cannot support. The option's own `not_for` text excludes exactly this case: `equivalent` is for when the policy's test selects neither, not when the facts the policy needs are not supplied. So all 12 missing-policy samples produced a preference answer that the absent policy does not support, in two different ways.

**Caveat on this finding.** Every `no_policy` request was sent in the prose arm, and the prose serializer drops option-level `not_for` text. The `insufficient_evidence` option reached the model as "Applicable policy is absent, or the supplied source cannot establish the facts the policy needs." without the `not_for` line "Use when an applicable policy is present and the facts it needs are supplied." that the structured arm carries. So the missing-policy condition was measured with a **weaker option definition than the precise treatment's own standard**, and part of the failure to abstain may be attributable to the absent boundary text rather than to an inability to abstain. The finding is stated as observed: with the option definition that was actually sent, 12 of 12 samples produced an unsupported preference answer. Whether the `not_for` text would have changed that is untested.

**Readiness answers and preference answers disagree within the same request.** The held-out `prec_prose` cell answered physical `a` in 4/4 samples while reporting `evidence_readiness = missing_evidence` 4/4 — the facts it said it could not establish were the facts its preference relied on.

**Any downstream consumer must therefore enforce missing and conflicting policy in code, not in the question.** The previous experiment reached the same conclusion for missing policy from a single case; this experiment shows it holds under an operationalized rubric too, and that the conflicting case is at least as bad.

### 6. The held-out case: stability without decisiveness

On the held-out case, operational precision produced a stable physical answer (4/4 `a`) but only a modest margin (0.39 prose, 0.59 structured) — far below the 0.88-0.99 seen where the policy is a clean direction. This is the right shape for a contested decision, and it argues against treating a top choice as a verdict: the documentation's own guidance to explore multiple branches when probabilities are close applies here.

### 7. Obligation checking agrees with independent evidence about the declared obligations

A Noul question asked whether both variants preserve every **declared** obligation. Independent evidence bears on those declared runtime-context obligations only: the development cases' behavioral and runtime checks, and the held-out case's 5-input probe. It does **not** cover repository compatibility, and variant `b` of the held-out case fails the existing test module.

With that scope, the Noul returned "preserved" (≥0.5) in 113 of 116 samples. The three exceptions are all in the cache `conflict` cell (yes 1, no 3, mean 0.47), where the model reported a violated obligation that the runtime comparison contradicts. The cache case's Noul probabilities are systematically lower (0.47-0.76) than the other two cases (0.85-0.94) despite equally strong independent evidence about the declared obligations.

Separately, the held-out case shows a readiness/preference tension of its own: `prec_prose` and `prec_policy_only` returned physical answers while reporting `evidence_readiness = missing_evidence` 4/4 each, and the exploratory follow-up returned `missing_evidence` 8/8 while still choosing physical `b` 8/8. The model states it cannot establish the facts the policy needs and then answers anyway.

## What question shape works better

1. **Write the boundary, not just the JSON.** The substance finding stands and is the strongest result here: operationalizing the one term the policy leans on moved the development-case judgments from near tie or label-driven split to decisive and physically stable. The boundary definition — `what` the option covers, `not_for` what belongs elsewhere, contrasting examples, plus explicit `focus` and `precedence` — is what did that work. What is **not** established is that serialization is neutral, because the format arms were not content-matched.
2. **State `precedence` explicitly.** "Obligations are minimums, not compensating benefits; apply the boundary test before preferring" is cheap and was present in every decisive cell.
3. **Operationalize the one term the policy leans on.** The original consolidation wording failed on the undefined phrase "independently useful contract". Defining it with three concrete clauses and a `not_for` was the whole intervention.
4. **Keep the policy and the question as separate levers.** On the development cases the policy alone sufficed; on the contested held-out case the question's explicit scope was also required. Both are worth writing.
5. **Counterbalance and repeat.** In 5 of 24 cells the label choice was constant while the physical verdict followed the labelling. Without counterbalancing, label sensitivity reads as a reversal.
6. **Enforce absence and contradiction in code.** Neither is reliably detected by the model, at any precision of wording.
7. **Separate declared obligations from compatibility.** A variant can preserve every obligation the packet states and still fail to be an applicable refactor, and a Noul answer about obligations says nothing about that.
8. **Do not use a top choice as an approval.** Mean margins at or below 0.60 appeared in 14 of the 24 cells, including cells that matched the agent expectation.

## Receipts and reproduction

Batches were frozen and recorded before each call; no failed call was retried; the two batches that share wording carry the same `casesHash`, and the held-out case was never in a batch used to tune wording. The `heldout_opposing` batch is the exception described in section 4: its condition was chosen after inspecting an earlier result, though its prediction was frozen before its own calls.

| Batch | Requests | Valid | Run SHA-256 |
| --- | ---: | ---: | --- |
| `exploration` (development cases, pilot) | 16 | 16 | `4cf6995a8576b2d7e2c64f03a0a2ab685792f35b0efdaab6b15ab5007f7d73d9` |
| `frozen` (all cases, all conditions) | 92 | 92 | `ee73b3c9713554bc9b89cfd88b52747b58babb0784fdcdd09297a74c7635acb2` |
| `heldout_opposing` (exploratory follow-up) | 8 | 8 | `81e3380f96818e6f5ed1a407595d8548927950cf6275d8722f756df55b632574` |

Plan digests: `exploration` `1f48832f405308f90ed1f8f5bcce785e2e77a3357690c083b85229eb9a0a3e68`, `frozen` `55519f5795a32e02d43a1bf94bcb3e38c4ef21415bbb762e915d287687f8f0df`, `heldout_opposing` `71df96c44004e0076e921963089469661a8c3e234fc32d5607da6e5d3922ba96`. These are the recorded plan files and are unchanged by this revision; re-running `prepare` today yields a different `casesHash` because the annotation fields changed, so a recorded plan can be replayed but not re-evaluated against current code.

Input usage **934,616 tokens**, output **23,442 tokens**. Under the recorded $0.042/million input and free-output assumption, estimated cost **$0.039253872**, not verified account billing. Orb-observed fetch/body latency: **p50 135 ms, p95 212 ms, max 377 ms**, nearest-rank percentiles; serial, small-sample, excluding evidence preparation.

```sh
# Historical only — harness deleted after [jev-research-archive.md](jev-research-archive.md).
# Snapshot f09151f07e493ac9c76c84c32c38aed31df4669b. No live calls.
bun run typecheck:jev
bun test scripts/__tests__/jev-policy-clarity.test.ts
bun scripts/jev-policy-clarity.ts evidence .pulsar/jev-research/evidence/independent-evidence.json
bun scripts/jev-policy-clarity.ts prepare frozen .pulsar/jev-research/new-plan.json
bun scripts/jev-policy-clarity.ts inspect .pulsar/jev-research/new-plan.json
# TYPESAFE_API_KEY must be present for this next command only.
bun scripts/jev-policy-clarity.ts evaluate .pulsar/jev-research/new-plan.json .pulsar/jev-research/new-run --allow-egress
bun scripts/jev-policy-clarity.ts replay .pulsar/jev-research/new-run/run.json <trusted-sha256>
bun scripts/jev-policy-clarity.ts merge .pulsar/jev-research/merged.json .pulsar/jev-research/*-run/run.json
```

## What remains unproven

- **No human labels.** Expectations are agent-authored. Agreement with them measures rubric-following, not architectural correctness. All three cases are decidable once a policy selects a rule, so their agreement carries little information about judgment quality.
- **Small samples.** 4 observations per single-batch cell (8 where two batches pool, 8 for the exploratory follow-up). Margins and aggregate top-choice stability are visible; a calibrated threshold is not.
- **One held-out case, one rubric family**, whose first `opposing` condition is degenerate and whose conflict fixture does not conflict. The discriminating condition is an exploratory follow-up, not a confirmatory test.
- **No mechanism claim.** The constant-label pattern is observed label/position sensitivity. No latent-mechanism claim is made, and the earlier recorded reversals are not attributed to it.
- **The format control is incomplete.** Prose arms dropped option-level `not_for` text, and `policy_readiness` and `obligations_preserved` used different option texts by format rather than by substance, so `amb_struct` received precise definitions for those two questions. Format effects cannot be separated from substance for those measures, and the format comparison is limited to agreement of the observed preference outcome. The `no_policy` condition in particular was measured without the `insufficient_evidence` `not_for` text.
- **No held-out architectural outcome.** Nothing here shows that acting on these judgments improves a repository, and no composite score was built. Composite scoring remains an option to investigate, not a requirement.
- **Variant `b` of the held-out case is not an applicable refactor.** It preserves the declared obligations over the probed inputs and breaks the existing test module.
- **Version pinning unresolved.** Requests select `jev-latest`; all responses identified `jev-1.13.0`, but that is observed, not selected.
- **No conventional-provider baseline.** No separate provider credentials were available, so "better" means "more decisive, more stable, and more consistent with the stated policy", not "better than another provider".
- **Live error behavior unobserved.** All 116 requests succeeded; the auth/schema stop path is tested locally only.

The first receipt archive, `jev-policy-clarity-2026-09-17.tar.gz`, is retained unchanged. The revision archive `jev-policy-clarity-2026-09-17-rev2.tar.gz` carries this document, the revised annotations and evidence module, the regenerated evidence report, and the merged analysis, and it states which recorded artifacts are pre-revision.
