# Goal: Pulsar Constraint Ecosystem v1

## Executive Summary

Pulsar Constraint Ecosystem v1 should demonstrate three end-to-end capabilities:

1. A repository can express architecture taste as deterministic, repo-owned policy instead of per-agent instruction, hidden personal preference, or one-off score suppression.
2. Composite signals can turn raw facts into judgment-capable diagnostics while remaining deterministic, inspectable, and explainable.
3. A broader deterministic signal library can give AI-assisted development a powerful out-of-the-box health system without turning Pulsar into an LLM judge.

The objective is not to build "SonarQube with more rules." The objective is to make Pulsar the deterministic constraint substrate that coding agents and humans can both consult:

- source signals collect grounded facts;
- repo facts and calibration processors interpret those facts under explicit repo/org semantics;
- the repo/org vector mixes priorities;
- composite signals encode diagnostic hypotheses over multiple primitive facts;
- optional AI classifiers may later provide cached labels as fact artifacts, but never live final scores.

This goal starts with Pulsar scoring Pulsar. Pulsar should not expand the signal library aggressively until it demonstrates that it can represent the repo's declared taste and apply it consistently. The taste to demonstrate first is the three-tier abstraction-pressure model:

- `pure_utility`: shared, generic, pure code should be small, reusable, low-context, and low-coupled.
- `shared_contextual`: shared code inside a project/framework/domain context should be explicit, named, and carefully parameterized.
- `integration`: code that does things may intentionally be larger, local, procedural, and less abstract when that preserves the whole decision in one readable artifact.

If Pulsar cannot represent that distinction, more signals will push every repo toward one architectural school. The goal is not "one taste wins." The goal is "declared repo taste becomes inspectable, deterministic, and consistently scored."

## Evidence Basis

This goal is grounded in two local evidence sets.

Pulsar implementation and design evidence:

- `ARCHITECTURE.md`
- `docs/project-modules.md`
- `docs/explorations/calibration-processor-architecture.md`
- `docs/explorations/signal-customization-surface-audit.md`
- `packages/core/src/calibration-model.ts`
- `packages/core/src/calibration-slot-values.ts`
- `.pulsar/modules/pulsar-self.ts`

Type-Driven Verification research evidence:

- `/Users/guilhermecastro/Projects/research-knowledge-base/sources/research-resources/type-driven-verification/README.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/sources/research-resources/type-driven-verification/source-dossiers/source-dossier-depth-audit.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/final-synthesis-constraint-ecosystem-report-plan.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/type-system-first-principles.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/schema-driven-typescript-effect-runtime-boundaries.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/quicksand-ai-code-without-theory.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/programming-as-theory-building-simple-design.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/compiler-typechecker-static-analysis-feedback.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/ai-code-generation-constraint-verifier-feedback.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/agent-readable-architecture-fitness-functions.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/parse-dont-validate-boundary-construction.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/functional-domain-modeling-invariant-encoding.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/property-based-testing-executable-specifications.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/contracts-assertions-runtime-verification.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/economics-adoption-human-factors-constraint-systems.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/type-soundness-statics-dynamics.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/domain-driven-design-canonical-spine.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/verifier-proof-property-test-feedback.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/formal-specification-tla-alloy-model-checking.md`
- `/Users/guilhermecastro/Projects/research-knowledge-base/wiki/type-driven-verification/ai-code-quality-security-benchmark-caveats.md`

Important evidence caveat:

- The wiki pages are concise promoted summaries and pointers, not standalone proof. External-facing claims must cite the canonical source dossiers, source cards, papers, books, or public sources behind them. Local file names are acceptable for this internal goal, but they are not public evidence.

The research spine supports scoped claims:

- Type systems are useful constraints, not proof of business correctness, security, termination, or runtime safety.
- Boundary safety comes from construction discipline: parse weak inputs into stronger values, hide invalid constructors, preserve evidence, and keep raw boundary values out of core code.
- AI-generated code becomes dangerous when generated text is accepted faster than the team can rebuild, encode, and check the program theory behind it.
- Machine-checkable feedback loops are the defensible mechanism: compilers, typecheckers, static analyzers, tests, contracts, property tests, verifiers, architecture checks, and CI.
- Agent-readable prose orients agents, but deterministic checks enforce architecture.
- Constraint systems are costed ladders. Stronger machinery is not automatically better; each layer buys different evidence at different human and maintenance cost.

Pulsar should therefore avoid universal claims. The durable claim is narrower: deterministic, repo-owned constraints can make AI-assisted codebases more inspectable, steerable, and reviewable.

## Type-Driven Verification Synthesis

The type-safety research changes the shape of this goal. Pulsar should not present "more types" or "more metrics" as the answer. The stronger claim is that modern AI-assisted engineering needs a constraint ecosystem: multiple machine-checkable evidence layers, each scoped, costed, and calibrated to the repository's chosen architecture.

### Claims Pulsar Should Keep

1. Type safety is scoped evidence, not correctness.
   - A type system proves only the properties encoded by that system under its assumptions.
   - Type soundness does not imply business correctness, runtime boundary safety, security, termination, performance, or maintainability.
   - Pulsar implication: every signal must name its evidence class and limit.
   - Sources: `type-system-first-principles.md`, `type-soundness-statics-dynamics.md`.

2. The winning architecture is layered constraints, not one master checker.
   - Types, schemas, property tests, contracts, runtime verification, model checking, proof systems, architecture tests, and CI gates buy different kinds of evidence at different costs.
   - Stronger constraints are not automatically better. The right constraint is the cheapest one that buys the evidence needed for the risk tier.
   - Pulsar implication: the vector and calibration layer should express expected evidence by repo region and risk tier.
   - Sources: `final-synthesis-constraint-ecosystem-report-plan.md`, `economics-adoption-human-factors-constraint-systems.md`.

3. Boundary construction is where TypeScript safety becomes real.
   - "Parse, don't validate" is the operational rule: weak external values should become stronger domain values at the boundary, and core code should not keep re-checking raw weak values.
   - Pulsar implication: boundary/parser coverage, raw-value leakage, assertion-heavy adapters, unchecked `any`, stale generated contracts, and uncontrolled constructors are first-class signal families.
   - Sources: `schema-driven-typescript-effect-runtime-boundaries.md`, `parse-dont-validate-boundary-construction.md`.

