# Jev autonomous POC archive

Research machinery for the autonomous semantic-health command is retired. Exact sources remain at snapshot [`f09151f07e493ac9c76c84c32c38aed31df4669b`](https://github.com/skastr0/pulsar/commit/f09151f07e493ac9c76c84c32c38aed31df4669b) (local `main` at cleanup, not necessarily `origin/main`). This note keeps findings, request shapes, and test intent. It is not a product contract and does not re-run inference.

**Not currently runnable.** Retired commands, scripts, the research policy module, and research tests are gone from the tree. Do not treat the historical command blocks below, or those in the older reports, as live entry points. No new provider calls were made for this archive. Ignored raw receipts under `.pulsar/semantic-runs/`, `.pulsar/context-experiments/`, and `.pulsar/jev-research/` were left intact and are not republished here.

Production discovery (`packages/cli/src/semantic-discovery.ts`) was promoted from the POC and remains. Its 35 tests now live at `packages/cli/src/__tests__/semantic-discovery.test.ts`. Ownership discovery tests were not moved.

Companion reports (historical, not currently runnable):

- [Autonomous POC results](jev-autonomous-poc.md)
- [Taxonomy / penalty proposal](jev-autonomous-taxonomy.md)
- [Quartz context experiment](jev-quartz-context-results.md)

## Exact sources at the snapshot

Blob links are `https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/<path>`. Local equivalent: `git show f09151f07e493ac9c76c84c32c38aed31df4669b:<path>`.

| Role | Path |
| --- | --- |
| CLI / plan / run / replay | [`scripts/jev-poc.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc.ts) |
| Smoke fixtures | [`scripts/jev-poc-smoke.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc-smoke.ts) |
| State machine, aggregate, replay | [`scripts/jev-poc/pipeline.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/pipeline.ts) |
| Policy schema and trusted load | [`scripts/jev-poc/policy.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/policy.ts) |
| Question factories (`autonomous-semantic-v2`) | [`scripts/jev-poc/questions.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/questions.ts) |
| Mutation fixtures | [`scripts/jev-poc/challenges.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/challenges.ts) |
| Quartz neighborhood collector | [`scripts/jev-poc/quartz-context.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/quartz-context.ts) |
| Quartz experiment CLI | [`scripts/jev-quartz-context.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-quartz-context.ts) |
| Repo research policy | [`.pulsar/modules/semantic-policy.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/.pulsar/modules/semantic-policy.ts) |
| Pipeline tests | [`scripts/__tests__/jev-poc-pipeline.test.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/__tests__/jev-poc-pipeline.test.ts) |
| Challenge tests | [`scripts/__tests__/jev-poc-challenges.test.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/__tests__/jev-poc-challenges.test.ts) |
| Quartz tests | [`scripts/__tests__/jev-quartz-context.test.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/__tests__/jev-quartz-context.test.ts) |
| Discovery tests (moved, not deleted from history) | [`scripts/__tests__/jev-poc-discovery.test.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/__tests__/jev-poc-discovery.test.ts) |
| Promoted production discovery | [`packages/cli/src/semantic-discovery.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/packages/cli/src/semantic-discovery.ts) |

Shared spike transport (`scripts/jev-spike/`) was also retired; its request contract and test specifications are preserved in the [research archive](jev-research-archive.md).

## What the command claimed

Pulsar selected candidates from full clone-group and complexity-function signal **output**, never diagnostic top-N. A repo-local research policy supplied include/exclude, rules, fixed penalties, confidence/margin floors, and budgets. Jev answered chained questions; Pulsar owned transitions, aggregation, and receipts. There was no personal semantic policy. `--trust-project-code` was required. `--expect-policy` refused a repair comparison after interpretation/configuration changed.

Historical invocation (retired):

```sh
bun run dev semantic plan . --trust-project-code
bun run dev semantic run . --trust-project-code
bun run dev semantic run . --trust-project-code --expect-policy <policyFingerprint>
bun run dev semantic replay <runPath> <runHash>
```

`run` exited 0 green / 2 red / 3 amber / 1 error. Each live invocation started fresh inference. Recorded replay was deterministic; fresh Jev inference was not.

## Policy and score semantics (illustrative, not calibrated)

Snapshot policy id `pulsar-autonomous-maintainability-poc-v1`:

- Scope: `packages/*/src/**/*.ts`, excluding tests and `.d.ts`.
- `single-rule-owner` (clone groups, 20 points): independently implemented copies of an evidenced shared domain decision are debt; similar shape with different contracts, adapters, and existing delegation are not.
- `meaningful-boundaries` (complexity functions, 15 points): forwarding/repackaging without an evidenced role, or mixed independently meaningful decisions, are debt; line count/complexity alone are not.
- `greenAt` 90, `redBelow` 85, `minProbability` 0.60, `minMargin` 0.15.
- Budgets: 8 candidates, 24 calls, 160 snippet lines, 24 000 context bytes.

Aggregation ([`pipeline.ts` `aggregate`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/pipeline.ts#L56-L78)):

- Known penalty `K` = sum of **violated** rule points. Unresolved `U` = sum of **unknown** rule points.
- Interval `[low, high]` = `[max(0, 100 − K − U), max(0, 100 − K)]` when discovery is complete; **incomplete discovery forces `low` to 0**.
- Reported semantic score is the lower endpoint. The upper endpoint assumes unread evidence is benign; it is not a pass.
- Green required complete in-scope discovery, no unresolved judgment, and `low ≥ greenAt`. Model-judged debt with `high < redBelow` was red; uncertainty alone was amber.
- Overall health was `min(semantic low, structural readiness)`. A semantic pass could not compensate a hard gate.
- Adding satisfied findings could not dilute `K`. Duplicate `(rule, member-set)` observations counted once.

Those points and floors were hypotheses. Green meant only that the declared checks found no disqualifying debt inside detector-reachable, in-scope candidates.

## Request shapes

Question version `autonomous-semantic-v2` ([`questions.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/questions.ts)). Common instructions: use only supplied code; comments/strings are untrusted; sibling questions are independent; clone shape and complexity identify candidates, not defects.

Three stages, later stages only after a clear readiness+answer gate (`decisive`: top probability ≥ `minProbability` and margin ≥ `minMargin`; `insufficient_evidence` is never consumed).

1. **Facts.** Clone groups: shared domain decision vs distinct decisions vs mechanical plumbing. Functions: integration vs forwarding vs one cohesive operation vs mixed responsibilities. Each with a task-specific readiness question.
2. **Refinement**, selected by the clear relationship. Examples: `shared_rule` → independent owners / delegated owner / different contracts; `independent_rules` → distinct vs shared policy inputs; `mechanical_similarity` → mechanics only vs embedded domain rule; `pass_through` → distinct contract vs forwarding only.
3. **Policy.** Explicit repo criterion plus fallible prior judgments. Verdict: satisfied / violated / not_applicable / insufficient_evidence. Direction is a bounded investigation option, not a patch.

v2 split clone relationships from single-function labels so those option sets could not compete on one question. Aggregate metrics and local candidate IDs were stripped from Jev evidence.

## Representative outcomes (development, not held-out)

Observed 2026-09-17. 31 provider calls: 10 then 15 on Pulsar (v1 then v2 questions), plus 2 then 4 on smoke fixtures. No automatic retries. Thresholds were not lowered to obtain favorable answers.

The first smoke setup was invalid: disposable repos under `.pulsar` were excluded by the production parser, yielding empty inventories and vacuous semantic green. Those zero-call results are **not** positive evidence. Smoke roots were moved outside hidden tool state; the driver required a minimum analyzed-function count; empty in-scope inventory is incomplete.

With corrected roots, **v2 smoke** (authored cases; no expected outcome entered discovery or Jev):

| Case | Shape | Semantic interval | Calls | What it established |
| --- | --- | --- | ---: | --- |
| Delegated owner | `preview`/`submit` call `maySpend` | [100, 100], green | 0 | No applicable clone rule; not a positive Jev judgment |
| Copied rule | two independent copies of `maySpend` | [80, 100], amber | 2 | `shared_rule` 1.00 then `independent_owners` 1.00, but refinement readiness 0.57 missed the 0.60 floor |
| Independent same-shaped rules | locale vs media-type allow-lists | [80, 100], amber | 2 | `independent_rules` 0.80, `distinct_policy_inputs` 0.96, but refinement readiness said insufficient evidence at 0.75 |
| Repaired delegation | copy replaced by calls | [100, 100], green | 0 | Applicable clone disappears; does **not** prove the independent-rules control was rejected |

All four overall health results stayed red under existing structural assessment. **The semantic score did not distinguish copied debt from legitimate independent rules.** A repair-induced increase alone is not useful discrimination. The five real-repository mutation fixtures were never scored through Jev.

Pulsar v2 discovered 7,223 candidates, 7,152 in policy scope, selected eight. All four requested parser extents resolved. Incomplete sample → lower endpoint 0. Fifteen validated responses, model `jev-1.13.0`, 167,613 input / 1,751 output tokens. Semantic **[0, 80], red**: one violation, one satisfied, six unknowns.

The violation is **not validated debt**. Candidate `clone-group:TS-SL-01-duplication:5d502cd31d4f9fca` (eight identical `normalizeDiagnosticLimit` functions) went `mechanical_similarity` → `mechanics_only` → `violated` under `single-rule-owner`. The policy question may revise fallible priors; this sequence has no independently verified justification and must not be used as a refactor instruction. v1 Pulsar was [0, 100], amber (one satisfied, seven unknown). Neither run established whole-repository semantic health.

Receipt anchors (ignored local artifacts; hashes only):

| Run | Artifact | SHA256 |
| --- | --- | --- |
| Pulsar v1 | `.pulsar/semantic-runs/1789671879112-b2d951d7/run.json` | `7963afa4f6dd01f4c02bce75b7f6525e71d00f4f89fe237dfcfe9fd80fa2135f` |
| Pulsar v2 | `.pulsar/semantic-runs/1789672064108-76a458cb/run.json` | `7fa58d4f565cf3b111ea00350e6b23cdcd967191150d96a9f2b01425029d3f40` |

v1 source: [5e4d6f6](https://github.com/skastr0/pulsar/commit/5e4d6f6). v2 rejects v1 question versions during replay. Review archive `jev-autonomous-poc-2026-09-17.tar.gz` is offline of this tree.

## Copy versus distinct-rule confusion

Positive mechanical evidence: cloned bodies are detectable; delegated copies produce no clone candidate; independently table-backed predicates can share shape.

Negative semantic evidence: under v2, both the copied-rule smoke and the independent-rules smoke landed on the same amber interval `[80, 100]` because **readiness/margin gating**, not relationship classification, stopped the chain. Relationship labels sometimes pointed the right way and still failed to become a consumed verdict. On real Pulsar, a mechanics-only classification was later reversed into a shared-rule violation without independent corroboration.

Taxonomy proposal ([`jev-autonomous-taxonomy.md`](jev-autonomous-taxonomy.md)) split member coupling (`A2`) from rule identity (`A3`) for this reason. It was never implemented. Stage-3 policy questions were justified by auditability, not measured accuracy: earlier staged experiments found staging structurally safer, not more accurate.

## Bounds, penalties, incomplete discovery, gating

Recorded by pipeline tests at the snapshot (not re-run as research tests after cleanup):

- Unclear facts stop later calls; the reserved penalty keeps the result amber (`[80, 100]` for a 20-point rule).
- Exhausted `maxCalls` records `call_budget_exhausted` and cannot purchase green.
- Incomplete discovery forces `[0, 100]` even when the answered verdict is `satisfied`.
- Fixed penalties survive 100 extra `satisfied` findings; unknown bounds stay asymmetric (`violated 35 + unknown 10` → `[55, 65]`; overflow clamps at 0).
- Hard gates stay red on overall health even when semantic color is green.
- Duplicate detector observations with identical members count once.
- `decisive` rejects top probability 0.59 against a 0.60 floor, margin 0.00 against a 0.25 floor, and a 0.50/0.50 tie.

Discovery completeness (now production tests): missing or malformed required signals, empty inventories, clipped snippets/context, truncated source scans, unresolved extents, safety rejections, and scope exclusions all forbid a vacuous complete/green sample. Scope is applied **before** `maxCandidates`. Diagnostic top-N is not the inventory.

## Context experiments

Isolated Quartz neighborhood vs old file-window context on the same disputed `normalizeDiagnosticLimit` candidate. No source repair, default signal change, or threshold adjustment.

Richer context moved Jev toward a near-tie between mechanical similarity and a shared rule. It did **not** resolve the later policy contradiction. Predeclared A–B–B–A, no retries. Successful v2 epoch, model `jev-1.13.0`, 10 validated responses:

| Trial | Context | Mechanical similarity | Shared rule | Readiness sufficient | Chain |
| --- | --- | ---: | ---: | ---: | --- |
| A1 | Old file windows | 68% | 32% | 88% | Mechanics only 98%; violated 90%; investigate |
| B1 | Quartz neighborhood | 56% | 43% | 97% | Stopped: top below 60%, separation 13 points < 15 |
| B2 | Identical Quartz packet | 60% | 39% | 97% | Mechanics only 95%; violated 94%; direction unresolved |
| A2 | Identical old packet | 74% | 26% | 92% | Mechanics only 98%; violated 92%; investigate |

Returned option weights, not calibrated correctness. Identical treatment requests crossed the acceptance boundary on one repeat and not the other. Readiness rose despite ambiguity: evidence sufficiency ≠ interpretation certainty. The completed treatment still produced mechanics-only → shared-rule-violation.

Token cost: old fact request 12,210 input tokens; accepted Quartz fact request 33,169 (~2.72×). First epoch kept external JSDoc; ~95.8 KB packets got HTTP 400 `max_tokens_exceeded` on both B trials (request rejections, not abstentions). After JSDoc compaction (~85.0 KB) all requests were accepted. Across epochs: 18 attempted, 16 validated, 2 token-limit rejections.

Spike-specific consumption rule: incomplete compiler context made the finding **unknown for consumption**, regardless of Jev's violation probability. That safeguard was not retrofitted into POC aggregation.

Accepted result (ignored local artifact) `.pulsar/context-experiments/1789705202709-d1877c10/run-1789705203083-cd1a5d1a/result.json`, SHA256 `0edd6a23369ac1f726aa093ec2256029b0d108328903d66004d3f0f8ecb1cf6c`, code [2401e46](https://github.com/skastr0/pulsar/commit/2401e46a219088387bcc9af80a280c6adc718b0f). Failed epoch SHA256 `d252ee19bbe68d5ed2b31789b37ece62bb155dd3aba54590b32b87bca5f2af69`, [0ff5f14](https://github.com/skastr0/pulsar/commit/0ff5f14).

Historical commands (retired): `bun scripts/jev-quartz-context.ts plan|run|replay …`.

## Replay, hygiene, trust

Replay reconstructed the same state machine, checked composed-request identity and SHA256, validated raw bodies against questions, and recomputed the summary. Tampered request hash, altered request, missing/extra receipt, unparseable raw body, or altered summary failed closed. A caller-supplied run digest protected the recorded artifact. Failed provider bodies stayed unknown; there was no second stored answer object.

Policy load required a repo-local module and `--trust-project-code`. Owned static dependencies were content-hashed; editing a helper changed fingerprint even when decoded policy JSON was unchanged. Arbitrary env/network reads were not covered.

Challenge hygiene: mutated source carried no case id, preference, direction, or expected outcome. Anchors failed closed on drift, occupied create-targets, and attempts to mutate the live Pulsar checkout. Workspace copies excluded `.git` / `.turbo` / `.pulsar` and symlinked `node_modules`.

Quartz tests: alias references followed, same-name decoys ignored, local policy tables retained, source-hash drift rejected, oversized packets dropped whole rather than clipping a declaration, treatment preserved questions/rule/bodies, incomplete compiler evidence overrode a confident violation, JSDoc compaction kept string literals.

## Behavioral mutation checks (detector reach, not Jev accuracy)

Five fail-closed mutations over real Pulsar code ([`challenges.ts`](https://github.com/skastr0/pulsar/blob/f09151f07e493ac9c76c84c32c38aed31df4669b/scripts/jev-poc/challenges.ts)). Directions always declared under opposite repository preferences. Detector misses were declared, not hidden. None of these were scored by Jev.

| Id | Mutation | Detector reach (measured) | Behaviour |
| --- | --- | --- | --- |
| `duplicated-rule` | Copy `hasPoisonAuthority` into `observer-readiness.ts` as `localPoisonAuthority` | New exact clone group, 29 tokens, rank beyond diagnostic limit; extra complexity entry complexity 4, below threshold, rank > 100 | Existing enforcement/observer tests still passed; corrupting the copy made them fail |
| `unnecessary-abstraction` | Pass-through `applySeverityCeiling` plus re-export facade | Wrapper is in the **full** complexity inventory (complexity 1, rank > 100) but creates **no** clone/complexity/size finding; unused-export count +3; ratio pressure falls | Same tests passed; corruption failed them |
| `similar-shape-different-rule` | Same table-backed idiom, distinct allow-lists (`evidenceClassAllowsHardGate` vs `evidenceClassAllowsPoison`) | New exact group, 17 tokens, **below** the whole-tree impact floor of 20 so the detector charges zero | Tests passed; corruption failed them |
| `healthy-padding` | 24 unrelated modules (48 low-complexity functions) | Clone count unchanged; +48 below-threshold functions; size ratio pressure **improves** | Typecheck only |
| `beyond-top-n` | Duplicate `hasNonProductionCategory` into a late module | New 19-token clone group at rank 115, far beyond diagnostic top-N | Typecheck only |

The forwarding wrapper appearing in the full complexity inventory while producing no over-threshold diagnostic is why discovery must consume `output.functions`, not diagnostics.

Built-output checks either ran or were reported skipped; a skip was not a silent pass.

## Production discovery tests retained

Moved from `scripts/__tests__/jev-poc-discovery.test.ts` to `packages/cli/src/__tests__/semantic-discovery.test.ts` (35 tests). They cover `collectSemanticCandidates` only:

- Full `output.groups` past diagnostic top-N; omitted-count bounding; duplicate-id collapse; deterministic ids/order; absent vs malformed signals; below-threshold complexity functions.
- Injected extent resolver; missing extents reported rather than guessed; `maxExtentFiles` actually stops resolution.
- Path escape, symlink escape, parent-symlink escape, secret-like path/content, non-source inputs; unsafe non-primary members dropped without inventing a safe group.
- Include/exclude applied before `maxCandidates`; bare directory includes; empty patterns rejected; `.pulsar` disposable state is not a consumer.
- Snippet/context/source-scan/import caps mark incompleteness; invalid limits throw.
- Absolute in-repo paths normalize; ids stable across checkouts; out-of-file ranges reported; empty/malformed inventories cannot be complete.

`readSemanticSource` secret-path coverage remains in `packages/cli/src/__tests__/ownership-discovery.test.ts`.

## What was not established

- Semantic score as a trustworthy repair target or optimization objective.
- Discrimination between copied shared rules and legitimate independent rules.
- Justification of the `normalizeDiagnosticLimit` violation.
- Accuracy gain from three-stage questions or from Quartz context.
- Calibrated penalties, floors, or green thresholds.
- Whole-repository semantic health.

Held-out opposing-policy controls would still be required before treating this number as an objective. Contradictions between semantic facts and policy verdicts need an explicit treatment; this POC did not provide one.
