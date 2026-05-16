# Goal: Generic Defaults and Programmable Taste Boundary

## Executive Summary

Pulsar must be a generic, standard, least-surprising repository health system by default, while remaining deeply programmable for teams that want different architecture taste.

This is a project-defining boundary:

- Pulsar core provides deterministic mechanisms.
- Pulsar defaults provide conservative, conventional, research- and practice-backed checks.
- Repository, organization, framework, technology, preset, or package-level calibration expresses opinionated taste.
- Pulsar's own self-calibration is an example of programmability, not the universal ideal.

The previous goal proved that Pulsar can encode repo-owned taste and compose raw deterministic facts into higher-level diagnoses. That was valuable, but it also surfaced a risk: the self-score proof introduced a three-tier vocabulary, `pure_utility | shared_contextual | integration`, close enough to core that a new reader could mistake it for Pulsar's default ontology.

This goal corrects that boundary. Pulsar should follow the principle of least surprise out of the box. If someone installs Pulsar in an arbitrary repository, they should get a conventional repository-health baseline, not Guilherme's personal architecture preference. If someone wants Guilherme's preference, or any other strong preference, Pulsar should make that programmable, inspectable, packaged, and explicit.

## Decision

Pulsar's neutral product contract is:

1. Built-in defaults must use conventional software-engineering language and broadly reusable evidence.
2. Built-in defaults must avoid hidden architecture taste where reasonable people disagree.
3. Taste-laden signals must expose calibration surfaces, absence semantics, claim limits, and enforcement ceilings.
4. Repo-specific interpretation must live in explicit calibration modules, vectors, presets, or opinionated packages.
5. Pulsar's self-score module may be opinionated, but it must be visibly repo-local and never described as the universal default.

The three-tier model remains valid as one optional taste:

- small pure utilities;
- explicit shared contextual code;
- larger local integration code when locality beats forced abstraction.

But it must be modeled as a repo-owned or packaged taste profile, not as Pulsar's canonical file-role model.

## Non-Negotiable Product Invariant

Pulsar default behavior is generic, standard, and least-surprising.

- A new repository must not inherit Pulsar's self-calibration taste unless it opts in.
- Generic signal names, output fields, docs, presets, and examples must not imply that one architecture school is the default ideal.
- Defaults may penalize conventional risk signals such as high complexity, excessive size, circular dependencies, unsafe boundaries, stale contracts, untested churn, broad suppressions, and public API instability.
- Defaults must not hard-code disputed taste choices such as "small files are always better", "integration blobs are good", "duplication is always bad", "all abstractions should be extracted", or "all context should stay local".
- When a metric depends on taste, Pulsar must expose the calibration point or cap the enforcement ceiling.

## Current State

What is already good:

- Repo-local project modules exist and are loaded through `.pulsar/project-modules.json`.
- `pulsar-self` is scoped as a repository project module.
- Size, nesting, clone, unsafe-type, type-coupling, churn, bus-factor, and PR-size policy slots exist or have working usage.
- Project-module SDK helpers allow score-affecting policy tuning with rule ids, reasons, evidence, and fingerprints.
- Composite signals now expose inputs, normalized values, missing states, weights, rationale, and enforcement ceilings.
- AGENTS.md now states the generic-defaults invariant.
- README.md now states the generic-defaults invariant at first-read product level.

What is still wrong or ambiguous:

- Core currently defines `ArchitecturalTier` as `pure_utility | shared_contextual | integration`.
- Project-module SDK exposes helpers named around `ArchitecturalTier`.
- Tests use that vocabulary in core/pack assertions, which makes the taste look generic.
- `goal.md` had stale roadmap text and no longer represented the new product boundary.
- README.md may still need deeper links into presets, project modules, and opinionated-package examples.
- `pulsar-self.ts` proves programmability but still acts as the primary example; docs must prevent readers from mistaking it for the product default.
- There is not yet an alternate taste example proving that the programmable layer is not hard-wired to the three-tier taste.

## Desired Architecture

### Core

Core owns neutral mechanisms:

- signal interfaces;
- calibration slots;
- project-module runtime;
- file classification metadata;
- policy values;
- vectors;
- composite input resolution;
- cache and fingerprint contracts;
- evidence and absence semantics.

Core should not own one personal architecture ontology unless the ontology is explicitly conventional and extensible.

### Defaults

Defaults own conservative baseline behavior:

- conventional complexity and size pressure;
- conventional clone pressure;
- conventional dependency, cycle, and coupling pressure;
- conventional unsafe-boundary pressure;
- conventional churn, ownership, coverage, suppression, and public API risk pressure;
- cautious enforcement ceilings when interpretation is taste-laden.

Defaults may be opinionated only where the claim is broadly defensible and least-surprising.

### Calibration

Calibration owns local interpretation:

- repo taste;
- organization standards;
- framework contracts;
- technology conventions;
- generated-code conventions;
- deliberate boundary exceptions;
- local risk model;
- packaged opinionated profiles.

Calibration must be visible in output:

- module id;
- processor id;
- rule id;
- reason;
- evidence;
- default policy;
- final policy;
- factor paths changed;
- processor fingerprint;
- active module fingerprint.

### Opinionated Packages

An opinionated distribution is allowed, but it must be explicit:

- `@skastr0/pulsar-opinionated-*`;
- a named preset;
- a repo template;
- a project module package;
- an optional CLI init profile.

It must not silently redefine Pulsar's generic baseline.

## Terminology Target

Replace or contain the current `ArchitecturalTier` vocabulary.

Candidate generic model:

```ts
type FileClassificationMetadata = {
  source_category?: SourceCategory
  file_role?: string
  architecture_role?: string
  policy_tags?: readonly string[]
}
```

Rules:

- `source_category` remains conventional and finite: production source, test code, generated, config tooling, documentation, etc.
- `file_role` may describe common roles: domain, adapter, boundary, generated, fixture, migration, public api, test helper, cli entrypoint.
- `architecture_role` may be repo-defined when a repo wants a role vocabulary.
- `policy_tags` may carry arbitrary repo-defined tags for calibration.
- The three-tier values become one repo-defined `architecture_role` set or one `policy_tags` convention, not a universal core enum.

Alternative acceptable outcome:

- Keep `ArchitecturalTier` only if renamed, documented, and generalized enough that it no longer encodes the personal three-tier taste.
- If compatibility requires keeping the exported type temporarily, mark it as legacy/self-calibration-oriented and migrate docs/tests away from it.

## Work Plan

### Track A: Documentation and Product Contract

Goal: make the product boundary impossible to miss.

1. Finish README.md.
   - Preserve the "Default Philosophy" section.
   - Link project modules, vectors, presets, and calibration to the customization story.
   - State that opinionated distributions are separate opt-ins wherever packaging/release docs discuss them.

2. Finish AGENTS.md alignment.
   - Ensure it says generic defaults are non-negotiable.
   - Ensure workflow rules prevent self-calibration vocabulary from leaking into generic defaults.
   - Ensure anti-patterns cover personal taste in core.

3. Update docs that still imply the old roadmap state.
   - `docs/explorations/composite-signal-authoring.md`
   - `docs/explorations/project-module-sdk-requirements.md`
   - `docs/explorations/signal-customization-surface-audit.md`
   - any docs that say size/nesting/clone slots do not exist after they do.

4. Add a short design note.
   - Proposed path: `docs/explorations/defaults-vs-programmable-taste.md`.
   - It should define:
     - generic defaults;
     - repo calibration;
     - presets;
     - opinionated packages;
     - examples of acceptable and unacceptable default behavior.

Acceptance criteria:

- README.md states the generic-defaults invariant in first-read product language.
- AGENTS.md states the same invariant for agents.
- At least one durable design note explains the boundary.
- No primary docs describe Pulsar's self-score taste as the generic ideal.

### Track B: Vocabulary and Type Boundary

Goal: remove personal taste vocabulary from core-level generic API unless explicitly scoped.