4. Domain modeling is a constraint surface.
   - Invariants live in construction, representation hiding, ADTs, typed errors, state transitions, and canonical domain language.
   - Pulsar implication: file taxonomy cannot stop at `src` versus `test`; it needs domain, adapter, generated, fixture, migration, public API, pure utility, shared contextual, and integration roles.
   - Sources: `functional-domain-modeling-invariant-encoding.md`, `domain-driven-design-canonical-spine.md`.

5. Agent-readable architecture needs executable fitness functions.
   - `AGENTS.md`, architecture docs, and repo maps orient agents, but prose does not prevent drift.
   - Pulsar implication: repo taste must become repo-scoped calibration plus deterministic architecture fitness checks with provenance, not hidden personal instruction.
   - Sources: `agent-readable-architecture-fitness-functions.md`, `docs/explorations/calibration-processor-architecture.md`.

6. AI-generated code improves when forced through external feedback loops.
   - The defensible mechanism is not model self-judgment; it is compiler/typechecker/static-analysis/test/verifier feedback routed back into generation and repair.
   - Pulsar implication: feedback-loop coverage and closure rate should become health facts for AI-assisted workflows.
   - Sources: `ai-code-generation-constraint-verifier-feedback.md`, `compiler-typechecker-static-analysis-feedback.md`, `ai-code-quality-security-benchmark-caveats.md`.

7. Composite signals are where raw facts become useful judgment.
   - Most primitive facts are too local to be strong diagnoses. Pulsar's design inference is that their value appears when composed: churn plus complexity plus coverage gap plus ownership diffusion means something different from each input alone.
   - Pulsar implication: primitive signal expansion should be justified by composite consumers, not by signal count.
   - Sources for the constraint-composition pattern: `verifier-proof-property-test-feedback.md`, `compiler-typechecker-static-analysis-feedback.md`.

8. Proof-like artifacts certify stated obligations, not intent.
   - Property tests, fuzzing, contracts, TLA+/Alloy models, runtime monitors, refinement types, and proof assistants are powerful only for the properties actually stated, generated, monitored, or proven.
   - Pulsar implication: proof/property/model signals must expose property identity, assumptions, bound, oracle quality, trace conformance, drift, and maintenance cost.
   - Sources: `property-based-testing-executable-specifications.md`, `contracts-assertions-runtime-verification.md`, `formal-specification-tla-alloy-model-checking.md`.

### Overclaim Guardrails

Pulsar must explicitly reject these claims in docs, UI copy, and score explanations:

- A green typecheck means code is correct.
- Runtime schemas make TypeScript sound.
- PBT, fuzzing, or runtime verification is proof.
- A model is the implementation.
- A proof certifies product intent rather than a stated proposition under assumptions.
- Prose architecture instructions keep agents aligned without executable checks.
- AI labels are truth.
- Stronger constraints always produce better engineering outcomes.
- A single health score can be meaningful without evidence class, calibration provenance, and missing-fact state.

### Signal Evidence Contract

Every production signal and composite should declare:

- evidence class: syntax, type, runtime boundary, domain invariant, architecture dependency, temporal history, test/coverage, ownership, model/proof, AI-labeled fact, or repo policy;
- claim shape: what the signal can legitimately say;
- non-claim shape: what the signal cannot infer;
- applicable region: language, framework, file role, architectural tier, risk tier, or declared boundary;
- absence semantics: `zero`, `absent`, `unknown`, `not_configured`, or `not_applicable`;
- calibration surface: slot id, policy type, rule provenance, and override/deweight/non-applicable semantics;
- composite consumers;
- enforcement ceiling: hard gate, soft gate, review route, informational, or research-only;
- failure-mode note: at least one known false-positive or false-negative pattern.

No raw primitive may be promoted as a broad health claim until this contract exists.

## Current State

Pulsar has a strong substrate:

- repo/org-owned pulsar vector semantics;
- repo-local project modules declared by `.pulsar/project-modules.json`;
- source and helper fingerprinting for project modules;
- typed calibration slots and deterministic `runSlot`;
- calibration decisions with action, confidence, reason, rule id, before/after, and evidence fields;
- `FileClassificationValue.metadata`, which can carry `architectural_tier` without a schema migration;
- existing policy slots such as `typescript.unsafe-type-policy`, `typescript.type-coupling-policy`, `typescript.dependency-version-policy`, `typescript.pr-size-policy`, `shared.bus-factor-policy`, and `shared.churn-rate-policy`;
- declared `typescript.clone-group-policy`, although the relevant signals still need complete consumption;
- compound signal support through signal input dependencies and topological execution.

Pulsar also has important gaps:

- the trust baseline must be audited and made green before this roadmap proceeds;
- `pulsar-self.ts` is not proof of the three-tier taste system. It is a useful current repo-owned policy module, but it also demonstrates the anti-pattern this goal must remove: repeated path lists, magic thresholds, and one-off policy tuning;
- there is no `taxonomy.file-classifier` processor in `pulsar-self.ts` assigning `pure_utility | shared_contextual | integration`;
- there are no canonical helpers for reading or writing `architectural_tier`;
- there is no `typescript.size-policy` slot;
- there is no `typescript.nesting-policy` or equivalent per-finding complexity/nesting slot;
- `typescript.clone-group-policy` exists as a slot but must be wired into `TS-SL-01` and `TS-SL-02`;
- `TS-LD-02` calibrates callback naming, not size policy;
- `TS-LD-03` is threshold/config based, not calibration-context based;
- current compound support is thinner than a composite SDK: it provides dependencies, not reusable explanation, normalization, missing-input handling, or cross-pack authoring ergonomics;
- current output does not yet guarantee the full chain `default policy -> calibration processor -> final policy -> rule id -> evidence -> fingerprint` for every score-affecting decision.

## Non-Goals

This goal does not claim:

