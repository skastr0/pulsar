# Pulsar: agent-first feature map and adoption plan

> Historical audit, not the current implementation plan. The user clarified that signals, executable calibration and weights are the product foundation; surrounding workflows such as ratchets, bisect and personas are unproven product hypotheses. The implemented POC follows [the agent self-service guide](../agent-first.md): catalog → author repo policy → config → score → repair → verify. It does not add the plan/apply subsystem proposed below. Existing CLI workflows remain only for external compatibility pending an explicitly approved breaking transition. The audit receipts below describe the pre-POC checkout.

## Verdict and scope

Pulsar has a substantial analysis engine. The next product increment should make an agent able to discover, configure, run, explain, and maintain it without reading Pulsar's source. More signals are not the first constraint.

This is a source-backed inventory and proposed implementation plan, not a claim that the proposed version exists. Scan date: 2026-09-07. Inspected checkout: [f01b833](https://github.com/skastr0/pulsar/commit/f01b8339152f0e262eb61ea05e389f7d041060f1), workspace version 0.2.0. Registry publication and all-platform execution were not checked. Earlier adoption recommendations in the [project overview](https://ampcode.com/threads/T-01a06a04-438b-738d-b377-8580ab381cb9) are context, not user-approved product decisions; current claims below were checked again.

Proposed product promise: **Give any coding agent one repository-owned contract for finding consequential regressions, explaining the evidence, and verifying its repair.** The agent operates Pulsar; it does not get to redefine passing whenever its code fails.

Decisions proposed here: keep the existing engine and executable calibration SDK; make the CLI the canonical automation surface; make the TUI and any future harness adapters clients of the same operations; keep inspection configuration-free; require explicit authority for policy changes and debt acceptance. No new dependency, public protocol change, or scoring change is implemented by this document.

## Current feature inventory

“Implemented” means a reachable implementation was inspected, not that its accuracy or every deployment environment was validated.

| Capability | Implemented surface | Important limit / ownership |
| --- | --- | --- |
| Repository scoring | Full Observer, individual signals, category views, worktree changes, JSON, runtime profiling | Ordinary full scoring reports evidence; its successful process exit is not a passing quality gate. [Command](../../packages/cli/src/score.ts#L41-L218) |
| Change assessment | Two-dot revision or `WORKTREE` diff, introduced/resolved findings, changed-only guidance, diagnostic-projection churn, gate decision | Diff mode exits 2 for a blocking decision; cannot combine with baseline CI mode. [Diff](../../packages/cli/src/score-diff.ts#L94-L220) |
| Agent-oriented reporting | Diff trust routing, diagnostic/fix-hint records, visible/holdout signal metadata | `--agent-view` affects diff presentation; it is not a universal automation protocol or confidentiality boundary. JSON still includes full score output. [Projection](../../packages/cli/src/score-diff.ts#L110-L216) |
| CI ratcheting | Baseline set/show/refresh; new violation identities block; configuration fingerprint mismatch fails | Requires explicit baseline adoption. Effective CI assessment is separate from serialized Observer JSON. [Assessment](../../packages/cli/src/score-ci-assessment.ts), [baseline](../../packages/cli/src/baseline.ts) |
| Historical investigation | Per-signal/full-Observer bisect, category/signal scopes, sampling, first crossing, culprit ranking | Git history and reference quality constrain interpretation. [CLI](../../packages/cli/src/cli-core-commands.ts#L196-L283) |
| Longitudinal pressure | Persisted time series, backpressure and trend JSON/human output | Requires observations; not a harness that automatically enforces agent permissions. [Backpressure](../../packages/cli/src/backpressure.ts#L25-L75) |
| Onboarding | Real-engine TUI and headless scan; typed choices; actual before/after preview; configuration and explicit baseline persistence | No-answers headless mode is evidence-only. Existing primary artifacts redirect writes to a preview directory, not an in-place maintenance workflow. [Headless](../../packages/onboard/src/headless.ts), [persistence](../../packages/cli/src/onboard-persistence.ts#L433-L607) |
| Configuration | Shared repo/org vector, activation, weights, signal config, factor overrides, presets with provenance | Explicit path → repo vector → organization fallback → defaults. No personal or per-agent scoring layer. [Discovery](../../packages/cli/src/vector-discovery.ts), [resolution](../../packages/core/src/vector-resolution.ts) |
| Executable calibration | Typed processors and manifests for built-in, repo-local, workspace and package modules; source/config fingerprints | Code executes in-process. Provenance is not a sandbox. [SDK loader](../../packages/project-module-sdk/src/loader.ts), [manifest](../../packages/project-module-sdk/src/manifest.ts) |
| Framework adaptation | Effect, Convex, Next.js modules; runtime framework evidence; Next App Router conditional auto-activation | Onboarding's root-manifest detector differs from runtime detection. Next auto-activation requires high-confidence, non-conflicting evidence and respects explicit settings. [Runtime](../../packages/cli/src/runtime-calibration.ts#L39-L114), [onboarding](../../packages/cli/src/onboard.ts#L39-L98) |
| Reference-data maintenance | Glossary and conventions extract/confirm; author-alias configuration; calibration suggestions | Suggestions and drafts are not accepted policy. Suggestions expose commands, not a universal executable change plan. [Workflows](../../packages/cli/src/cli-workflow-commands.ts), [suggestions](../../packages/cli/src/calibrate-suggestions.ts) |
| Preference proposals | Persona list/show/apply/diff; elicitation quiz/bootstrap/review/accept/reject | Opt-in repo policy proposals, not an onboarding prerequisite or personal preference engine. [Workflows](../../packages/cli/src/cli-workflow-commands.ts#L177-L262) |
| Coverage evidence | LCOV/Istanbul ingestion and shared coverage-backed analysis | Ingests reports; does not itself establish that tests are adequate. [CLI](../../packages/cli/src/cli-core-commands.ts#L121-L165) |
| Trustworthy aggregation | Applicability-aware readiness; evidence/enforcement ceilings; per-signal diagnostics and factor attribution | “Unavailable”, “not applicable”, measured warnings, and structural gate failures must remain distinct. [Enforcement](../../packages/core/src/enforcement.ts), [JSON](../../packages/cli/src/score-json.ts) |
| Cache correctness | Persistent signal/Observer caches; config, signal semantics and calibration fingerprints | New score-affecting inputs must participate in existing fingerprints, not create a second caching path. [Observer cache](../../packages/core/src/scoring-engine-observer-cache.ts#L57-L157) |
| Delivery | Source CLI, standalone binaries, npm launcher; build identity and host artifact parity checks | macOS/Linux arm64/x64 targets; npm launcher declares Node ≥18. No Windows target. [Launcher](../../packages/npm/pulsar/bin/pulsar.js), [manifest](../../packages/npm/pulsar/package.json) |
| Agent integration assets | Prism working-methods plugin | Contributor/truth-pass methods, not a turnkey consumer setup/manage/check integration. [Plugin](../../prism-plugin/plugin.json). A production MCP server or enforcing harness hook was not found in the inspected command/package surface. |

### Registered signals: 74, not 74 universally applicable checks

Runtime imports confirmed **38 TypeScript + 24 Rust + 12 shared** signals. Language detection and applicability determine what a particular run measures. Names below describe registered detectors, not exhaustive guarantees such as whole-program security verification.

| Pack / family | Registered feature names |
| --- | --- |
| TypeScript architectural drift (5) | Module boundaries; circular dependencies; re-export depth; boundary parser coverage; boundary trust breach |
| TypeScript security / concurrency / API (6) | Dangerous capability surface; untrusted boundary sinks; secret material; async failure control; unbounded concurrency; public API signature diff |
| TypeScript dependencies (5) | Type-level coupling; fan-in/fan-out; propagation cost; package dependency health; duplicate dependency versions |
| TypeScript abstraction (5) | Public export surface; unused exports; type indirection; interface/implementation ratio; generic proliferation |
| TypeScript legibility (9) | Cyclomatic complexity; function-size distribution; nesting; naming conventions; domain terms; annotation coverage; unsafe type erosion; exhaustiveness erosion; error-channel opacity |
| TypeScript generated-code/review (8) | Duplication; inconsistent clones; suppressions; unfinished implementations; phantom tests; confidence-claim mismatch; hotspots; PR size |
| Rust architecture/dependencies (7) | Visibility; crate boundaries; crate cycles; trait coupling; dependency tree; feature flags; fan-in/fan-out |
| Rust abstraction (4) | Unused public items; trait-object depth; generic proliferation; derive density |
| Rust legibility (6) | Unsafe code; lifetime complexity; catch-all matches; error granularity; cyclomatic complexity; domain terms |
| Rust generated-code/review (7) | Duplication; suppressions; unwrap/expect; clone abuse; hotspots; compile time; PR size |
| Shared history/review (6) | Recent churn; recency-weighted churn; logical coupling; bus factor; churn rate; PR dependency delta |
| Shared contracts/evidence (6) | Suppression governance; machine-feedback coverage; contract freshness; domain-construction control; theory-encoding index; coverage facts |

Canonical IDs, defaults, tiers and enforcement remain owned by the [TypeScript registry](../../packages/ts-pack/src/pack.ts), [Rust registry](../../packages/rs-pack/src/pack.ts), and [shared registry](../../packages/shared-signals/src/pack.ts), not this snapshot. Their executable contract matrices are [TypeScript](../../packages/ts-pack/src/__tests__/signal-contracts.ts), [Rust](../../packages/rs-pack/src/__tests__/signal-contracts.ts), and [shared](../../packages/shared-signals/src/__tests__/signal-contracts.ts). Future user-facing catalogs should be generated from these definitions rather than manually maintained.

## Adoption blockers, ordered by consequence

| Priority | Observed fact | User consequence | Required change |
| --- | --- | --- | --- |
| P0: agent result contract | Full score JSON on Pulsar was 675,412 bytes. CI's missing-baseline reason went to stderr, not the JSON document. Ordinary score exited 0 with `hard_gate_status=fail`. | An agent needs bulky output plus command-specific interpretation to decide what happened. | One typed result contract with operation status, gate assessment, configuration identity, bounded actionable findings, incomplete-evidence status, and structured recovery. Full evidence stays available on demand. |
| P0: discoverable configuration | Headless output exposes pressure IDs/scores but no catalog, valid actions, schemas or detected-pack evidence. Answers require exact signal/option/action identity. | An agent must read source or invent inputs to configure safely. | Export applicable configuration schemas/actions from their definitions, including stable action IDs, defaults, limits, provenance and impact. |
| P0: safe maintenance | Answers trigger preview followed immediately by persistence. Existing artifacts cause preview-directory output and existing preview artifacts are refused. | No general inspect → review plan → apply → rerun workflow for an already-adopted repo. | Separate planning and application; deterministic patches against expected file hashes; repeat-safe application; explicit conflict/permission results. |
| P0: untrusted execution | Enabled non-builtin project modules are dynamically imported, and factories are invoked in-process. | “Just scan this PR” can execute repository-controlled code with scanner permissions. | Before import, enforce caller-granted trust. Untrusted CI uses trusted-base policy/modules and a constrained environment; report omitted evidence without claiming the same configured verdict. |
| P0: consumer CI | The [consumer workflow](../ci/github-actions.yml) invokes Pulsar's own source path in the adopting repo and pins Bun 1.2.0, below the workspace minimum. | The example is not a portable consumer installation. This workflow was inspected, not executed. | A pinned consumer binary/package example, explicit baseline setup, read-only permissions, adequate Git history and safe fork handling; execute it against a separate consumer fixture. |
| P1: coherent discovery | `score --help` prints global help; supported flag combinations and JSON support differ by command. `--ci --diff` fails. | Trial-and-error is part of integration. | Generated command help/capabilities, explicit mutation metadata, structured argument failures; document CI ratchet and diff assessment as distinct modes. |
| P1: consistent repo detection | Onboarding detects languages/frameworks from root manifests; scoring selects language packs from Git-visible files and runtime has a separate framework detector. | Monorepo setup and scoring can describe different scopes. | One repo-facts discovery service; every consumer declares the same assessment scope and reports activation evidence. |
| P1: distribution confidence | Host parity and clean local-tarball install checks exist; committed artifact CI runs on Ubuntu. Node minimum is 18 but artifact CI selects 24. | Built target is not the same as runtime-verified platform support. | Execute every advertised target/minimum runtime and the blessed public runner path; report unsupported libc/CPU/OS combinations honestly. |
| P1: demonstrated usefulness | Unit/fixture contracts exist; this scan did not establish external false-positive rates, successful autonomous setup, or latency SLOs. | Signal quantity cannot establish “no-brainer” value. | Frozen, diverse consumer repos with reviewed finding labels; measure first useful result, repeated-use cost, errors and operator interventions. |
| P1: self-adoption | Pulsar has a self-calibration module and conventions but no repo vector or baseline; its CI verifies the build/tests rather than its own ratchet. | The maintained setup/CI journey is not demonstrated here end to end. | Dogfood the same consumer path after finding review. Do not silently accept current failures as baseline merely to go green. |

“No blockers” is a direction, not a claim this audit can prove. Windows, hardened no-exec temporary storage, offline installation, unusual monorepos and unsupported languages need an explicit support decision or a useful failure path, not implied support.

## Target usage: one default loop, advanced controls behind it

The following interfaces are **proposed**, not currently runnable syntax. Keep existing `score`, `onboard`, and baseline concepts; do not add parallel `scan`, `check`, `init`, and `setup` engines.

| User intent | Proposed surface | Default behavior |
| --- | --- | --- |
| Is this environment supported? | `pulsar doctor --json` | Inspect prerequisites and trust requirements without importing repo modules or changing files. |
| What can Pulsar do here? | `pulsar capabilities --json` | Discover operations, schemas, installed signal/pack metadata, applicability prerequisites, mutation/authority requirements. |
| Give me useful findings now | `pulsar score --agent-view --json .` | A compact, evidence-first assessment on the full repo; no configuration interview required. |
| Set up or maintain repo policy | `pulsar onboard --plan --json .` | Produce a reviewable plan for only evidence-supported changes, existing-file patches and any necessary questions. Never auto-accept debt. |
| Apply an authorized plan | `pulsar onboard --apply <plan> --json .` | Validate scope, hashes and authority; apply exact changes; rerun and return receipts. Repeating an applied plan is a no-op. |
| Verify an agent's change | `pulsar score --diff HEAD..WORKTREE --agent-view --json .` | Explain introduced/resolved findings and blockers; distinguish whole-repo facts from changed-code guidance. |
| Enforce accepted policy in CI | `pulsar score --ci --json .` | Apply the committed baseline and trusted policy; put the effective decision and recovery reason in the result. |

The ordinary user learns **score → onboard when needed → verify changes**. Bisect, trends, coverage, elicitation and module authoring remain available, but do not become mandatory onboarding steps. The agent can orchestrate these operations using its existing tool access; a daemon, hosted account, LLM key and MCP server are not prerequisites for the proposed default path.

### Agent-managed does not mean agent-owned policy

Proposed authority classes should be explicit on each operation and plan item:

- **Inspect:** read evidence and use disposable local caches, subject to the caller's module-execution permissions.
- **Repair code:** the coding agent makes normal code edits under its existing task authority, then reruns the same checks. Pulsar does not pretend every diagnostic has a safe automatic fix.
- **Change interpretation:** adjusting weights, exclusions, module activation, references or enforcement-relevant thresholds requires repo-policy authority. Show exactly which findings become non-applicable or less severe and why.
- **Accept debt:** baseline creation/refresh is separate authority, never an automatic retry after a failure.
- **Publish/integrate:** installing hooks, changing CI, adding dependencies, or publishing changes remains an explicit integration action.

A team can delegate routine maintenance up front through repo-owned rules; requiring explicit authority need not mean prompting a human for every run. An agent may not grant itself permission by modifying the policy file that defines its authority. The trusted caller/base revision supplies that authority.

A score increase is not proof of repair. A verification receipt must name the code/evidence change under unchanged policy, or explicitly identify a policy change. Missing evidence must not become green; a baseline mismatch must not suggest an unreviewed automatic refresh.

### Deep configuration, shallow daily usage

Keep three distinct configuration concerns rather than flattening everything into one giant JSON file:

1. **Vector:** shared priorities, activation, parameters and references.
2. **Executable modules:** repo/framework/technology interpretation through the current typed SDK.
3. **Accepted debt/reference artifacts:** baseline, conventions, glossary and coverage facts with their own provenance and lifetimes.

Expose one *resolved view* across those artifacts: value, default, source, activation evidence, fingerprint, rationale and enforcement ceiling. Derive the view rather than persist another effective configuration. Reuse current schemas; validate all proposed values before scanning/writing, including contradictions between references and active packs.

Prefer automatic detection of conventional repo facts, not automatic adoption of architecture taste. Ask only for genuine repo intent that cannot be inferred from evidence. Generate action choices from a shared definition; retire duplicate onboarding action models and detector logic as callers move to the canonical service. Preserve published consumers deliberately rather than silently changing a known JSON contract; the external contract needs an explicit version/transition decision before implementation.

## Component design: extend existing owners, do not fork the engine

Paths marked “new” are proposed modules, not implemented files.

| Component | Ownership and implementation |
| --- | --- |
| Repository facts | New `packages/cli/src/repo-facts.ts`: unify facts currently split between [onboarding](../../packages/cli/src/onboard.ts) and [runtime framework detection](../../packages/cli/src/runtime-framework-detection.ts); keep IO at this boundary. |
| Automation result | New `packages/cli/src/command-result.ts`: Effect Schema codec for operation outcome, effective gate decision, findings, provenance and recovery. Reuse [Observer JSON](../../packages/cli/src/score-json.ts) and [CI assessment](../../packages/cli/src/score-ci-assessment.ts); do not recompute scores in serializers. |
| Configuration introspection | New `packages/cli/src/config-inspection.ts`: resolve current vector/modules and expose registry schemas/factors. [Vector resolution](../../packages/core/src/vector-resolution.ts) and [SDK](../../packages/project-module-sdk/src/definition.ts) stay authoritative. |
| Planning/application | New `packages/cli/src/onboard-plan.ts`: shared plan codec and state checks; consolidate [persistence](../../packages/cli/src/onboard-persistence.ts), [headless flow](../../packages/onboard/src/headless.ts), and [action validation](../../packages/onboard/src/actions.ts) around it. Plan carries source hashes, exact actions, expected effects, authority and verification command. |
| Execution trust | Extend [runtime calibration](../../packages/cli/src/runtime-calibration.ts) and [loader options](../../packages/project-module-sdk/src/loader-types.ts) with an explicit caller policy checked before [dynamic import](../../packages/project-module-sdk/src/loader.ts#L22-L74). No claim that a timeout alone sandboxes code. |
| CLI/TUI/adapters | [CLI dispatch](../../packages/cli/src/bin.ts) and [onboarding package](../../packages/onboard/src/index.ts) call the same services. A future harness/MCP adapter maps these operations; it owns no separate vector resolver, scoring engine or policy writer. |
| Consumer proof | Extend [release smoke](../../scripts/release-smoke.ts), [onboarding smoke](../../scripts/onboard-smoke.ts), and [CI example](../ci/github-actions.yml) with the full external-consumer journey. |

Use the installed Effect v4 conventions and existing registry/Schema/service boundaries. A plan file is an explicit reviewed artifact; derived resolved config is not. Application must reject stale hashes before writes, avoid partial success across artifacts, and verify after persistence. Crash recovery and concurrent apply need tests; the existing staged writes should not be described as a proven cross-file transactional store.

## Delivery sequence and acceptance gates

| Batch | Build | Demonstrable exit condition |
| --- | --- | --- |
| 1. Agent can read and act | Compact full/diff agent output; machine CI assessment and typed failures; capabilities/config discovery; command-scoped help | A source-unfamiliar agent discovers the API and explains one actionable finding using only CLI output. Success, invalid input, missing baseline, config mismatch and unavailable evidence all decode; stdout is exactly one JSON document. |
| 2. Agent can safely manage | Shared plan/apply with authority and expected hashes; unify facts/action schemas; add pre-import trust enforcement | Fresh and existing repos support plan → review → apply → verify. Reapply changes nothing; stale/concurrent plans fail without damage; debt and threshold changes cannot be silently approved. A malicious module fixture does not execute when trust is denied. |
| 3. Adoption works outside Pulsar | Pinned consumer quick start and CI workflow; minimum-runtime/platform execution; full install/setup/ratchet release smoke; Pulsar dogfood | A clean consumer repo, without Pulsar source, reaches useful output, accepted config and a passing baseline; a real introduced structural violation blocks and its repair passes under unchanged policy. Fork CI cannot run untrusted modules with privileged credentials. |
| 4. Earn repeat usage | External-repo finding review, measured cold/warm/diff budgets, bounded contextual explanations, thin harness integration where demanded | Evidence shows useful interventions with tolerable noise and cost across the declared support set. Unsupported cases produce actionable outcomes rather than silent omissions. |

Proposed measurable release targets, **not current performance claims**:

- Zero required configuration for a first inspection of a supported repository; no required quiz or API key.
- Compact result target ≤16 KiB excluding explicitly requested evidence pages; limits expose emitted counts, truncation and retrieval instructions, never an invented total.
- On a pinned Linux x64 reference runner and a fixed ≤1,000-source-file fixture: p95 ≤30 seconds cold scoring, ≤5 seconds unchanged warm scoring, ≤10 seconds a small-diff assessment. Measure first and revise support/budget explicitly if these targets prove unrealistic; large-repo budgets require their own fixtures.
- Fresh configuration requires at most one policy/debt review by default; subsequent authorized no-op maintenance requires none.
- Every advertised target executes the consumer smoke; unsupported platforms have tested errors and documented alternatives.
- At least five external design-partner repos complete setup and retain CI use for two weeks; ≥80% of the first five surfaced findings per repo are independently labeled actionable or useful calibration questions. Track those two labels separately so calibration work cannot masquerade as detected bugs; review all proposed hard blockers for false positives.

Do not block these batches on a marketplace, hosted dashboard, more personas, more signals, new language packs, autonomous refactoring, hidden-score security, or a new transport protocol. Add capability when a measured adoption failure requires it.

## Executed checks and limits

The initial tree was clean. All scan state was directed to disposable `/tmp` storage; no repo configuration or baseline was written. Quasar's `prism` executable was not available in this orb; the prior Amp overview was read instead of treating old recommendations as new decisions.

- `bun packages/cli/src/bin.ts --version` → `0.2.0`.
- `bun run dev score --help` → global help, confirming no command-specific help selection. The dev shim built workspace outputs and emitted Effect warnings/suggestions; this was not a clean full verification run.
- `PULSAR_STATE_HOME=/tmp/pulsar-agent-audit/state bun packages/cli/src/bin.ts score --json --no-progress .` → exit 0, valid JSON, 675,412 bytes, `hard_gate_status: fail`, 48 signal diagnostic entries, 33 applicable, 15 ignored and zero failed signals in readiness aggregation. Readiness was `blocked`/red. This is observed evidence under built-in vector defaults **plus the repo's existing calibration module**, not an uncalibrated generic-default benchmark or a maintainer-confirmed defect count.
- `PULSAR_STATE_HOME=/tmp/pulsar-agent-audit/state bun packages/cli/src/bin.ts onboard --agent .` → exit 0, `mode: preview-only`, `written: []`, baseline `not-provided`. Output had 50 `activeSignals` and no catalog/schema fields. Onboarding and score counts are not interchangeable: their observation entry points/scopes differ; this scan did not establish identical inputs between them.
- `PULSAR_STATE_HOME=/tmp/pulsar-agent-audit/state bun packages/cli/src/bin.ts score --ci --json --no-progress .` → exit 2; stderr explicitly reported `reason=missing-baseline current=14`. JSON contained Observer gate findings but no `ci_assessment` field.
- `bun packages/cli/src/bin.ts score --ci --diff HEAD..WORKTREE --json --no-progress .` → exit 1, zero stdout bytes, text error `--diff cannot be combined with --ci`.
- Direct imports of the three production registries → 38/24/12 entries. Signal correctness was not exhaustively re-audited.

Focused verification command:

```bash
env GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=commit.gpgsign GIT_CONFIG_VALUE_0=false \
  bun test packages/cli/src/__tests__/onboard-cli.test.ts \
  packages/cli/src/__tests__/onboard-persistence.test.ts \
  packages/cli/src/__tests__/score.test.ts \
  scripts/__tests__/release-contracts.test.ts \
  scripts/__tests__/release-preflight.test.ts
```

Result: **104 pass, 0 fail, 574 assertions, five files, 123.06 seconds**. The command-local signing override is the repository's existing test convention. Full `bun run verify`, published-package installation, cross-platform smokes, empirical finding accuracy and visual/TUI behavior were not verified in this scan. No runtime or UI implementation was changed.
