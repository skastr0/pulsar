# Jev located the change owners; the graded count question could not be scored

**Observed:** 2026-09-17. **Revised:** 2026-09-17 after a parent review; this revision corrects material reporting errors in the first version and adds no new inference. **Scope:** 13 research requests (2 development, 11 evaluation) over four real Pulsar maintenance requirements and one insufficient-context control, on the extraction A/B pair plus a third construction site outside it. No production code, signal semantics, score, weight, cache key, or adopted calibration changed. This is a separate workstream from the [question-shape experiment](jev-question-shape-results.md) and does not replace its unfavorable observations.

This worker acquired the unpushed baseline, ran every provider call, and wrote the harness and this report. The parent thread reviewed the result and identified the corrections below. The Oracle proposed the starting case (the duplicated successful-result construction versus an extracted constructor, and the case where existing delegation already suffices); it did not call Jev and did not interpret these results.

## What changed in this revision

| First version said | Actual | Effect |
| --- | --- | --- |
| One shared-obligation miss at `delegated-rule-b` "0.66" | `delegated-rule-b`'s Noul value is **0.17**; 0.66 is its Score mean | The claimed miss was a field mix-up. Shared-obligation agreement is 8/11 as pre-registered and 11/11 under the packet's own rubric wording |
| Three scalar contradictions, "level 2 in 3/3 asks" | The three distributions are `{1:.66,2:.06,3:.28}`, `{1:.63,2:.08,3:.29}`, `{1:.57,2:.08,3:.35}`: the **modal level is 1** every time | The contradictions were produced by the agent's decoder rounding the weighted mean. Removed |
| "10/10 patch choice" as evidence of preventing incorrect sharing | The packet sends only prose plan descriptions, and 11 of 12 of them name the discriminating property | Downgraded to agreement on plan descriptions |
| "Change kind is classified before ownership" | The questions are independent siblings in one request | Reworded as taxonomy context |
| Owner sets as ground truth | The compiler enumerates the shared-contract sites; the single-owner sets are agent-authored with probe support | Reported with an evidence tier per task |
| "The parent thread acquired the baseline and ran the calls" | This worker did both | Corrected |
| Archive "with per-request intents and receipts" | v1 contained receipts but no intents | v2 archive adds the 13 intent files; the v1 archive is preserved |

## The question this workstream asks

Does Jev help locate the right abstraction boundary and guide a real maintenance change, rather than merely recognize source shape? The measurable form here is: given one behaviour requirement and the exact symbols that could own it, does Jev name change owners that a compiler and a runtime probe confirm, and does it select the edit plan that satisfies the requirement without breaking a stated obligation?

## What was sent

Each POST to `https://api.typesafe.ai/v1/systemone` carried `{ model: "jev-latest", state, questions }`. State held one requirement, the source of the supplied symbols, the variant label, three candidate **plan descriptions**, and an explicitly research-scoped patch criterion. Requests were 27,845–29,503 serialized bytes with 13–14 questions. The API key was an authorization header and is not part of any recorded packet.

Every packet used the structure the vendor's [advanced primitives](https://docs.typesafe.ai/primitives/advanced) page describes:

| Form | Use here |
| --- | --- |
| Structured instructions | Each ownership Noul names `inspect`, `compare`, and `focus`; the patch question names the state paths to inspect |
| Choice with `what` / `not_for` / `examples` | The change-kind taxonomy, whose option values also carry the edit shape each kind usually implies |
| Taxonomy carrying subtree context | Change kind is one question whose options carry the edit shape they imply; it is context for the reader, not a stage that ownership refines |
| Structured Score levels | The graded question carries `summary` plus concrete `signals` per level |
| Structured Noul boundaries | Ownership and shared-obligation questions define both sides with `what`, `not_for`, and `examples` |

There is **no flat control in this batch**. The previous experiment covered formatting alone; this one asks whether these forms produce guidance that survives independent checking, so the packets are structured throughout and the result is reported as agreement with ground truth, not as confidence.

### The four requirements and the control