- Pulsar proves code quality or architecture quality.
- TypeScript, schemas, or type systems make AI code safe.
- AI-generated code always causes architecture decay.
- Property-based tests, fuzzing, runtime schemas, or static analysis are proof.
- Stronger constraints are always worth their cost.
- Composite scores know design intent.
- AI labels are truth.

Pulsar provides repeatable diagnostics over declared evidence and declared policy. Human and agent judgment still matters.

## Non-Negotiable Invariants

Pulsar remains repository-level.

- The effective pulsar vector belongs to the repository or organization being scored.
- Repo-local `.pulsar/vector.json` and `.pulsar/project-modules.json` override home/org fallbacks.
- Home-directory vector use must be identified as organization fallback, not personal preference.
- There is no personal pulsar vector and no portable per-agent pulsar for scoring a repo.
- Presets are templates. They are not active pulsar until applied to a repo.

Pulsar remains deterministic by default.

- Tier 1 and Tier 1.5 outputs must be reproducible for the same repository state and configuration.
- Calibration processors must be deterministic, fingerprinted, and attributable.
- Cache keys must include every score-affecting input: signal implementation identity, signal config, active vector, vector resolution, active calibration modules, processor source, resolved calibration outputs, fact-source fingerprints, and committed AI label artifact hashes when present.
- Missing facts must not be silently collapsed into zero.
- AI may later provide cached labels as fact inputs, but AI must not directly produce final scores or hidden CI gates.

Signals are sensors; calibration expresses context.

- Source signals extract raw structural evidence with as little project-specific interpretation as possible.
- Framework, technology, repo, and organization semantics live in typed calibration slots.
- A calibration processor can classify, resolve, deweight, enrich, or tune policy, but it must expose rule id, evidence, reason, confidence, processor id, processor fingerprint, and active module fingerprint.
- Score-affecting calibration cannot be invisible.
- Deweighted findings should remain visible unless explicitly classified non-applicable with evidence.

Composites are deterministic diagnostic functions.

- Raw metrics should not be treated as final diagnosis when a composite captures the real maintenance cost.
- A composite must expose primitive input ids, raw values, normalized values, missing-input states, weights, final score, and rationale.
- New primitive signals should feed at least one composite unless they are independently critical hard-gate checks.

Enforcement follows evidence strength.

- Tier 1 hard structural facts may gate CI when false-positive risk is low.
- Tier 1.5 composites may gate only when the repo has accepted the composite hypothesis, inputs, and calibration policy.
- Tier 2 reference-data checks may gate only when the reference artifact is explicit, versioned, and fingerprinted.
- Tier 3 AI labels soft-warn or route review by default. They cannot hard-gate unless committed and replayable under repo policy.

## Goal Shape

Build Pulsar Constraint Ecosystem v1 in six milestones:

1. Trust Baseline
2. Taste Spine
3. Self-Score Refactor
4. Composite Signal Platform
5. Deterministic Signal Expansion
6. AI-Classified Facts, Not AI Scoring

Each milestone must leave the repo shippable. The work is ordered so signal expansion cannot outrun verification, calibration, provenance, and composite explanation.

## Staffing and Governance Model

This is a staff-level roadmap, so each work item should be assigned with explicit responsibility before implementation starts.

Required roles per milestone:

- DRI: owns scope, sequencing, and merge decision.
- Implementer: makes the code changes.
- Reviewer: checks correctness, local architecture fit, and test coverage.
- Verification owner: owns `bun run verify`, fixture evidence, cache/fingerprint checks, and output snapshots.
- Product/evidence owner: checks documentation, source-claim hygiene, and public-facing wording.

Default governance:

- No milestone starts while the previous milestone's decision gate is failing.
- No score-affecting behavior ships without tests and cache/fingerprint coverage.
- No new signal ships without a declared enforcement ceiling.
- No new taste-laden signal ships without a calibration surface or explicit non-tunable rationale.
- No composite ships without explanation snapshots.
- No AI-assisted scoring path ships without offline replay fixtures.

Size guidance:

- Milestone 1 should be one focused stabilization push.
- Milestone 2 should be split into 1-2 week pushes by slot family.
- Milestone 3 should be serialized by signal cluster; each re-coalescing change should be independently reviewable.
- Milestone 4 should ship the SDK and one migrated composite before any broad composite migration.
- Milestone 5 should add primitives in priority order, with each primitive tied to a composite.
- Milestone 6 is design-first. It should not block deterministic v1.

## Milestone 1: Trust Baseline

### Objective

Make the repository safe to evolve. No taste, composite, or signal expansion work should proceed while the local verify gate is red or ambiguous.

### Work Items

1. Audit the current baseline.
   - Run `bun run verify`.
   - Confirm whether the TS-RP-01 alias test failure still exists.
   - Confirm whether worktree project-module bundling still fails.
   - Confirm whether cache fingerprints already cover calibration-sensitive scores.

2. Fix alias semantics if still failing.
   - Canonical signal id may be `TS-RP-01-hotspots`.
   - Alias `TS-RP-01` must remain valid for user-facing references.
   - Tests must explicitly state whether they expect request id, alias id, or canonical id.

3. Fix worktree project-module bundling if still failing.
   - Repo-local modules must load correctly when Pulsar scores a temporary worktree.
   - Standalone binary behavior must match source-run behavior.
   - Failure messages must identify the module path, materialized path, dependency root, and bundling cause.

4. Close cache-fingerprint ambiguity.
   - Score-affecting signal config, active calibration slots, project-module source, vector resolution, resolved policy outputs, and fact-source fingerprints must participate in cache keys.
   - Manual one-off cache invalidation commits should become exceptional rather than normal.

5. Establish `bun run verify` as the hard local invariant.
   - CI and local workflow should fail closed on tests, typecheck, build, and relevant package verification.
   - A goal item is not complete unless verify is green or the failure is explicitly unrelated and documented.

### Acceptance Criteria

- `bun run verify` passes from a clean checkout.
- Alias semantics are covered by regression tests.
- Worktree project-module loading has integration coverage.
- A cache/fingerprint test changes the cache key or score fingerprint when calibration source or resolved policy changes.
- The previous red-test failure mode cannot recur silently.

### Exit Artifact