1. Audit `ArchitecturalTier`.
   - `packages/core/src/architectural-tier.ts`
   - `packages/project-module-sdk/src/helpers.ts`
   - tests referencing `architectural_tier`
   - `.pulsar/modules/pulsar-self.ts`
   - docs referencing `pure_utility`, `shared_contextual`, `integration`.

2. Design the replacement surface.
   - Prefer neutral `architecture_role` and/or `policy_tags`.
   - Keep `SourceCategory` separate from repo taste.
   - Decide whether compatibility wrappers are needed.

3. Implement neutral helpers.
   - `readArchitectureRole`
   - `withArchitectureRoleMetadata`
   - `readPolicyTags`
   - `withPolicyTagMetadata`
   - or equivalent names that fit the existing codebase.

4. Move three-tier helpers out of generic core semantics.
   - Option A: keep them in `.pulsar/modules/pulsar-self.ts`.
   - Option B: move them to a sample/opinionated module.
   - Option C: keep deprecated compatibility exports while docs/tests use neutral helpers.

5. Update tests.
   - Core tests should prove neutral metadata works.
   - Self-calibration tests may still use the three-tier vocabulary.
   - Add a test that a different repo-defined role can drive policy without using the three-tier vocabulary.

Acceptance criteria:

- Generic core APIs no longer require `pure_utility | shared_contextual | integration`.
- The Pulsar repo can still express its self-calibration taste.
- At least one alternate role/tag fixture proves programmability beyond the three-tier model.
- Public API migration is documented if any exported type changes.

### Track C: Default Behavior Audit

Goal: prove out-of-box Pulsar behavior is not secretly calibrated to Pulsar's own taste.

1. Build a default scoring fixture.
   - No `.pulsar/project-modules.json`.
   - No repo-local calibration.
   - Representative TypeScript files with size, nesting, clones, unsafe types, boundaries, and churn where possible.

2. Build a calibrated scoring fixture.
   - Same code shape.
   - Explicit project module applying a local taste policy.
   - Policy should change interpretation with visible calibration decisions.

3. Build an alternate taste fixture.
   - Not the three-tier taste.
   - Example: "strict small-module shop" or "generated-code-heavy SDK" or "domain-boundary-first service".
   - It must prove the calibration mechanism is general.

4. Assert output differences.
   - Default policy stays conventional.
   - Calibrated policy changes only with explicit module activation.
   - Output names the module, processor, rule id, reason, evidence, and policy delta.

Acceptance criteria:

- Tests show default scoring does not apply Pulsar self-calibration.
- Tests show explicit calibration can change score semantics.
- Tests show a non-three-tier calibration works.
- Missing project modules do not silently activate opinionated behavior.

### Track D: Presets and Opinionated Distribution Boundary

Goal: make customization paths clear without making presets active defaults.

1. Audit existing presets.
   - `refactor-friendly`
   - `domain-purist`
   - `ai-slop-defense`
   - any new presets added during recent work.

2. Classify presets.
   - generic starter;
   - opinionated taste profile;
   - workflow/risk profile;
   - technology/framework profile.

3. Update preset descriptions.
   - Presets are templates, not active Pulsar.
   - Applying a preset is an explicit repo decision.
   - Opinionated presets must say they are opinionated.

4. Decide whether the three-tier taste should become a packaged profile.
   - Candidate name: not final, but must avoid sounding like the default.
   - It can live as a sample module, docs example, or package.

Acceptance criteria:

- No preset description implies it is the default ideal.
- Opinionated presets are named and described as opinionated.
- README clearly separates defaults, presets, and project modules.

### Track E: Output and Explanation Clarity

Goal: users can tell whether a finding came from generic default logic or local policy.

1. Review CLI JSON output for calibration decisions.
   - Confirm default policy and final policy are visible where score-affecting.
   - Confirm module and processor fingerprints are visible where relevant.

2. Improve human output if needed.
   - When a policy was changed by calibration, show a concise note.
   - Make repo-local self-calibration clearly identifiable.

3. Add explanation snapshots.
   - Default output.
   - Repo-calibrated output.
   - Opinionated profile output.

Acceptance criteria:

- A user can inspect a score and know whether it reflects default Pulsar or repo calibration.
- Score-affecting calibration is not hidden behind the final numeric score.
- Human output does not over-explain, but JSON output preserves full provenance.

### Track F: Self-Calibration Containment

Goal: keep Pulsar's own repo taste useful without making it normative.

1. Update `.pulsar/modules/pulsar-self.ts` comments and metadata.
   - State that it is Pulsar repository self-calibration.
   - State that it is not the product default.
   - Keep reasons specific to this repo.

2. Consider renaming local rule ids if needed.
   - Avoid names that sound universal.
   - Keep `pulsar.` prefix only when it clearly means "the Pulsar repository", not the product default.

3. Ensure tests distinguish self-calibration from generic behavior.

Acceptance criteria:

- Self-calibration remains explicit and useful.
- No generic docs or tests require adopting it.
- No user-facing default path activates it outside the Pulsar repository.

## Implementation Order

1. Documentation contract first.
   - README.md
   - AGENTS.md
   - `docs/explorations/defaults-vs-programmable-taste.md`

2. Vocabulary design second.
   - Audit `ArchitecturalTier`.
   - Decide neutral replacement.
   - Add migration notes.

3. Tests before broad refactor.
   - Default fixture.
   - Pulsar self-calibration fixture.
   - Alternate taste fixture.

4. Refactor core/SDK vocabulary.
   - Introduce neutral helpers.
   - Move or contain three-tier vocabulary.
   - Preserve compatibility where needed.

5. Output clarity.
   - Ensure score output distinguishes default logic from calibration.

6. Preset/opinionated packaging cleanup.
   - Update preset descriptions.
   - Decide whether to package the three-tier taste as an example.

## Acceptance Criteria for the Whole Goal

- `bun run verify` passes.
- README.md explains that Pulsar defaults are generic, conventional, and least-surprising.
- AGENTS.md preserves the same invariant for agents.
- A design note explains defaults vs calibration vs presets vs opinionated packages.
- Generic core APIs no longer force the three-tier taste vocabulary, or the remaining compatibility surface is explicitly scoped and documented.
- Pulsar self-calibration remains repo-local and visible.
- At least one test proves default scoring does not activate Pulsar self-calibration.
- At least one test proves a non-three-tier calibration can change score interpretation.
- User-facing output makes score-affecting calibration provenance inspectable.
- Preset docs do not imply opinionated profiles are active defaults.

## Non-Goals

- Do not remove programmability.
- Do not weaken Pulsar's ability to encode strong taste.
- Do not claim there is no reasonable default baseline.
- Do not turn generic defaults into a lowest-common-denominator non-opinion.
- Do not make calibration JSON-only if executable project modules are the correct abstraction.
- Do not make the Pulsar repo abandon its self-calibration taste. The goal is containment and clarity, not taste erasure.

## Risk Register

### Risk: Overcorrecting into weak defaults

Generic does not mean toothless. Defaults should still flag conventional cost-of-change risks.

Control:

- Keep conventional checks active.
- Use enforcement ceilings and calibration for disputed interpretation.

### Risk: Breaking users of current exported tier helpers

The current helpers may already be used in local modules.

Control:

- Add compatibility wrappers if needed.
- Mark migration clearly.
- Avoid unnecessary breaking API changes before package stability.

### Risk: Hiding taste under neutral names

Renaming `integration` to `architecture_role` is not enough if the default still behaves as if integration blobs are preferred.

Control:

- Add default-vs-calibrated fixtures.
- Require output provenance for policy changes.

### Risk: Documentation says the right thing but tests do not prove it

This boundary is too important to live only in prose.

Control:

- Add explicit tests for default behavior, Pulsar self-calibration behavior, and alternate taste behavior.

## Success Definition

After this goal, a new user should understand three things within the first few minutes:

1. Pulsar's default is a conventional deterministic repository-health baseline.
2. Pulsar can be programmed to follow strong local taste.
3. Any local taste that changes scores is explicit, inspectable, attributable, and not confused with the default.

That is the product boundary Pulsar needs before further signal expansion.
