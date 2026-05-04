# Taste Codec Agent Guide

## Project Intent

Taste Codec measures repository health with deterministic, inspectable signals. Its outputs are only trustworthy if every contributor and agent evaluates a repository under the same repo- or organization-owned taste definition.

## Non-Negotiable Domain Invariant

Taste is repository-level, always.

- The effective taste vector belongs to the repository or organization being scored, regardless of where the file is transported from.
- A repo-local `.taste-codec/vector.json` always overrides a home or organization-level vector.
- A home-directory vector may be valid only as an organization-standard fallback shared across repos. It is not personal preference.
- CLI output that uses a home-directory vector must identify it as an organization fallback so it cannot be mistaken for repo-local taste.
- There is no personal taste vector or portable per-agent taste for scoring a repo.
- Anyone working in a repo shares that repo's taste. Divergent per-person scoring makes the system theater.
- Presets are templates for creating or updating a repo vector. A preset is not active taste until it is applied to the repo.
- Calibration rules that affect scores must be repo-scoped, organization-scoped, framework-scoped, or technology-scoped with explicit activation evidence. They must not be hidden in personal fallback state.

## Stack and Tooling Constraints

- Use `bun` for package operations and test commands.
- Keep signal behavior deterministic unless a signal is explicitly Tier 3.
- Preserve cache correctness whenever a change can alter a score.

## Key Concepts and Architectural Principles

- Signals compute grounded evidence.
- A taste vector configures how this repository interprets and weights that evidence.
- Calibration adapts signal interpretation to repo layout, framework conventions, and technology contracts.
- Project modules are project-owned TypeScript/Effect modules that contribute typed calibration processors. Data-only JSON helpers may exist, but they are convenience APIs, not the foundation.
- Repo- and organization-level taste and calibration must be diffable, hashable, attributable, and explainable.

## Workflow Conventions

- Before changing signal semantics, identify whether the change is generic signal logic, repo calibration, framework calibration, or score weighting.
- Do not broaden defaults to satisfy one repo unless the rule is genuinely reusable.
- When extracting calibration, preserve current behavior first, then move rules into the correct layer.
- Update cache keys or fingerprints whenever resolved taste or calibration can affect output.

## Anti-Patterns to Avoid

- Do not add or extend personal or per-agent taste hierarchy.
  - Instead, resolve one effective repo/org vector and make any proposed change explicit against that shared artifact.
- Do not treat `~/.config/taste-codec/vector.json` as personal taste.
  - Instead, treat it only as an organization-level fallback transport location, with repo-local `.taste-codec/vector.json` taking precedence.
- Do not describe taste as portable personal preference.
  - Instead, describe presets as portable starting templates and repo vectors as the source of truth.
- Do not smuggle project facts into generic signal source code.
  - Instead, express them as repo calibration or pack calibration with rule attribution.
- Do not reduce calibration to a closed JSON DSL when the heuristic requires executable signal processing.
  - Instead, use project modules that attach code-backed processors to typed slots.
- Do not make score-affecting calibration invisible.
  - Instead, expose rule IDs, sources, activation evidence, and fingerprints.