- Verification note documenting the baseline, fixed failures, cache/fingerprint coverage, and remaining known risks.

## Milestone 2: Taste Spine

### Objective

Make the three-tier architecture taste expressible as repo-owned deterministic policy through one classifier spine.

### Work Items

1. Define the architectural tier contract.
   - Tier values: `pure_utility`, `shared_contextual`, `integration`.
   - Represent tier initially through `FileClassificationValue.metadata.architectural_tier`.
   - Add typed helpers for reading, writing, and validating the tier.
   - Do not overload `SourceCategory` unless a type-level tier enum clearly earns its keep.

2. Add a `taxonomy.file-classifier` processor to `pulsar-self.ts`.
   - Classify Pulsar files into the three tiers.
   - Emit rule id, reason, confidence, and evidence.
   - Prefer glob/package/file-role rules over duplicated exact path lists.
   - Exact path exceptions are allowed only when named as exceptions with reasons.

3. Add or complete score-affecting policy slots for taste-laden signals.
   - `typescript.size-policy` for `TS-LD-02`.
   - `typescript.nesting-policy` or split `typescript.complexity-policy` plus `typescript.nesting-policy` for `TS-LD-01` and `TS-LD-03`.
   - Complete `typescript.clone-group-policy` consumption in `TS-SL-01` and `TS-SL-02`.

4. Add project-module SDK helpers.
   - `tuneTypeScriptSize`.
   - `tuneTypeScriptNesting` and/or `tuneTypeScriptComplexity`.
   - Clone-group helpers for deweighting, allowing, preserving-visible, and marking non-applicable clone groups.

5. Wire tier-aware consumers.
   - Size, nesting/complexity, clone, unsafe-type, churn, ownership, and PR-size policy processors should read tier through the classifier where tier is the relevant reason.
   - Remaining bespoke policy rules must explain why tier is insufficient.

6. Add output provenance plumbing early.
   - Score output must show default policy, calibrated policy, final policy, rule id, evidence, processor id, processor fingerprint, and active module fingerprint.
   - This is required before claiming self-score evidence.

7. Clean up `pulsar-self.ts`.
   - Replace duplicated path-list taste clusters with the single tier classifier.
   - Keep temporary branch/process policies clearly separate from architecture taste.
   - TC-specific cleanup policies must include owner, removal trigger, and expiry/review cadence.

### Acceptance Criteria

- `pulsar-self.ts` contributes one `taxonomy.file-classifier` processor assigning `pure_utility | shared_contextual | integration`.
- One repo-owned classifier drives tier-aware size, nesting/complexity, clone, unsafe-type, churn, ownership, and PR-size policies where tier is the reason.
- Size, nesting/complexity, and clone signals call calibration slots and emit calibration decisions.
- Named taste fixtures cover the same size/clone/nesting pattern in `pure_utility` and `integration` files, assert the expected tier labels, assert the expected policy deltas, and assert the final diagnostic visibility/severity/penalty for each fixture.
- `pulsar-self.ts` has no duplicated path-list taste clusters except named explicit exceptions with reasons.
- Score output shows `default policy -> calibration processor -> final policy -> rule id -> evidence -> fingerprint`.
- Cache tests change output or cache key when tier classifier source or resolved tier policy changes.

### Exit Artifact

- Self-score calibration report showing at least one finding whose interpretation changes due to repo-owned taste.
- Short design note explaining how another repo can choose a different taste and how to verify that taste is active.

## Milestone 3: Self-Score Refactor

### Objective

Use the taste spine to re-evaluate Pulsar's own over-fragmented areas and refactor only where the declared taste says locality is better.

### Work Items

1. Re-score Pulsar under the tier-aware policy.
   - Capture before/after findings for size, nesting/complexity, clone, unsafe type, type coupling, churn, and ownership.
   - Confirm which findings are real defects and which are taste-policy mismatches.

2. Re-coalesce over-fragmented signal clusters serially.
   - Candidate clusters: `ts-sl-04-*`, `ts-ld-02-*`, `ts-ld-07-*`, `ts-rp-02-*`.
   - Merge integration logic when splitting forces a reader through multiple behavior files to understand one decision.
   - Keep pure utilities split when they are truly reusable and low-context.
   - Keep shared contextual modules split when naming, ownership, and tests improve changeability.

3. Preserve behavior.
   - Refactors must preserve current scores unless the score change is explicitly expected from the new taste policy.
   - Tests should cover representative signal behavior before and after re-coalescing.

### Acceptance Criteria

- At least one over-fragmented integration signal cluster is re-coalesced under the declared taste, with golden output or focused signal fixtures proving unchanged findings except for explicitly documented taste-policy deltas.
- Self-score comparison records the exact old findings, new findings, tier labels, policy deltas, and cache fingerprints that changed because integration locality is the declared ideal.
- Each re-coalesced file has a clear reason for its boundary: pure utility, shared contextual, or integration.
- `bun run verify` passes after each serialized cluster refactor.

### Exit Artifact

- Refactor report mapping files from old split to new artifact boundaries and explaining the tier rationale.

## Milestone 4: Composite Signal Platform

### Objective

Make compound signals first-class enough that Pulsar's strongest out-of-box value comes from diagnoses, not isolated metrics.

### Rationale

Individual metrics are weak when isolated. Churn, complexity, ownership, coverage, duplication, dependency facts, boundary facts, and suppression facts become much more useful when composed.

"Judgment-capable" means deterministic composition over named primitive facts, declared weights, normalization, policy, and rationale. It does not mean human judgment or LLM judgment.

### Work Items

1. Build a composite signal SDK.
   - Extract input-resolution patterns from existing hotspot signals.
   - Support declared input signal ids, aliases, optional inputs, factor paths, and per-input weights.
   - Preserve topological ordering and cache behavior.
   - Standardize missing-input semantics.

2. Define the composite explanation model.
   - Primitive input ids.
   - Raw values.
   - Normalized values.
   - Missing input states.
   - Weights.
   - Final score.
   - Rationale.
   - Enforcement ceiling.