| Subject | Requirement | Variant A | Variant B |
| --- | --- | --- | --- |
| Shared contract | `SignalRunResult` must carry a required `contractVersion: number` with value 1; every site that constructs one must set it | Each successful-result exit builds the result inline | Both exits call one extracted `finalizeSignalResult` |
| Caller failure | The observer's compute-failure diagnostic must carry `data.failureKind: "compute_error"`; `runSignal` must keep propagating typed failures | as left | as left |
| Delegated rule | The engine-level severity ceiling must also downgrade a `block` from a `generated-slop` signal | two ceiling call sites | one ceiling call site inside the extracted constructor |
| Missing output | `runSignal`'s missing-output result must report `metadata.applicability: "not_applicable"` | as left | as left |
| Control (insufficient context) | A cached-result metadata merge must stamp cached confidence and staleness onto the result it returns | — | variant B, and the merge symbol is deliberately **not** supplied |

The control matters because the requirement's real owner, `mergeCachedResultMetadata`, lives in the same file as a supplied symbol but is not supplied. The manifest declares that the symbol list is not exhaustive without naming what is missing.

### Schedule, frozen before inference

The development batch was `shared-contract-a` and `caller-failure-a`. The evaluation batch was all eight task/variant packets plus the insufficient-context control, a counterbalanced `shared-contract-b`, and a byte-identical repeat of `shared-contract-b`. `delegated-rule`, `missing-output`, and the control never appeared during development. The development batch required no packet revision, so every evaluation request is byte-identical to its pre-registered form; the two development requests are themselves byte-identical to `shared-contract-a` and `caller-failure-a` and serve as extra repeats. The counterbalance rotates the taxonomy's option order and reverses the candidate list; it does **not** relabel candidates, so it tests position, not description.

## Independent ground truth, and what it does and does not establish

Twelve candidate patches were implemented as real source transformations and applied to disposable copies of `packages/core/src`. Each was checked with `tsc --strict --exactOptionalPropertyTypes` and with a runtime probe that exercises both entry points, the cache-restore path, a compute failure, an inactive signal, a signal whose compute returns `undefined`, and the engine-level rule directly. The full 24-row matrix is a test and an artifact.

The compiler enumerated the contract surface rather than the agent guessing it. Declaring a required field on `SignalRunResult` breaks **five** construction sites across three functions, not two:

| Variant | Sites that must set the field | Owners |
| --- | --- | --- |
| A | interface, `runSignal` success, `runSignal` missing output, observer success, observer failure, cache restore | 6 |
| B | interface, `finalizeSignalResult`, `runSignal` missing output, observer failure, cache restore | 5 |

The extracted constructor covers only the two successful-result exits. The missing-output branch, the observer's failure branch, and `fromCachedObserverOutput` in `scoring-engine-observer-cache.ts` construct the same contract independently, so extraction reduces the edit set from six owners to five and does not reach the third file at all. In variant B the ceiling rule has one call site instead of two; in variant A it has two.

**How strong each owner set is.** These are different kinds of evidence and should not be read as one tier:

| Task | Evidence for the owner set |
| --- | --- |
| Shared contract | **Compiler-enumerated at function granularity.** `tsc` reports `runner.ts`, `observer-execution.ts`, and `scoring-engine-observer-cache.ts` as the files whose construction sites must change; the split of one function's error into its success and non-success branches is the agent's reading of the compiler output plus the probe. The *existence* of five sites is not an agent claim |
| Caller failure | **Agent-declared, probe-supported.** The probe shows the observer observable appears only when that branch is edited, and that the alternative breaks `runSignal`'s typed failure channel. That no *other* supplied symbol must change is the agent's reading of the source, not a proof |
| Delegated rule | **Agent-declared, probe-supported.** The probe shows a direct engine-level call is downgraded only when the rule function changes, and that call-site-only edits leave the engine rule undowngraded. Uniqueness of the owner is not proven |
| Missing output | **Agent-declared, probe-supported.** The probe shows the requirement's observable appears only when the runner's branch is edited, and that the observer variant changes unrelated behaviour. Uniqueness is not proven |

`declaredEditedOwners` counts in the matrix are agent declarations; the matrix verifies the file set touched and the compile/runtime outcome, not uniqueness or minimality of the symbol set.

Verified outcomes of every candidate:

| Task | Correct candidate | Alternatives |
| --- | --- | --- |
| Shared contract | contract + every construction site: compiles, satisfies, 6 owners (A) / 5 (B) | contract only: **does not typecheck**; optional field at one entry point: compiles, four sites unset |
| Caller failure | observer failure branch only: compiles, satisfies, 1 owner | shared failure policy at both entry points: compiles and satisfies the observer observable but **stops `runSignal` propagating the typed failure**; no source change: requirement unmet |
| Delegated rule | engine rule only: compiles, satisfies, 1 owner | rule plus call-site re-checks: behaviourally correct, 3 owners (A) / 2 (B); call sites only: compiles but the **engine-level rule is not downgraded** when invoked directly |
| Missing output | runner missing-output branch only: compiles, satisfies, 1 owner | both entry points: compiles and satisfies the runner observable but **changes observer behaviour for an active signal whose compute returns `undefined`**; no source change: unmet |

