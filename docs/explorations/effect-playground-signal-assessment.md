# Effect playground signal assessment

Date: 2026-05-10

Scope:

- `/Users/guilhermecastro/Projects/Voyager/playground/effect`
- `/Users/guilhermecastro/Projects/Voyager/playground/opencode`

Method:

- Scored both repos with `bun packages/cli/src/bin.ts score --json`.
- Rendered every active TypeScript/shared signal with `pulsar score --signal`.
- Ran temporary detached-worktree comparisons with `.pulsar/project-modules.json` activating `@skastr0/pulsar-project-module-effect`.
- Did not modify either Voyager playground repo.

## Outcome

The assessment found one real Effect-pack expansion family: TS-SL-04 was treating Effect prototype/tag factory shells as unfinished empty bodies. This was not a project preference; it is a reusable Effect runtime pattern where an empty callable shell receives behavior through `Object.setPrototypeOf`, prototype assignment, `Object.assign`, static properties, or symbol metadata.

Implemented glyphs:

- `TC-151` classifies Effect prototype/tag factory empty shells as intentional no-ops.
- `TC-152` extends the same rule to anonymous `Object.assign(function() {}, Proto, ...)` prototype shells.

Validation evidence:

- Voyager Effect TS-SL-04 baseline: `0.974`, `20` diagnostics.
- After `TC-151`: `0.990`, `9` diagnostics, `15` attributed prototype-factory calibration decisions.
- After `TC-152`: `0.993`, `7` diagnostics, `17` attributed prototype-factory calibration decisions.
- Voyager opencode TS-SL-04 with the existing Effect pack removes the `which/Effect.orElseSucceed` false positive, but the score stays `0.800` because the remaining block is a real `throw-not-implemented` in `packages/opencode/src/acp/agent.ts:555`.

## Signal table

Legend:

- `pack action` means the Effect pack had or received a concrete calibration opportunity.
- `no action` means the signal looked correctly calibrated from available evidence, or the finding is repo-specific and belongs in repo vector/baseline/project calibration rather than the public Effect pack.

| Signal | Effect score | opencode score | Assessment |
| --- | ---: | ---: | --- |
| `SHARED-02-bus-factor` | `0.753` | `0.932` | no action: findings are authorship/churn facts, not Effect semantics. |
| `SHARED-03-churn-rate` | `0.974` | `1.000` | no action: Effect has one small recent-churn finding; opencode skips expensive line-survival due mature history. |
| `SHARED-05-suppression-governance` | not applicable | not applicable | no action. |
| `SHARED-06-pr-dependency-delta` | not applicable | `1.000` | no action. |
| `SHARED-CHURN-01-recent-churn` | not applicable | not applicable | no action. |
| `TS-AD-01-boundary-violations` | insufficient evidence | insufficient evidence | no action: both repos lack conventions. |
| `TS-AD-02-circular-dependencies` | `1.000` | `0.730` | no action: opencode cycle clusters are structural repo facts. |
| `TS-AD-03-reexport-depth` | `1.000` | `1.000` | no action. |
| `TS-DE-01-type-level-coupling` | `0.883` | `0.888` | no action: large type hubs are real package/API shapes. |
| `TS-DE-02-fan-in-fan-out` | `0.950` | `0.993` | no action: hub modules are real dependency graph facts. |
| `TS-DE-03-propagation-cost` | `1.000` | `1.000` | no action. |
| `TS-DE-04-package-dependency-health` | `0.975` | `0.909` | no action for Effect pack: findings are package manifest/dependency hygiene. Future ecosystem pack may handle root tooling config if needed, but not Effect semantics. |
| `TS-DE-05-duplicate-dependency-versions` | `0.956` | `0.953` | no action: lockfile version multiplicity is real dependency entropy. |
| `TS-AB-01-public-export-surface` | `0.721` | `0.965` | no action: public API size is intentional but real. Weight/baseline belongs to repo vector if accepted. |
| `TS-AB-02-unused-exports` | `1.000` | `1.000` | no action: baseline healthy. Earlier detached-worktree mismatch was caused by worktree/config shape, not a pack effect. |
| `TS-AB-03-type-indirection-depth` | `0.987` | `0.953` | no action: type-level indirection appears real and domain-specific. |
| `TS-AB-04-interface-implementation-ratio` | `0.763` | `0.754` | no action: single-implementation interfaces are real abstractions. Could be repo-vector weighted if accepted. |
| `TS-AB-05-generic-proliferation` | `0.969` | `0.999` | no action: Effect uses heavy generics, but findings are legitimate API complexity rather than parser confusion. |
| `TS-LD-01-cyclomatic-complexity` | `0.227` | `0.111` | existing pack action only: callback-context naming works and provides hundreds of decisions when active, but scores stay low because complexity is real. |
| `TS-LD-02-function-size-distribution` | `0.014` | `0.023` | no Effect-pack scoring action: biggest findings are real large functions/files. Some Effect repo findings are dtslint/generated-file taxonomy questions, which are broader taxonomy/config work rather than Effect semantics. |
| `TS-LD-03-nesting-depth` | `0.997` | `0.997` | no action: small residual findings. |
| `TS-LD-04-naming-conventions` | insufficient evidence | insufficient evidence | no action: requires repo conventions. |
| `TS-LD-05-domain-term-consistency` | insufficient evidence | insufficient evidence | no action: requires glossary. |
| `TS-LD-06-annotation-coverage` | `0.977` | `0.923` | no action: missing boundary annotations are TypeScript style/API policy, not Effect semantics. |
| `TS-LD-07-unsafe-type-erosion` | `0.005` | `0.087` | no action: unsafe `any` at boundaries appears real. Effect pack should not hide it. |
| `TS-SL-01-duplication` | `0.798` | `0.915` | no action: clone findings are real; existing generic signal already avoids small Effect.gen clone noise. |
| `TS-SL-02-inconsistent-clones` | `0.950` | `0.630` | no action: opencode divergent clone is concrete code duplication. |
| `TS-SL-03-suppressions` | `0.594` | `0.897` | no action for Effect pack: missing justifications are source facts. Existing generic rules already ignore dtslint/tst type-test suppressions by default. |
| `TS-SL-04-unfinished-implementations` | `0.974 -> 0.993` | `0.800` | pack action landed: prototype factory shells and `Object.assign(function() {}, Proto, ...)` are now intentional no-ops. opencode still has a real throw-not-implemented block. |
| `TS-RP-01-hotspots` | `1.000` | `1.000` | no action. |
| `TS-RP-02-pr-size` | not applicable | `0.905` | no action: current diff size, not Effect semantics. |

## Remaining future work

The remaining plausible improvements are not Effect-pack scoring changes from this pass:

- Taxonomy/config: generated API files and dtslint `.tst.ts` files appear in size/churn surfaces in the Effect repo. That should be handled by generic file taxonomy or repo-owned calibration, not by an Effect semantic pack unless we define an explicit Effect-repo-only module.
- Repo vector policy: public export surface, interface ratios, generic proliferation, and unsafe boundary `any` may be acceptable in Effect itself, but accepting them is a repo-level weighting/baseline decision.
- Pack loading ergonomics: neither target repo has `.pulsar/project-modules.json`, so the Effect pack is not active by default. This is correct under Pulsar's repo-owned invariant, but it is a usability gap if users expect detected technology packs to be suggested or bootstrapped.