3. Enable cross-pack composites.
   - Shared facts must feed TypeScript and Rust composites.
   - Language-specific metrics should compose with shared churn, bus-factor, coverage, suppression, and ownership facts.
   - Mixed-language repos must not pretend all languages expose the same primitive evidence.

4. Migrate `TS-RP-01-hotspots` first.
   - Use it as the reference implementation for the SDK.
   - Preserve alias behavior.
   - Snapshot the explanation output.

5. Support trend-aware composites.
   - Composites should consume current facts and historical facts.
   - This enables decay rate, coverage-debt growth, and recency-weighted churn.

### Acceptance Criteria

- `TS-RP-01-hotspots` migrates to the composite SDK.
- Cross-pack composite input resolution is covered by tests.
- A composite explanation snapshot includes primitive ids, raw values, normalized values, missing-input handling, weights, final score, and rationale.
- New primitives can plug into composites without bespoke runner code.
- Composite cache keys include input signal outputs and relevant policy/fact fingerprints.

### Exit Artifact

- Composite authoring documentation with one TypeScript example, one shared example, and one mixed-pack example.

## Milestone 5: Deterministic Signal Expansion

### Objective

Add the highest-leverage deterministic facts needed for powerful out-of-the-box diagnostics.

### Ordering Principle

Prioritize facts that:

- have low false-positive rates;
- measure direct cost-of-change consequences;
- feed a composite;
- can be computed deterministically;
- can be calibrated when taste-laden;
- produce actionable locations or ranked findings;
- distinguish `absent`, `unknown`, `not configured`, and `zero`.

Signal count is not the primary success metric. Diagnostic power is.

### Priority P0: Feedback and Composite Inputs

1. `SHARED-07-machine-feedback-coverage`
   - Class: universal.
   - Checks: compiler/typecheck/static/test command presence, freshness, and CI reachability.
   - Rationale: AI code generation benefits from external feedback loops, not model self-judgment.
   - Composite consumers: contract safety gap, review shock, risk hotspot.

2. `SHARED-08-feedback-loop-closure-rate`
   - Class: universal with CI/session-history dependency.
   - Checks: whether AI-assisted changes reach deterministic green state through compilers, typecheckers, tests, static analysis, and configured verifiers; records first-pass pass rate, repair iterations, repeated failure classes, and time-to-green.
   - Rationale: the type-driven verification research says external feedback loops are the defensible mechanism for improving AI code, so Pulsar should measure whether the loop is actually closed.
   - Composite consumers: AI quicksand risk, review shock, constraint effectiveness.

3. Co-change / logical coupling.
   - Class: universal with repo-history dependency.
   - Emits file pairs with `co_change_count`, support, confidence, and last co-change timestamp.
   - Flags repeated co-change without structural dependency.
   - Composite consumers: architecture blast radius, risk hotspot, architecture decay.

4. Recency-weighted churn.
   - Class: universal with repo-history dependency.
   - Supplements flat windows with exponential decay.
   - Keeps raw windowed facts for explainability.
   - Composite consumers: risk hotspot, review shock, architecture decay.

5. Coverage fact source.
   - Class: reference-data-dependent.
   - Ingests lcov and common coverage JSON formats.
   - Preserves source file mapping, branch/function/line coverage, timestamp, and tool identity.
   - Absence of coverage is explicit, not zero by default.
   - Composite consumers: risk hotspot, contract safety gap, coverage debt.

6. Risk Hotspot v2.
   - Class: compound.
   - Composes recency-weighted churn, complexity, author/ownership concentration, coverage gap, and optionally co-change.
   - Supersedes the current two-factor hotspot as the primary review-pain signal.

### Priority P1: Boundary and Contract Safety

6. `TS-LD-08-exhaustiveness-erosion`
   - Class: universal for TypeScript.
   - Checks discriminated union switches/conditionals where defaults or catch-alls hide new variants.
   - Rust sibling concept already exists in broad match/catch-all detection.
   - Composite consumers: contract safety gap, boundary trust breach.

7. `SHARED-08-boundary-parser-coverage`
   - Class: reference-data-dependent.
   - Checks external inputs crossing into core without parse/decode/constructor evidence.
   - Requires declared boundaries and parser/schema conventions.
   - Composite consumers: boundary trust breach, contract safety gap.

8. `SHARED-09-contract-freshness`
   - Class: reference-data-dependent.
   - Checks generated API/schema artifacts stale against source contracts or missing generation provenance.
   - Composite consumers: contract safety gap, review shock.

9. `SHARED-10-domain-construction-control`
   - Class: reference-data-dependent.
   - Checks wrappers/brands/newtypes whose construction is uncontrolled.
   - Looks for smart constructors, parsers, private constructors, or controlled exports.
   - Composite consumers: boundary trust breach, abstraction hazard.

10. `TS-LD-09-error-channel-opacity`
   - Class: taste-laden plus reference-data-dependent.
   - Checks broad thrown errors, untyped `catch`, Promise APIs hiding expected failures, and Effect workflows that collapse typed errors.
   - Composite consumers: contract safety gap, review shock.

11. `SHARED-11-theory-encoding-index`
   - Class: compound plus reference-data-dependent.
   - Composes declared domain/core regions, boundary parser coverage, property/spec presence, architecture fitness coverage, typed error evidence, and AI-generated/churn pressure.
   - Rationale: the research frames AI quicksand as loss of recoverable program theory; this composite measures whether high-risk areas have machine-checkable theory artifacts.
   - Composite consumers: AI quicksand risk, constraint effectiveness.

### Priority P2: Architecture and Maintenance Expansion

12. Test architecture family.
   - Test-to-code LOC ratio per module.
   - Untested-and-hot intersection.
   - Skipped/disabled test count and age.
   - Mock density per test file.
   - Path conventions are calibratable repo facts, not universal truth.

13. Distance from main sequence.
   - Computes instability and abstractness per module/package where language data supports it.
   - Outputs distance from main sequence and trend over time.
   - Architecture physics, not a universal hard gate.

14. Effect leakage.
   - Detects IO, time, randomness, network, filesystem, persistence, process/env usage.
   - Respects declared pure zones from file taxonomy/tier policy.
   - Distinguishes visible typed effects from hidden ambient effects where possible.