Two of the four tasks have a candidate that satisfies the visible requirement while breaking a stated obligation, and one has a candidate that is behaviourally correct but not minimal. These are the cases where guidance could prevent incorrect sharing rather than merely describe a helper.

## Results

All values below are read from the untouched answer objects recorded in the receipts. Probabilities are provider outputs, not measured accuracy.

| Request | Change kind | Owner set | Patch description chosen | Shared obligation (Noul) | Count: mean / modal level / distribution | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| `shared-contract-a` | shared contract, 1.00 | **exact, 6/6** | correct, 0.95 | 0.91 → true | 2.29 / **2** / {0:.02, 1:.08, 2:.50, 3:.40} | sufficient 0.88 |
| `shared-contract-b` | shared contract, 1.00 | **exact, 5/5** | correct, 0.94 | 0.23 → false | 1.63 / **1** / {0:0, 1:.66, 2:.06, 3:.28} | sufficient 0.91 |
| `caller-failure-a` | caller specific, 0.77 | **exact, 1/1** | correct, 0.98 | 0.08 → false | 0.26 / **0** / {0:.81, 1:.15, 2:.01, 3:.03} | sufficient 0.57 |
| `caller-failure-b` | caller specific, 0.87 | **exact, 1/1** | correct, 0.99 | 0.07 → false | 0.17 / **0** / {0:.86, 1:.12, 2:0, 3:.02} | sufficient 0.68 |
| `delegated-rule-a` | delegated rule, 1.00 | **exact, 1/1** | correct, 1.00 | 0.17 → false | 0.25 / **0** / {0:.78, 1:.20, 2:.01, 3:.01} | sufficient 0.72 |
| `delegated-rule-b` | delegated rule, 1.00 | **exact, 1/1** | correct, 1.00 | 0.17 → false | 0.66 / **1** / {0:.44, 1:.51, 2:0, 3:.05} | sufficient 0.87 |
| `missing-output-a` | caller specific, 0.92 | **exact, 1/1** | correct, 1.00 | 0.10 → false | 0.22 / **0** / {0:.83, 1:.13, 2:.02, 3:.02} | sufficient 0.94 |
| `missing-output-b` | caller specific, 0.91 | **exact, 1/1** | correct, 0.99 | 0.11 → false | 0.86 / **1** / {0:.20, 1:.76, 2:.02, 3:.02} | sufficient 0.89 |
| `insufficient-context-b` | caller specific, 0.44 | spurious `from_cached_observer_output` 0.60 | — | 0.26 → false | 0.99 / **1** / {0:.16, 1:.75, 2:.02, 3:.07} | **missing evidence, 0.90 ✓** |
| `shared-contract-b-options-reversed` | shared contract, 1.00 | **exact, 5/5** | correct, 0.96 | 0.24 → false | 1.66 / **1** / {0:0, 1:.63, 2:.08, 3:.29} | sufficient 0.90 |
| `shared-contract-b-repeat` | shared contract, 1.00 | **exact, 5/5** | correct, 0.93 | 0.23 → false | 1.78 / **1** / {0:0, 1:.57, 2:.08, 3:.35} | sufficient 0.90 |

| Judgment | Agreement with agent labels (evidence tiers described above) |
| --- | --- |
| Change kind | 10 / 11 |
| Change-owner set (exact) | **10 / 11** |
| Candidate plan description chosen | 10 / 10 |
| Evidence readiness | **11 / 11** |
| Shared obligation, mode-thresholded, as pre-registered | 8 / 11 |
| Shared obligation, mode-thresholded, post-hoc under the packet's own boundary text | 11 / 11 (post-hoc; not a validated label) |
| Count, modal level | 8 / 11 |
| Count, rounded mean | 5 / 11 |

