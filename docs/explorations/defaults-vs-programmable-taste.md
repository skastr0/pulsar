# Defaults vs Programmable Taste

## Purpose

Pulsar's default product contract is generic, conventional, and least-surprising. A new repository should receive broadly reusable repository-health signals, not a hidden copy of this repository's architecture taste.

Pulsar is also intentionally programmable. Teams should be able to teach Pulsar their architecture, framework contracts, generated-code conventions, risk model, and local taste. The boundary is that local taste must be explicit calibration, not default behavior.

This note defines that boundary.

## Definitions

### Generic Defaults

Generic defaults are the behavior a repository gets without a repo-local project module, organization module, or applied opinionated preset.

Defaults should satisfy three tests:

1. A broad software-engineering audience would recognize the concern.
2. The signal can name a concrete cost-of-change, correctness, review, or maintenance risk.
3. The default claim remains useful without knowing the team's local architecture taste.

Examples that usually qualify:

- circular dependencies;
- high structural complexity outliers;
- unsafe boundary erosion;
- public API churn;
- stale generated contracts when contract source data is present;
- high churn with weak coverage facts;
- broad or old suppressions;
- unresolved dependencies;
- untyped external inputs crossing into core code.

Generic does not mean weak. Pulsar defaults should still find real engineering pressure. Generic means the default rationale is conventional and inspectable, not personal or repository-specific.

### Calibration

Calibration is explicit interpretation of generic evidence under a declared context.

Calibration may be owned by:

- a repository;
- an organization;
- a framework;
- a technology pack;
- a separately packaged opinionated profile.

Calibration can classify, deweight, tune, preserve-visible, or mark findings non-applicable. Score-affecting calibration must expose:

- module id;
- processor id;
- rule id;
- reason;
- evidence;
- confidence;
- default policy;
- final policy;
- factor paths changed;
- processor and module fingerprints.

### Presets

Presets are templates for creating or updating a repository vector. A preset is not active Pulsar until it is applied to a repository.

Preset descriptions must say what kind of opinion they encode:

- generic starter;
- workflow or risk profile;
- technology or framework profile;
- organization standard;
- opinionated taste profile.

An opinionated preset is valid, but it must be named and described as opinionated.

Shipped preset vectors should also carry machine-readable `preset_profile` metadata:

- `workflow-risk` for a temporary or enduring risk posture;
- `technology-practice` for a technology-specific practice profile;
- `architecture-taste` for an architecture-school preference that reasonable teams may dispute.

All shipped preset profiles use `explicit-apply-only` activation. Listing, showing, diffing, or importing a preset must not change a repository's active scoring policy until a repo-owned vector is written or updated.

### Opinionated Packages

Opinionated packages are valid opt-ins. They may encode strong preferences, including preferences most teams would dispute.

Examples:

- a strict small-module profile;
- a domain-driven boundary-first profile;
- a generated-SDK profile that deweights generated code pressure;
- this repository's local preference for small pure utilities, explicit shared contextual code, and larger local integration when locality beats forced abstraction.

These packages are not the neutral product contract. They should be packaged, named, documented, and activated explicitly.

## Acceptable Default Behavior

Acceptable defaults make claims that remain useful without local taste.

Examples:

- Flag a dependency cycle because it increases change propagation and local reasoning cost.
- Flag a high-complexity function as a review risk while exposing calibration for framework callbacks or generated code.
- Flag a duplicate clone group by default while allowing a repo module to mark generated fixtures or all-integration protocol code as lower-risk.
- Flag a public API signature churn trend because it affects consumers and release risk.
- Treat missing coverage facts as unknown or not configured, not as measured zero.
- Soft-warn on a composite when required evidence is incomplete rather than pretending missing facts prove health.

## Unacceptable Default Behavior

Unacceptable defaults smuggle local taste or one architecture school into generic scoring.

Examples:

- Treat "all files should be small" as a universal truth without calibration or enforcement limits.
- Treat "integration code may be large and duplicated" as a universal truth.
- Treat "all duplication must be removed" as a universal truth.
- Treat "all abstractions are suspicious until they have multiple implementations" as a universal truth.
- Treat this repository's self-calibration as the recommended default for new repositories.
- Describe a preset as though it is active scoring policy before it is applied.
- Hide a score-affecting repo rule in home-directory fallback state or personal agent instruction.

## The Three-Tier Taste

The three-tier taste used by this repository is useful but not canonical:

- small, generic, pure utilities;
- explicit shared contextual code;
- larger local integration code when locality preserves one operational decision better than extraction.

This is a legitimate profile. It is not Pulsar's default ontology.

It may live as:

- repository-local self-calibration;
- an example project module;
- an opinionated preset;
- a separately packaged opinionated profile.

It should not live as:

- mandatory core vocabulary;
- hidden default scoring behavior;
- the only supported file-role model;
- the public claim that all repositories should organize code this way.

Compatibility note: existing `architectural_tier` helpers may remain while older
project modules migrate, but generic examples and new helper APIs should prefer
repo-defined `architecture_role` and `policy_tags` metadata.

Current compatibility surface:

- Generic API: core calibration and project-module SDK exports may keep
  compatibility helpers, but new generic helpers should be named around
  `architecture_role` and `policy_tags`.
- Self-calibration: `.pulsar/modules/pulsar-self.ts` may keep the three-tier
  vocabulary because it is explicit Pulsar repository taste, but it should
  publish that taste through repo-defined `architecture_role` metadata.
- Tests: generic taxonomy and SDK tests should prove non-three-tier roles or
  tags work; three-tier assertions should be limited to compatibility tests or
  Pulsar self-calibration tests.
- Docs: product docs may mention the three-tier model only as an optional
  profile or migration compatibility surface, not as Pulsar's default ontology.

## Implementation Checks

The following checks keep the boundary honest:

1. A default fixture with no project modules must score through conventional baseline policy.
2. A repo-calibrated fixture must show visible policy decisions when the same evidence receives different interpretation.
3. A non-three-tier calibration fixture must prove the programmable layer is general.
4. Output must show whether a finding came from default policy or calibration.
5. Core helpers should use neutral vocabulary such as `file_role`, `architecture_role`, or `policy_tags` unless a finite enum is genuinely conventional.
6. Preset descriptions must say whether they are generic starters, workflow profiles, technology profiles, or opinionated taste profiles.
7. Docs must describe this repository's self-calibration as dogfooding, not as the default ideal.

## Review Questions

When adding or changing a signal, ask:

1. Is this generic evidence, or local interpretation?
2. Would a reasonable team reject this as taste?
3. If taste-laden, is there a calibration surface?
4. If not tunable, is the enforcement ceiling low enough?
5. Does output show the policy path from default to final?
6. Could another repo encode the opposite preference without forking the signal?

If the answer to the last question is no, the design is probably smuggling taste into the default.