15. Suppression debt.
   - Tracks TODO/FIXME/HACK age with git blame.
   - Tracks eslint-disable, ts-ignore, ts-expect-error, and language-specific suppressions.
   - Rewards justified, scoped, expiring suppressions over broad permanent suppressions.

16. Type opacity.
   - Measures surfaces resolved to `any`, `unknown`, weak generics, broad object maps, or opaque assertions.
   - Keeps TypeScript caveat explicit: static type coverage is not runtime safety.

17. Public API churn.
   - Tracks exported symbol churn and signature changes for packages with export maps or public barrels.
   - Distinguishes internal refactors from public contract churn.

18. Dead code v2.
   - Expands beyond unused exports to unused parameters, private members, and statically unreachable branches.
   - Keeps dynamic entrypoint calibration explicit.

19. Conway/ownership misalignment.
   - Uses CODEOWNERS where available.
   - Falls back to historical author clusters when no owner data exists.
   - Flags modules mostly changed by authors outside nominal ownership or with ownership diffusion beyond healthy thresholds.

20. Property/spec health.
   - Tracks property-based test files, generator diversity, skipped/flaky property tests, mutation score where available, model/spec files, runtime contract/assertion checks, and trace-conformance evidence.
   - Keeps caveat explicit: properties and models are executable evidence, not proof of unstated intent.
   - Composite consumers: theory encoding index, constraint effectiveness, contract safety gap.

### Composite Targets

These composites should guide primitive prioritization:

- `boundary trust breach`: boundary parser coverage + unsafe type erosion + domain term consistency + boundary violations.
- `architecture blast radius`: boundary violations + propagation cost + fan-in/fan-out hub + churn.
- `abstraction hazard`: public export spike + unused/internal-only exports + type indirection + generic proliferation + single-implementation interfaces.
- `review shock`: PR size + dependency delta + hotspot + new suppressions.
- `copy-paste rot`: duplication + inconsistent clones + churn + unfinished implementations.
- `contract safety gap`: contract freshness + parser placement + unsafe boundary erosion + missing executable checks.
- `architecture decay rate`: main-sequence drift + suppression-debt trend + co-change increase + boundary violations.
- `coverage debt growth`: test-to-code trend + untested-hotspot delta.
- `AI quicksand risk`: AI-touched or fast-churned code + weak machine feedback coverage + low theory encoding + high domain/core reachability + low review ownership.
- `constraint effectiveness`: feedback-loop closure + recurring failure classes + property/spec health + maintenance burden + defect/revert follow-through.
- `boundary integrity`: external input surface + parser/schema evidence + controlled constructors + raw-value leakage + unsafe type erosion.
- `theory preservation`: domain construction control + property/spec health + architecture fitness coverage + low stale-comment/spec drift.

### Delayed to Avoid the Metric Tar Pit

Delay or reject:

- broad readability or clarity floats;
- per-framework per-function policy slots before composites show value;
- property-test coverage percentages as generic health scores;
- borrow-aware Rust complexity beyond current evidence;
- AI labels as direct score inputs;
- public claims that metrics know design intent.

### Acceptance Criteria

- Each new primitive has deterministic tests and fixture coverage.
- Each new primitive has explicit absence states.
- Each new primitive has cache-key coverage.
- Each taste-laden primitive has a calibration surface or documented non-tunable rationale.
- Each primitive feeds at least one composite unless it is an explicitly standalone hard-gate check.
- New signal output includes actionable evidence: file, symbol, package, edge, pair, module, command, or artifact.
- Each signal declares max default enforcement level: hard gate, soft gate, review route, or informational.

### Exit Artifact

- Signal expansion report listing each new primitive, classification, composite consumers, calibration surface, absence states, cache contributors, and enforcement ceiling.

## Milestone 6: AI-Classified Facts, Not AI Scoring

### Objective

Design the optional AI-assisted layer so it strengthens deterministic scoring without compromising reproducibility.

### Principle

AI may classify intent-like facts that deterministic analysis cannot reliably infer. Pulsar still scores deterministically against those labels.

Pattern:

```text
content hash + prompt id + model id + classifier version -> label artifact
label artifact + deterministic policy -> score
```

The score must not depend on a fresh untracked model call.

### Candidate AI Fact Labels

- architectural role: pure utility, shared contextual, integration, adapter, domain, infra;
- essential versus accidental complexity;
- abstraction earnedness: domain model, true generalization, premature abstraction, speculative generality;
- naming honesty: accurate, misleading, obsolete, aspirational;
- test meaningfulness: behavioral, implementation-coupled, tautology, mock-only, snapshot-no-claim;
- comment-code drift;
- commit/PR intent: feature, fix, refactor, cleanup, mixed-scope, stealth behavior change;
- semantic clone families;
- behavior contract summary for public APIs.

### Guardrails

- AI labels are fact-source artifacts, not direct scores.
- Labels are cached by content hash, model id, prompt id, classifier version, and input scope.
- Label provenance is visible in output.
- CI fails open or soft-warns on missing AI labels unless the repo explicitly commits label artifacts and opts into harder behavior.
- AI-classified labels never replace deterministic structural evidence when deterministic evidence is available.
- Replay mode is mandatory before any user-facing score consumes labels.

### Acceptance Criteria

- A design document exists for AI fact-source artifacts.
- The design includes schema, cache key, prompt/version metadata, model metadata, confidence, expiry/staleness, input scope, and replay behavior.
- At least one classifier runs in offline/replay mode from committed fixture labels.
- Replaying committed label artifacts produces byte-identical scoring output without network/model access.
- Output distinguishes deterministic facts from AI-classified facts.
- Enforcement ceilings for AI-assisted findings are documented and tested.

### Exit Artifact

- `docs/explorations/ai-classified-facts.md` or equivalent, with schema, cache key, examples, replay fixtures, and enforcement ceiling.

## Cross-Cutting Requirements

### Provenance

Every score-affecting decision must be traceable:

- signal id, alias id, and canonical id;
- signal implementation identity;
- active vector source;
- vector resolution source;
- active calibration modules and processors;
- processor id, processor fingerprint, active module fingerprint;
- rule id;
- evidence references;
- default policy, calibrated policy, and final policy;
- cache fingerprint contributors;
- committed AI label artifact hashes when present.

### Absence Semantics

Signals and composites must distinguish:

- `zero`: measured and none found;
- `absent`: source is not present in this repo;
- `unknown`: source may exist but Pulsar could not determine it;
- `not_configured`: source requires explicit repo config and none was supplied;
- `not_applicable`: source does not apply under declared repo facts or policy.

These states must be visible in output and cacheable.

### Explainability

Pulsar output should make clear whether a score came from:

- raw source evidence;
- repo facts;
- technology/framework calibration;
- repo/org taste;
- vector weighting;
- composite weighting;
- cached AI-classified labels.

Agents can act on a finding only if they can see what would make the score improve.

### Constraint Economics

Pulsar should measure constraint burden alongside constraint benefit where the facts exist.

Relevant burden facts:

- annotation/schema/proof churn;
- property generator churn;
- stale generated contracts;
- disabled or skipped checks;
- override/deweight rates by signal;
- CI runtime cost by fact source;
- false-positive review notes where available;
- repeated repair loops for the same deterministic failure class.

Relevant benefit facts:

- earlier detection of boundary, type, architecture, test, or ownership failures;
- lower repair iteration count after feedback is added;
- fewer recurring failure classes;
- lower revert rate for high-risk regions;
- faster time-to-green for AI-assisted changes;
- lower review shock on hot modules.

The goal is not to maximize constraint count. The goal is to maximize useful evidence per maintenance dollar for the repo's chosen risk model.

### Documentation

Documentation should explain the mental model before the API:

- Signals are sensors.
- Calibration processors express repo semantics.
- Vectors mix priorities.
- Composites diagnose interactions.
- AI labels, if present, are cached facts.
- Presets are templates, not active pulsar.

Documentation must include at least one alternate taste example repo/module so "another repo can choose a different taste" is testable, not rhetorical.

## Staff-Level Delivery Plan

### Phase 0: Baseline Stabilization

Estimated shape: one focused stabilization push.

Scope:

- Audit verify.
- Fix verify failures.
- Fix or confirm alias semantics.
- Fix or confirm worktree project-module bundling.
- Confirm cache fingerprints cover score-affecting calibration.

Decision gate:

- `bun run verify` green.

### Phase 1: Taste Spine

Estimated shape: two to three 1-2 week pushes, split by tier classifier, slots, and output provenance.

Scope:

- Architectural tier helper/accessor.
- `taxonomy.file-classifier` processor in `pulsar-self.ts`.
- `typescript.size-policy`.
- `typescript.nesting-policy` or complexity/nesting split.
- `typescript.clone-group-policy` wiring.
- SDK helpers.
- provenance output.
- `pulsar-self.ts` cleanup.

Decision gate:

- Pulsar can express the three-tier taste without duplicated path-list taste clusters.

### Phase 2: Self-Score Refactor

Estimated shape: serial 3-5 day pushes per signal cluster.

Scope:

- Re-score Pulsar using the taste spine.
- Re-coalesce over-fragmented signal directories where integration logic was split too thin.
- Preserve or extract pure utilities where the split is real.

Decision gate:

- Self-score no longer rewards fragmentation when repo taste says integration locality is better.

### Phase 3: Composite Platform

Estimated shape: one SDK push plus one migration push.

Scope:

- Composite SDK.
- Cross-pack input resolution.
- Composite explanations.
- Missing-input states.
- Trend-aware composite support.
- `TS-RP-01-hotspots` migration.

Decision gate:

- A new composite can be authored without bespoke runner code and explain itself in snapshots.

### Phase 4: Killer Composite

Estimated shape: one fact-source push per primitive, then one composite push.

Scope:

- Machine feedback coverage.
- Feedback-loop closure rate.
- Co-change.
- Recency-weighted churn.
- Coverage fact source.
- Risk Hotspot v2.
- AI quicksand risk and/or theory encoding index as the first type-driven verification composite after Risk Hotspot v2.

Decision gate:

- Risk Hotspot v2 fixture output ranks review targets using documented non-size inputs: churn, ownership/authorship, coverage state, and optionally co-change; the test asserts the primitive inputs, normalized values, weights, missing-input states, and final ordering.
- AI quicksand or theory encoding fixture output demonstrates that a green typecheck alone does not score as healthy when boundary construction, executable feedback, ownership, and theory artifacts are missing.

### Phase 5: Signal Expansion

Estimated shape: one signal or tight signal family per push.

Scope:

- Boundary/contract safety signals.
- Test architecture family.
- Main sequence.
- Effect leakage.
- Suppression debt.
- Type opacity.
- Public API churn.
- Dead code v2.
- Conway/ownership misalignment.

Decision gate:

- Each primitive is either a hard structural check or feeds a named composite diagnosis.

### Phase 6: AI Fact Design

Estimated shape: design-first, implementation optional for v1.

Scope:

- Cached label artifact model.
- Classifier schema.
- Replay fixtures.
- Enforcement ceiling rules.

Decision gate:

- Pulsar can accept AI labels without making scoring nondeterministic.

## End-to-End Definition of Done

Pulsar Constraint Ecosystem v1 is done when all of these hold:

1. `bun run verify` passes.
2. Pulsar self-scoring uses a repo-owned project module to express architectural tiers.
3. Size, nesting/complexity, and clone pressure are tier-aware through calibration slots.
4. `pulsar-self.ts` has one tier/taste source and no duplicated path-list taste clusters.
5. Score output shows policy provenance and cache fingerprints for score-affecting calibration.
6. Missing facts distinguish `zero`, `absent`, `unknown`, `not_configured`, and `not_applicable`.
7. At least one over-fragmented integration signal cluster has been re-coalesced under the declared taste, with no loss of behavior.
8. Composite signal authoring is documented and no longer requires bespoke runner code.
9. `TS-RP-01-hotspots` is migrated to the composite SDK with explanation snapshots.
10. Risk Hotspot v2 ships as a composite over churn, complexity, ownership/authorship, coverage, and optionally co-change.
11. Machine feedback coverage, co-change/logical coupling, recency-weighted churn, and coverage facts are available as deterministic fact sources.
12. At least four additional deterministic signal families ship from the expansion list.
13. Every new taste-laden signal has an explicit calibration surface or a documented non-tunable rationale.
14. Every new signal declares an enforcement ceiling.
15. AI-classified facts have a design that preserves deterministic replay and visible provenance.
16. Documentation includes an alternate taste example with a runnable verification path.
17. Every production signal declares its evidence class, claim limit, absence semantics, calibration surface, composite consumers, enforcement ceiling, and at least one known failure mode.
18. At least one composite demonstrates the type-driven verification thesis: machine-checked feedback, boundary construction, theory artifacts, and maintenance cost are stronger together than any single raw metric.