Every per-symbol ownership answer was decisive except where noted: on `shared-contract-a` the six owners scored 0.90–0.95 and the only non-owner 0.10; on `shared-contract-b` the five owners scored 0.81–0.95 while the two delegating exits scored 0.13 and 0.17. The patch description, change kind, and owner set were identical across the counterbalanced and byte-identical repeats. The count mean moved 1.63 → 1.66 → 1.78, a 0.15-level drift that never changed the modal level. The previous experiment's identical-input repeat reversed a preference ranking; nothing of that kind appears in these bounded judgments.

## Where Jev helped, and how it is verified

**It named construction sites the abstraction does not cover.** For the shared-contract requirement, the extracted constructor in variant B is the tempting answer. Jev named the interface, the constructor, the missing-output branch, the observer's failure branch, and `fromCachedObserverOutput` — the site in a different file that the extraction does not reach — and explicitly excluded the two delegating exits (0.13, 0.17). The compiler confirms those five owners and only those five, at function granularity.

**It kept a caller-specific change from being generalized.** For the caller-failure requirement, Jev named only the observer's failure branch (0.93 in both variants) and gave `runSignal`'s own success path 0.10 in both variants, while the wrong plan would apply the observer's policy at both entry points. What this does *not* show is that Jev detected the resulting break: the plan description for that candidate says outright that `runSignal` would "return a warn result instead of a typed failure", so the packet handed over the discriminating fact. The independent value is that the owner judgment is right and that the runtime probe establishes the consequence.

**It recognized that an existing delegation already owns the rule.** For the delegated rule, Jev named `enforce_severity_ceiling` (0.87, 0.88) and gave every other supplied symbol 0.08–0.22, in both variants, including variant B where the ceiling call is consolidated into the extracted constructor. The call-site-only candidate is behaviourally equivalent through the current two callers and still fails when the rule is invoked directly.

**It confined a change the observer cannot observe.** For the missing-output requirement, Jev named only the runner's missing-output branch (0.93, 0.91) and gave the observer's success path 0.10–0.11, even though variant B's observer success path is a one-line delegation to a constructor that returns a result. The observer pre-filters inactive signals into `inactiveSignals`, so the over-shared candidate is unreachable for the requirement's trigger and additionally changes behaviour for an active signal returning `undefined`.

## Where it did not help, and the counterevidence

**The graded count question could not be scored, and the agent's decoder hid that.** For `shared-contract-b` the distribution is `{0:0, 1:.66, 2:.06, 3:.28}`, so the modal level is 1 — the agent's own expected label — while the weighted mean is 1.63. The agent's first report rounded that mean to 2 and declared a contradiction with the same packet's binary ownership answers. That was the decoder's decision, not the model's answer. The counterbalanced and repeated asks behave identically (`{1:.63,…}`, `{1:.57,…}`). No scalar contradiction is established; the corrected decoder now reports the distribution, the modal level, and the rounded mean side by side, and a test pins the three recorded distributions so the rounding can never again masquerade as the answer. This is precisely the Score mean-versus-distribution caveat in the vendor's own documentation.

**The count question also has no unique correct label, independently of the decoder.** The question asks how many supplied symbols that construct a successful result must change, and excludes a symbol that only delegates to a changed constructor. But `from_cached_observer_output` also constructs a `SignalRunResult` and must change for the shared-contract requirement, while the level wording ("both supplied successful-result producers") presupposes exactly two producers. The agent labelled the entry-point-only reading as 2 for variant A and 1 for variant B; including the cache restorer changes those counts. The recorded distribution does not establish which interpretation the model used, and its mass on level 3 must not be relabelled as a count of 2. The remaining modal disagreements include `delegated-rule-b` (1 at 0.51 against 0 at 0.44) and `missing-output-b` (1 at 0.76); their causes are unestablished. This rubric does not support a unique correctness label. The expected labels remain unchanged in the recorded plans, and the full distributions remain available alongside the means.

**The patch-choice result is weaker than it first appeared.** The packet sends three prose plan descriptions and no diff, patch, or candidate source, so a choice is agreement on descriptions, not evidence that the model reviewed an implementation or detected a defect in one. Eleven of the twelve descriptions name the discriminating property outright — `r2_observer_failure_branch_only` says "leave `runSignal`'s error channel untouched", `r4_runner_missing_output_branch_only` says "leave the observer's inactive reporting alone", `r1_contract_interface_only` says "change no construction site", `r3_call_sites_only` says "without changing the engine-level rule owner". The 10/10 is therefore largely a reading-comprehension result on the agent's own prose. The independent contribution is the compiler-and-runtime matrix showing which plan actually holds, which the packet never supplied.

