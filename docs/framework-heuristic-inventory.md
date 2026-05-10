# Framework Heuristic Inventory

This inventory separates generic signal logic from framework, technology, repo-layout, and project facts. Generic signal code may keep language-level behavior, but project or framework facts should move to project modules or repo/org vector policy with explicit rule IDs and fingerprints.

## Removed from Generic TypeScript Signals

| Area | Previous location | Classification | New owner | Notes |
| --- | --- | --- | --- | --- |
| Effect server reactive empty lifecycle contracts in `server/reactive.ts` and `server/rendering.ts` | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Technology/project-module behavior | `@skastr0/pulsar-project-module-effect` processor `effect-server-reactive-contract-noops` | Removed from generic TS-SL-04. The module now classifies those empty hooks as intentional no-ops with rule `effect.server-reactive.contract-noop.v1`, source evidence, and processor fingerprint participation. |
| VS Code-style `extension.ts` `deactivate` no-op | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Framework/project-module behavior | Candidate for a VS Code/extension module or repo vector | Generic TS-SL-04 now flags this without module calibration. |
| React reconciler host config optional hooks and unsupported optional hooks | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Framework calibration | Candidate for React host-config module | Generic TS-SL-04 now flags these without module calibration. |
| Protected optional hooks named `buildWrangler`, `normalizeBuildCommand`, `validate` | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Framework/project-module behavior | Candidate for framework-specific modules or repo vector policy | Generic TS-SL-04 now flags these without module calibration. |
| Yargs parent command handlers with `builder` siblings | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Library calibration | Candidate for yargs module | Generic TS-SL-04 now flags these without module calibration. |
| `SyncEvent.project`, `Event.All.match`, projection adapter terminal no-ops | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Project/domain behavior | Candidate for repo/project module | Generic TS-SL-04 now flags these without module calibration. |

## Remaining Classified Heuristics

| Area | Location | Classification | Intended owner |
| --- | --- | --- | --- |
| `Effect.orElseSucceed(() => {})` fallback no-ops | `packages/project-module-effect/src/index.ts` | Technology calibration | Already module-owned by rule `effect.orElseSucceed.fallback-noop.v1`. |
| Effect callback context naming for `Effect.fn`, `Effect.gen`, `Effect.forEach`, and related constructors | `packages/project-module-effect/src/index.ts`; structural metadata emitted by `packages/ts-pack/src/signals/shared-function-index.ts` | Technology calibration | Module-owned naming; generic TS code may continue emitting structural call metadata. |
| JSX event callbacks and common UI placeholder callbacks | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Broad TypeScript/UI convention | Can remain generic while evidence stays structural and conservative; consider vector thresholds if noisy. |
| Capability-absent comments, null-object fallback methods, explicit noop files/factories | `packages/ts-pack/src/signals/ts-sl-04-empty-implementations.ts` | Generic structural intent | Reasonable generic fallback when naming or surrounding structure states no-op intent. |
| Framework virtual import specifiers such as Vite/Next/Svelte/Astro virtual modules | `packages/ts-pack/src/signals/ts-de-04-package-dependency-health.ts` | Framework calibration | Candidate for framework modules or repo vector allowlists. |
| Framework method contracts exempted from annotation coverage | `packages/ts-pack/src/signals/ts-ld-06-annotation-coverage.ts` | Framework calibration | Candidate for framework modules when callback-context/factor slots exist for annotation coverage. |
| Rust framework adapter vocabulary in dependency/error signals | `packages/rs-pack/src/signals/*` | Framework calibration when naming particular adapters, otherwise Rust architecture signal logic | Candidate for Rust framework modules if concrete framework names become score-affecting. |
| Shared suppression and PR dependency delta patterns | `packages/shared-signals/src/*` | Repo policy / shared process signal logic | Prefer repo/org vector policy for thresholds and allowed suppressions. |

## Migration Rule

When a heuristic depends on a framework/library name, repo path convention, or domain-specific contract, it should become one of:

- a technology/project module processor with `ruleId`, activation evidence, and fingerprint;
- a repo/org vector factor override or allowlist when the policy is repository-owned; or
- a documented generic language rule only when the evidence is structural and not tied to a particular framework.