## Risks and Controls

### Risk: Signal Expansion Amplifies One Taste

If size, clone, and nesting pressure are global and uncalibrated, more signals will drive every repo toward small-file, low-duplication, low-coupling style.

Controls:

- Finish taste expression before broad signal expansion.
- Treat taste-laden signals as zone-aware by default.
- Require alternate taste examples.

### Risk: Calibration Becomes Hidden Suppression

Project modules could become a place to zero out inconvenient findings.

Controls:

- Preserve visible findings where appropriate.
- Require rule id, evidence, reason, confidence, processor id, and fingerprint.
- Show default policy and final policy side by side.
- Prefer deweighting over deletion when evidence is real but lower-risk.

### Risk: Composites Become Opaque Scores

A composite can be worse than its inputs if it hides normalization and weights.

Controls:

- Standardize composite explanations.
- Snapshot primitive facts, normalized values, missing-input states, weights, and rationale.
- Keep raw primitive outputs available.

### Risk: AI Labels Break Determinism

Fresh model calls can make results non-reproducible.

Controls:

- Treat AI labels as cached artifacts.
- Key labels by content hash, model id, prompt id, classifier version, and input scope.
- Make replay mode first-class.
- Keep AI labels out of hard gates until committed and replayable.

### Risk: Verification Cost Grows Too High

The constraint ecosystem can become too expensive to run on every change.

Controls:

- Separate fast verify from full historical analysis.
- Cache fact sources with correct fingerprints.
- Run expensive trend/co-change analysis incrementally.
- Make CI tiers explicit: local, PR, nightly, release.

### Risk: Research Claims Outrun Evidence

Pulsar should not claim more than deterministic signals can show.

Controls:

- Keep claims scoped to evidence.
- Use TDV guardrails: no universal typed-language superiority claim, no proof from runtime schemas, no property-test-as-proof claim, no universal formal-methods ROI claim.
- Present Pulsar as a constraint feedback system, not an oracle.
- Before publication, cite canonical source dossiers or external sources rather than local wiki summaries.

## Product Position

Pulsar should play the role of a deterministic lab panel for AI-assisted software work.

The coding agent can reason, plan, and edit. Pulsar supplies repeatable measurements:

- what changed;
- what coupled;
- what grew;
- what became opaque;
- what lost test support;
- what violated declared boundaries;
- what drifted from the repo's chosen taste;
- what combination of facts deserves human or agent attention first.

That position is useful because it does not depend on one model provider, one IDE, one agent harness, or one programming language. Pulsar's job is not to replace judgment. Its job is to make judgment better aimed.

## First Concrete Push

The first implementation push is Milestone 1 only:

1. Run and record `bun run verify`.
2. Fix or confirm TS-RP-01 alias semantics.
3. Fix or confirm worktree project-module bundling.
4. Audit cache fingerprint contributors for calibration-sensitive scores.
5. Add or update regression tests for any confirmed failure.

Only after that should the repo move into taste-expression work.

This ordering is part of the goal. A red baseline invalidates later score improvement because Pulsar would be optimizing metrics while ignoring its own verification contract.

## TC-300 Validation Record

Validation type: markdown-only planning artifact.

Local checks:

- `git diff --check -- goal.md` passed.

Independent reviews:

- Normal requirements review: PASS after confirming the roadmap structure, scoped claims, non-goals, evidence basis, invariants, governance, acceptance criteria, risks, and first concrete push are present and aligned with `AGENTS.md`.
- Normal verification review: initial FAIL on proxy-score wording; PASS after taste, self-score, and Risk Hotspot v2 criteria were tightened to require named fixtures, tier labels, policy deltas, golden/focused outputs, primitive inputs, normalized values, weights, missing-input states, and cache/fingerprint assertions.
- Grok MCP review: initial FAIL on missing commit/process evidence; focused content rereview PASS after confirming scoped claims, six-milestone decomposition, evidence caveats, invariants, governance, measurable acceptance criteria, risks, first concrete push, and `AGENTS.md` consistency.

Commit gate:

- TC-300 is ready to commit once `goal.md` is staged as the only artifact for the documentation change.

## TC-307 Validation Record

Validation type: markdown-only research integration artifact.

Local checks:

- `git diff --check -- goal.md` passed.

Independent research coverage:

- Explorer agent reviewed the local Type-Driven Verification corpus and returned a source-grounded synthesis for scoped type-safety claims, layered constraints, boundary construction, domain modeling, executable architecture checks, AI feedback loops, composites, and proof-theater warnings.
- Grok MCP performed a separate local synthesis over the Type-Driven Verification corpus; its output converged on the same framing: Pulsar should be a deterministic constraint ecosystem, not a generic metric oracle or "more types fixes code" system.

Independent reviews:

- Normal requirements review: PASS with one low finding that this TC-307 validation record should exist separately from the older TC-300 record; addressed here.
- Normal fact-check review: PASS with one non-blocking finding that the composite-signal claim should be labeled as a Pulsar design inference rather than directly source-backed by TDV pages; addressed in the claim wording.
- Grok MCP bounded review: PASS after confirming source grounding, scoped claims, overclaim guardrails, actionable Pulsar requirements, roadmap preservation, and no commit-blocking issues.

Commit gate:

- TC-307 is ready to commit once `goal.md` is staged as the only artifact for the documentation change.