**The taxonomy did not abstain on the control.** For the insufficient-context packet the readiness question correctly answered `missing_evidence` at 0.90 — Jev recognized the requirement names a behaviour no supplied symbol produces. The change-kind question nevertheless picked `caller_specific_change` at 0.44 instead of `insufficient_evidence`, and the ownership Nouls produced one spurious owner (`from_cached_observer_output` at 0.60). The abstention is partial: one question abstains, two produce low-confidence concrete answers. A consumer that read only the change kind or the owner set would act on a wrong owner; a consumer that gates on readiness would not.

**The agent's pre-registered shared-obligation label contradicted the packet's own boundary.** The question asks whether the requirement is a shared obligation on both entry points or belongs to one caller or an already-shared owner, and its own false branch includes "no caller's own source changes because a shared owner already holds the rule". Under that boundary `shared-contract-b` is `false`, which is what Jev answered (0.23, 0.24, 0.23) while the agent had pre-registered `true` by reasoning about semantics rather than source edits. Agreement is 8/11 against the pre-registration and 11/11 under the packet's wording. The 11/11 is post-hoc: it is the reading the packet's own text selects, not a validated ground truth, and the honest conclusion is that the packet's boundary and its label disagreed — a packet defect. Note that the first version of this report additionally claimed a miss at `delegated-rule-b` by reading its Score mean as its Noul value; that claim is withdrawn.

**No held-out agent trial exists.** Every packet supplies the full source of the relevant symbols, and the correct answer is readable from that source by a careful reader. Nothing here measures whether an agent editing code with Jev's guidance produces a better or cheaper change than an agent editing without it. There is no blinded patch review: the agent authored both the descriptions and the labels, so no independent reviewer scored the plans without seeing the expected outcome. The task set is four requirements on one repository, all sharing the same two entry points, so it is small and internally related. Option rotation tested position, not candidate relabeling. There is no conventional-provider baseline, no calibrated decision threshold, and no production enforcement integration.

**The version is not pinned.** Requests selected `jev-latest`; every response identified `jev-1.13.0`. Immutable version pinning remains unresolved, as in the previous experiment.

## What is agent work and what is Jev output

| Agent work | Jev output |
| --- | --- |
| The four requirements, the control, and the obligations | Change-kind classification |
| The symbol inventory and every source excerpt | Per-symbol ownership judgments |
| The twelve candidate patches, their implementations, and the 24-row compiler/runtime matrix | The shared-obligation judgment |
| The candidate plan descriptions and the criterion | The graded successful-producer count distribution |
| The expected labels, the schedule, and the counterbalance | The candidate plan description chosen |
| The taxonomy, rubrics, examples, decoder, and leakage guard | Evidence and policy readiness |

The patch criterion supplied in the packet is labelled in the packet itself as a proposed experiment criterion, not adopted Pulsar policy. It is not derived from any personal or repository taste, it is not a signal, and it was not integrated into scoring. The examples in the change-kind rubrics deliberately describe maintenance situations outside this repository so that no evaluation case's expected verdict appears in the rubric that judges it; a guard test asserts this and the requirement-term check.

## Documentation implications

- Bounded per-symbol ownership questions were the reliable instrument here: 10/11 exact against a compiler-verified owner set, stable across a counterbalanced packet and a byte-identical repeat. Prefer a binary owner set for edit guidance.
- A Score answer is a distribution plus a position on the scale. Report the modal level, the distribution, and the mean separately, and never let a decoder's rounding stand in for the model's answer. The first version of this report failed exactly there, and a test now pins the recorded distributions.
- A graded question whose scope is not closed over the supplied symbols has no unique label. If the count matters, enumerate the symbols in the question and exclude what is out of scope, or make it a set of Nouls.
- Do not send prose plan descriptions and then call the choice evidence of defect detection. Either send the candidate implementations or report the result as agreement on descriptions.
- An abstention control is worth its own packet, and readiness must gate consumption of the other questions: the readiness question caught the missing symbol while the change-kind and ownership questions did not.
- A boundary definition and its expected label can disagree. Write the boundary first, then the label, and check them against each other; here the agent's own pre-registration was the one that was wrong, and the label was preserved rather than rewritten after seeing the answers.
- Extraction reduces an edit set only as far as the sites it actually covers. On this requirement the extracted constructor covered two of five construction sites, so the honest statement is "six owners became five", not "the contract now has one owner".
- No composite, no adoption. These are four requirements on one repository; there is no established common utility across them, and a repository-owned number that yields better architecture remains unproven.

