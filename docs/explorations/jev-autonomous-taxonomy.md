# Autonomous taxonomy and penalty aggregation for the Jev-backed health command

**Historical research recommendation.** The parent POC implementation and `.pulsar/modules/semantic-policy.ts` were retired; see [jev-poc-archive.md](jev-poc-archive.md). Exact sources remain at snapshot [`f09151f07e493ac9c76c84c32c38aed31df4669b`](https://github.com/skastr0/pulsar/commit/f09151f07e493ac9c76c84c32c38aed31df4669b). Nothing in this document is a live API.

**Observed:** 2026-09-17. **Scope:** research recommendation. No provider call was made for this document and no production signal, score, weight, cache key, calibration slot, or default changed. It extends [policy-clarity](jev-policy-clarity-results.md), [staged-judgment](jev-staged-judgment-results.md), [maintenance-utility](jev-maintenance-utility-results.md) and [question-shape](jev-question-shape-results.md).

## 0. Status of everything below

**Proposed, not implemented.** Every interface, field name, option set, weight, and formula in this document is a recommendation. The parent implementation used a **fixed repo-local `semantic-policy.ts` research module** (now retired), not the manifest or SDK slot mechanism, and its snapshot shape is authoritative where it differs from what follows. Concretely:

- The `SemanticPolicy` / `SemanticRule` / `semanticPolicy()` / `selectRules()` surface in §5 is **proposed**. It is not a shipped contract, and no test pins it.
- Declaring that module through `.pulsar/project-modules.json` (`kind: "repo-local"`, the existing manifest at `.pulsar/project-modules.json`) and the project-module SDK (`defineProcessor`, `packages/project-module-sdk/src/index.ts:15`) was a **later step**, not part of this POC. The SDK mechanism exists and is already used by `.pulsar/modules/pulsar-self.ts`; it was never how the semantic policy was wired.
- The three-stage flow, the fixed penalty points, and the separate hard-gate treatment below match the implementation direction as described to me; the field names and the two illustrative policies are mine.
- Weights, thresholds, and the two policies in §6 are **illustrative**, not calibrated.

**Reused as-is, not proposed.** The shared Jev transport (`scripts/jev-spike/transport.ts`: `ENDPOINT`, `JudgmentProvider`, `jevLayer`, 30 s timeout, zero retries), the response validator (`scripts/jev-spike/model.ts`), and the plan/intent/receipt/replay discipline of `scripts/jev-policy-clarity.ts` and `scripts/jev-staged-judgment.ts`.

## 1. Candidates (deterministic, not asked)

Candidate inventory: **all detected clone groups** plus **all functions collected by the complexity signal** (`TS-LD-01-cyclomatic-complexity`, `ts-ld-01-complexity.ts:42`), filtered by repo-declared include/exclude scope. The implemented POC applied a ranked/interleaved budget to that full inventory and explicitly marked the remaining sample incomplete. See [the historical implemented contract](jev-autonomous-poc.md) and [archive](jev-poc-archive.md); the broader alternatives below remain proposals. Production candidate collection for ownership discovery still lives in `packages/cli/src/semantic-discovery.ts`.

| Kind | Detector | Fields | Existing slot |
| --- | --- | --- | --- |
| `clone_group` | `TS-SL-01` (`ts-sl-01-model.ts`) | `groupId`, `kind: exact\|structural`, `tokenCount`, `members[{file,name,startLine,endLine}]`, `scopeMode` | `typescript.clone-group-policy` |
| `clone_drift` | `TS-SL-02` (`ts-sl-02-inconsistent-clones.ts:38-62`) | `divergenceScore`, `confidence`, `evidenceKind`, `contentVariantCount`, `maxTokenDelta`, per-member `lastModifiedSha`/`lastModifiedAt` | same |
| `size_outlier` / `function` | `TS-LD-02` (`ts-ld-02-model.ts`) | `FunctionSize{file,name,line,loc}`, `outlierFunctions`, `oversizedFunctions`, `ratioPressure` | `typescript.size-policy` |

### 1.1 What the existing classifiers decide, and what they do not

This distinction matters, because a question that duplicates a deterministic classifier wastes a call and credits the model for arithmetic.

| Existing classifier | Input it actually reads | Decides | Does **not** decide |
| --- | --- | --- | --- |
| `classifyCloneEvidence` (`ts-sl-02-evidence.ts:28`) | Member **names, basenames and parent directories** — not bodies | `parallel-family` / `paired-variant` / `clone-drift` as a shape label | Whether members compute the same rule; identical names in different directories are labelled `parallel-family` regardless of the bodies |
| `divergentClonePenalty` + `divergenceScore` (`ts-sl-02-evidence.ts:15`, `ACTIONABLE_DIVERGENCE_THRESHOLD = 0.75` at `:4`) | Syntactic content difference plus git timestamps | How much text differs and whether it crosses a fixed threshold | Whether the difference is a defect, or which member is authoritative |
| `cloneGroupImpact` (`ts-sl-01-policy.ts`) | Member count, token count, scope mode, policy factor | Organizational pressure | Whether members must change together |
| `TS-LD-01` complexity, `TS-LD-02` LOC | Syntax counts | Size and complexity magnitudes | Whether the size serves one purpose or several |

These statements are bounded to the implementations I read at commit `b4b081c40b9ebe1a291e2ac00a7711648c930471`. They are not claims that no classifier anywhere could decide these questions.

**One distinction is already decided in this repository.** `A1` (code role) has a repo-owned deterministic classifier in the `taxonomy.file-classifier` slot (`architectureRoleClassificationForFile`, used at `.pulsar/modules/pulsar-self.ts:110`), with the vocabulary `pure_utility | shared_contextual | integration` declared at `.pulsar/modules/pulsar-self.ts:25`. Inside Pulsar the command should **consume that classification** rather than ask a model. A repository without such a classifier would ask `A1` as a semantic question. This is the clearest illustration of the layering: the same distinction is deterministic in one repository and semantic in another.

## 2. Stage 1 — generic facts (no policy)

One request per candidate; the distinctions are independent sibling `Choice` questions plus `evidence_readiness`. Examples describe situations outside this repository so no judged case's expected verdict appears in the rubric that judges it.

| Id | Distinction | Kind of question | Decided by an existing classifier here? |
| --- | --- | --- | --- |
| A1 | code role | semantic | **yes** — `taxonomy.file-classifier`; consume it |
| A2 | member coupling | semantic (requires bodies) | no |
| A3 | rule identity | semantic (requires bodies) | no; `evidenceKind` is name/path-shaped |
| A4 | drift intent | semantic, needs history or comments | no; `divergenceScore` measures text difference |
| A5 | purpose cohesion | semantic | no; LOC and complexity are counts |

**A2 member coupling** (clone groups)

| Option | `what` | `not_for` |
| --- | --- | --- |
| `coupled_all_members` | Every member must change together for the shared behaviour to stay correct. | Members that look alike but change for their own reasons. |
| `coupled_subset` | Some members are bound together; others in the same group are independent copies. | Uniform coupling or uniform independence. |
| `independent_by_design` | Members must be free to diverge; shared shape is not a maintenance obligation. | Members that must stay in sync. |
| `insufficient_evidence` | Bodies or call sites cannot establish whether members move together. | Coupling the source does establish. |

**A3 rule identity** (clone groups; asked because A2 alone would penalize coincidental shape)

| Option | `what` | `not_for` |
| --- | --- | --- |
| `same_rule` | Members compute the same decision on the same kind of input. | Members computing different decisions from similar code. |
| `related_distinct_rules` | One family, genuinely different rules or constants. | Identical rules, or unrelated rules. |
| `coincidental_shape` | Resemblance comes from the language or boilerplate, not a shared decision. | A shared decision expressed differently. |
| `insufficient_evidence` | The bodies do not establish what each member decides. | A shared rule the bodies do establish. |

**A4 drift intent** (only when `TS-SL-02` reports divergence)

| Option | `what` | `not_for` |
| --- | --- | --- |
| `stale_member` | A member was meant to track the others and no longer does. | Differences introduced on purpose. |
| `intended_specialization` | A deliberate per-member variation. | A member that fell behind. |
| `indeterminate` | The evidence does not establish intent. | Intent the supplied history or comments do establish. |

**A5 purpose cohesion** (function and size candidates)

| Option | `what` | `not_for` |
| --- | --- | --- |
| `one_purpose_size_forced` | One coherent purpose whose length an external contract or exhaustive enumeration dictates. | A unit that accumulated unrelated responsibilities. |
| `one_purpose_growth_available` | One coherent purpose expressible in less code without behaviour change. | Size forced from outside, or several purposes. |
| `multiple_unrelated_purposes` | Several independent jobs that could be separated. | One job that is merely long. |
| `insufficient_evidence` | The source is too partial to judge cohesion. | Cohesion the source does establish. |

Stage 1 carries no policy and asks for no preference. It returns labelled facts with a probability distribution and a margin per question.

## 3. Stage 2 — refinement

Stage 1 facts are frequently ambiguous in a way that matters to the policy: `A2 = coupled_subset` does not say which members are bound, and `A3 = related_distinct_rules` does not say which rule each member holds. Stage 2 asks a **child question whose options are derived from the Stage-1 distribution**, so the options do not exist until Stage 1 returns. This is the vendor's taxonomy walk (`cookbooks/hierarchical_classification`): retain the top-K Stage-1 options by length-normalized geometric mean, ask one child question per retained branch, and keep the branches rather than collapsing to a top label. The staged workstream measured 7/7 recall of the mechanically established path under two independent rulers, and found retention is what keeps near-ties visible.

Stage 2 is skipped when Stage 1 is unambiguous (top option above the clear threshold and no competing option above the retention floor) or when no rule's `requires` facts depend on the refinement. Composition is deterministic and re-derivable, so replay fails rather than silently judging different code — the pattern `scripts/jev-staged-judgment.ts` already implements.

## 4. Stage 3 — policy-backed debt and direction, per selected rule

The repository owns an executable TS semantic policy module. **Proposed surface** (see §0 — the implementation's shape is authoritative):

```ts
// Proposed. Repo-local research module; not yet a manifest/SDK slot.
export interface SemanticPolicy {
  readonly id: string
  readonly scope: "repo" | "org"                   // never personal
  readonly pointScale: number                      // points that equal a full 1.0 penalty
  readonly marginFloor: number                     // top-minus-second floor for a clear answer
  readonly greenThreshold: number                  // see §7
  readonly rules: ReadonlyArray<SemanticRule>
}

export interface SemanticRule {
  readonly id: string                              // stable, unique; part of the dedup key
  appliesTo(candidate: Candidate, facts: Facts): boolean
  /** Rendered from this rule's declared stance; the option template is fixed. */
  debtQuestion(candidate: Candidate, facts: Facts): ChoiceSpec
  /** Fixed penalty points per option. Every declared option must have a value. */
  readonly points: Readonly<Record<DebtOption, number>>
  readonly maxPoints: number                       // max of points, declared
  readonly requires: ReadonlyArray<FactKey>
}

export function semanticPolicy(): SemanticPolicy      // proposed
export function selectRules(candidate: Candidate): ReadonlyArray<SemanticRule>  // proposed
```

The **template is fixed**; only the rule's declared stance varies. Every rule renders the same four options:

| Option | Meaning |
| --- | --- |
| `debt_consolidate` | The current separation is debt; one shared owner is the direction of the fix. |
| `debt_separate` | The current coupling is debt; the members should diverge further. |
| `no_debt` | The current arrangement is the repository's intended one. |
| `insufficient_evidence` | The supplied facts or source do not support a debt judgment. |

`debtQuestion` supplies `what` / `not_for` / contrasting `examples` per option from the rule's own declaration, so the boundary text is repo-owned and operational — which is what moved judgments in the policy-clarity development cases. Because that experiment's format arms were not content-matched, treat this as observed outcome agreement rather than a controlled format result.

**No personal fallback.** With no repo-local policy module the command emits no score and exits with a distinct status: a policy-free run has nothing to penalize, and a zero-penalty result would read as a pass. The policy-clarity experiment found that a model asked to judge without an applicable policy still produced a preference answer in 12 of 12 samples, so this cannot be delegated.

**Stage 3 is justified by auditability, not measured accuracy.** The staged workstream found the staged arm's policy stage was **not** more accurate than a single direct question, only structurally safer. Cost is roughly one request per stage per candidate; the three-stage staged batch measured 3.28× input tokens over a single direct question.

## 5. Two opposite policies on one template

Both declare the same rule ids and render the same option template; only `appliesTo`, the option boundaries, and `points` differ. Neither names a file, a variant, or an outcome. Illustrative values only.

**P1 — "shared rules are debt."** Rule `clone-shared-rule`: `appliesTo` = clone group with `A3 = same_rule`. `points = { debt_consolidate: 9, debt_separate: 0, no_debt: 0, insufficient_evidence: 0 }`, `maxPoints: 9`. Rule `outlier-multi-purpose`: `appliesTo` = function candidate with `A5 = multiple_unrelated_purposes`. `points = { debt_consolidate: 8, debt_separate: 0, no_debt: 0, insufficient_evidence: 0 }`. `pointScale: 100`, `marginFloor: 0.25`, `greenThreshold: 0.85`.

**P2 — "parallel implementations are a feature."** Rule `clone-shared-rule` keeps the same id and template; `appliesTo` narrows to clone groups whose `A1` is `integration` **and** whose `A4` is `stale_member`. `points = { debt_consolidate: 1, debt_separate: 0, no_debt: 0, insufficient_evidence: 0 }`, `maxPoints: 1`. Rule `outlier-multi-purpose` narrows to domain-role functions. `points = { debt_consolidate: 3, debt_separate: 0, no_debt: 0, insufficient_evidence: 0 }`. `pointScale: 100`, `marginFloor: 0.35`, `greenThreshold: 0.95`.

Under P1 a shared rule is penalized on sight; under P2 the same candidate is penalized only after it has drifted, and less. A third repository writes a third module; nothing in Stages 1–3 changes.

## 6. Aggregation — fixed additive penalty points with an interval

Fixed penalty points per `(rule, answer)`, converted to a score fraction by a repo-owned `pointScale`. No weights, no per-detector scaling, no denominator.

```
K = Σ over keys with a clear answer of max duplicate points(key)
U = Σ over (rule, candidate) pairs with no clear answer of rule.maxPoints
penaltyLo = min(1, K / pointScale)          penaltyHi = min(1, (K + U) / pointScale)
scoreLo   = 1 - penaltyHi                   scoreHi   = 1 - penaltyLo
```

`key = (rule.id, memberKey(candidate))`, where `memberKey` is the sorted `file:name` list. **Not `groupId`**: `TS-SL-01` and `TS-SL-02` observe the same member set under different group ids, so a rule must not be counted twice for one fact. `max` over duplicates makes that identity hold.

**The score starts at 1 by construction.** `1 - min(1, ·)` subtracts from a full score. There is no per-file or per-candidate average. Adding assessed zero-debt candidates cannot dilute known penalties. Clean files can still introduce functions into the inventory: if those remain unread, `U` grows rather than assuming they are benign.

**Scope is part of the measurement.** Candidates excluded by the run's include/exclude scope are `out_of_scope`, which is recorded separately from `unread` and does not widen the interval. Excluding candidates therefore legitimately narrows the measurement, so the report must name the scope and the counts, and a green result must not be able to hide an exclusion.

| Invariant | Statement | Test |
| --- | --- | --- |
| I1 clean-file invariance | Files producing no candidate leave the interval unchanged. | Add N synthetic clean modules; assert identical interval. |
| I2 duplicate-fact invariance | One member set reported under two group ids yields one key. | Feed both detectors; assert one `points` entry. |
| I3 monotonicity | Adding a penalized fact never raises `scoreHi`. | Property test: `scoreHi(S ∪ {u}) ≤ scoreHi(S)`. |
| I4 bounded and ordered | `0 ≤ scoreLo ≤ scoreHi ≤ 1`. | Assert on the property test. |
| I5 no silent baseline | No unread candidate can be presented as benign. `U > 0` forbids green. | Strip every candidate's evidence; assert not green and a non-degenerate interval. |
| I6 no policy, no number | Without a repo-local policy module the command emits no score. | Remove the module; assert a distinct refusal status. |
| I7 scope visibility | `out_of_scope` and `unread` are reported separately. | Exclude a directory; assert the exclusion appears and `U` does not change. |

## 7. The green rule, corrected

`U == 0 ∧ gate == pass` is **not sufficient** for green: a run can read every candidate clearly and still accumulate a large known penalty, in which case the interval collapses to a point at a low score. Green must additionally clear the repository's own bar.

```
gate  = deterministic hard-gate verdict            // separate; never folded into the number
green ⇔ gate == pass ∧ U == 0 ∧ scoreLo ≥ greenThreshold
```

- `greenThreshold` is repo-owned. With no clear answers, `U > 0` and green is impossible; with all answers clear, `scoreLo == scoreHi` and green is a point claim above the declared bar.
- **Green is a threshold claim, not a certainty claim.** It states that among the candidates in scope that the command could read, no policy rule reported debt above the repository's own bar, and no hard gate failed.
- **Hard gates stay separate and non-compensating.** They are reported as their own field, never averaged into the number, and a failure makes green unreachable regardless of the penalty score. If a repository also wants the number itself capped on a gate failure, that is a proposed `gateScoreCap` field, not part of this POC.

## 8. Consumption rules

An answer is *clear* only when the top option's probability and its margin both meet `marginFloor`; otherwise the rule is unknown and enters `U`. `insufficient_evidence` is always unknown. A Stage-1 readiness answer below `sufficient` makes every rule for that candidate unknown without asking later stages — the maintenance workstream found the readiness question caught a missing symbol at 0.90 while the taxonomy and ownership questions did not abstain, so readiness must gate consumption. A missing or conflicting applicable rule set is a validation error, not a judgment: the policy-clarity experiment found the model reported a conflicting policy in 1 of 12 samples.

**Worked example under P1.** One clone group answering `debt_consolidate` (`9` points) plus one unread clone group gives `K = 9`, `U = 9`; dividing by `pointScale = 100` yields interval `[0.82, 0.91]`. Not green: `U > 0` and `scoreLo = 0.82 < greenThreshold = 0.85`. An assessed clean group changes nothing. Ten read groups each answering `debt_consolidate` give `U = 0`, `K = 90`, interval `[0.10, 0.10]` — all answers clear, and still **not green**.

I1–I5 were checked mechanically against this formula before writing it down: 2000 randomised candidate sets for monotonicity and boundedness, plus targeted cases for clean padding, cross-detector duplication, fully stripped evidence (non-degenerate interval, never green), and the large-known-debt case above (not green). I6 and I7 are control-flow rules and are untested.

## 9. Falsifiable failures

1. **Clean-file padding.** Add 200 clean modules. If the interval moves, I1 fails.
2. **Cross-detector double count.** Same member set via `TS-SL-01` and `TS-SL-02` with different group ids. If the points grow by two, I2 fails.
3. **Truncation laundering.** Strip every body so `A3` cannot be read. If the result is green, I5 fails — losing evidence bought a pass.
4. **Large-debt green.** Ten clearly read `debt_consolidate` groups under P1. If the result is green, the corrected green rule in §7 is not implemented.
5. **Gate substitution.** Replace the deterministic gate verdict with the model's own answer. The disqualified candidate can then win: the direct preference question gave it its top label (`b` 0.36, `neither_meets_minimum` 0.34) in the staged batch. If removing the gate changes nothing, the gate is not load-bearing.
6. **Policy fallback.** Delete the repo module and see whether a home-directory policy is consulted. If a score appears, I6 fails.
7. **Scope laundering.** Exclude the directories holding the worst candidates and report the result as green. If the exclusion is not visible in the output, I7 fails.
8. **Pointer drift.** If the reported pointer set differs from `members[].file/startLine/endLine` plus compiler output, provenance is broken. Pointers come from detector output, and from compiler output only where a compiler check ran; the maintenance workstream's five construction sites across three functions were compiler-enumerated, while the split of one function's error into success and non-success branches was an agent reading supported by a runtime probe.

## 10. Receipts

Read at `b4b081c40b9ebe1a291e2ac00a7711648c930471`: `ts-sl-01-model.ts` (`CloneGroup`, `scopeMode`, `DEFAULT_SCORE_BUDGET_MIN_TOKENS = 12` at line 42); `ts-sl-01-policy.ts` (`cloneGroupImpact`); `ts-sl-02-inconsistent-clones.ts:38-62` (`CloneMember`, `DivergentClone`); `ts-sl-02-evidence.ts:4,15,28` (`ACTIONABLE_DIVERGENCE_THRESHOLD`, `divergentClonePenalty`, `classifyCloneEvidence`); `ts-ld-01-complexity.ts:42` (`TS-LD-01-cyclomatic-complexity`); `ts-ld-02-model.ts` (`FunctionSize`, `outlierFunctions`); `calibration-slot-values.ts:51,70,333,334`; `.pulsar/modules/pulsar-self.ts:25,110` (`PulsarArchitectureRole`, `architectureRoleClassificationForFile` use); `.pulsar/project-modules.json`; `packages/project-module-sdk/src/index.ts:15` (`defineProcessor`); `packages/cli/src/agent-cli.ts`; `scripts/jev-spike/transport.ts:4,16,20`; `packages/core/src/enforcement.ts`.

Docs: `primitives/advanced` (structured instructions, `what`/`not_for`/`examples`, taxonomy options carrying subtrees), `patterns/composite-scoring` (independent dimensions, normalize each, weight in code), `cookbooks/hierarchical_classification` (Choice per node, retain K paths by length-normalized geometric mean, `top/second` separation, frozen snapshot because a live walk makes the taxonomy depend on the reader's checkout).

## 11. Not established

- **No live call was made.** Every claim about model behaviour cites a recorded batch in the four reports above.
- **The five distinctions are authored, not validated.** Each is justified by targeting something the classifiers I read at this commit do not decide — not by evidence that a model decides it well.
- **Stage 3 is not more accurate**, only structurally safer, per the staged workstream.
- **The proposed API is not a contract.** No implementation, test, or review has pinned `SemanticPolicy`, `SemanticRule`, `semanticPolicy()`, or `selectRules()`.
- **Weights, thresholds, and policies are illustrative**, not calibrated; no held-out evaluation supports any particular value.
- **Coverage is the binding limit.** Two candidate kinds over a declared scope cannot speak for a repository; green means only that the rules that ran found no debt above the repository's own bar among the candidates they could read.