## Receipts and reproduction

**13/13 POSTs returned HTTP 200, and all 13 validate on replay** under both the original and the corrected decoder. Every response identified `jev-1.13.0`. Input usage: 80,017 tokens (evaluation) plus 14,225 (development); output: 4,663 plus 832. At the recorded $0.042/million input-token and free-output assumption, cost is **$0.00336** plus **$0.00060**, not verified account billing. Orb-observed fetch/body latency: evaluation **p50 129 ms, p95/max 234 ms**; development **p50 136 ms, p95/max 291 ms**; nearest-rank percentiles over 11 and 2 samples. This serial measurement excludes evidence preparation and local checks and is not a service-level benchmark. There were no transport errors and no retries.

```text
baseline (parent's unpushed main)        b124766ea68e95f50466539997a23f4f03983f97
bundle SHA256                            62767bc58ce511c502730666ff89699d434fc2ced0f8e2f84eb0aafbca061edd
research harness commit                  8da3c0e
CLI fix commit                           e796d91
first results commit                     42b07fe
evaluation run SHA256                    4e5e3c3181f3132f8268ca3fea0ba883ad58aeb42c347163b4bf3c98d84ce42a
evaluation plan canonical SHA256         b13a983a0949f92aa5978e7a6eb9becd32d95f0cbf3eeda86214db3939982951
development run SHA256                   54333e5981da8e9253bc5d98cb4ed0c0bc354a760074597e140f49180f7f5eb5
development plan canonical SHA256        f2e9b3c82784d476a40d80013f3984e05d1b2602042c429d3ad7f8768734c74c
patch matrix SHA256                      cd62f623e719c5a861d44314ea9501c078082aeaca490d60c1ccecd287113eb3
original archive SHA256                  08d6e36726c179fd200513057e805f1a84628bd56f6a5c87627247088de2836a
corrected archive SHA256                 6a25a2ab0e0a3c41ebd949f9c77ea8a9d7bac4eef1928c112fc76ec0c692c97a
```

The **original** archive `maint-utility-receipts.tar.gz` (205,266 bytes) is preserved unchanged. The **corrected** archive `maint-utility-receipts-v2.tar.gz` (213,075 bytes, built at commit `d8b6a4a`) contains the same plans, expected labels, run ledgers, summaries, patch matrix, and per-candidate diffs, and adds the 13 per-request `*.intent.json` files that the original omitted, `analysis.json` (a corrected replay of both recorded runs, each result carrying the untouched answer objects), and a `README.md` recording the original archive's hash. It contains no authorization header; the transport records only status, body, request id, and elapsed time, and a scan for the key material and for `Authorization`/`Bearer` found nothing in either archive.

The recorded plans carry the repository SHA they were prepared against, so `evaluate` refuses to re-infer them on a later commit by design; `replay` is unaffected because it verifies the recorded bytes and digests instead of rebuilding the inputs.

```sh
# Historical only — scripts/jev-maint.ts retired. Snapshot f09151f07e493ac9c76c84c32c38aed31df4669b.
# Distilled: [jev-research-archive.md](jev-research-archive.md). No live calls.
# independent re-verification of the ground truth (24 compiler/runtime rows)
bun scripts/jev-maint.ts verify .pulsar/jev-research/maint-utility/patch-matrix.json
bun run test:jev-maint
# replay the recorded evaluation without re-inferring
bun scripts/jev-maint.ts replay .pulsar/jev-research/maint-utility/eval-run/run.json \
  4e5e3c3181f3132f8268ca3fea0ba883ad58aeb42c347163b4bf3c98d84ce42a
# rebuild the corrected archive from the recorded runs
bun scripts/jev-maint/receipt.ts v2
```

**Historical validation (not a live suite):** `bun run typecheck:jev-maint` passed; `bun run test:jev-maint` returned **12 pass, 0 fail**, including the full 24-row patch matrix, the leakage guards, plan tamper rejection, the byte-identical repeat check, the answer-field slot guard, the three recorded Score distributions, the no-implementation guard, the no-cascade guard, and the ledger inventory. `bun run test:jev` returned **47 pass, 0 fail** (35 prior + 12 new) through its existing `jev-*.test.ts` glob. Those paths are deleted.
