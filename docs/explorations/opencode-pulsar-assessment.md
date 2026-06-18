# Pulsar on OpenCode — Deep Assessment

**Date:** 2026-06-13  
**Pulsar CLI:** v0.1.4 (`packages/cli/src/bin.ts`)  
**Target repo:** `/Users/guilhermecastro/Playground/opencode`  
**Target SHA:** `dbbe67f066fef47761c637624a34b2350cb109c0`  
**Vector used:** built-in defaults (no repo-local `.pulsar/vector.json`, no project modules)  
**AI mode:** inactive

## 1. Executive summary

Running Pulsar with default settings on OpenCode (a production-grade TypeScript / Effect / SolidJS Start monorepo) produces a **red readiness score (0.00)** with an evidence mean of **0.44**. The single biggest driver is `TS-AD-04-boundary-parser-coverage`, which zeros the `architectural-drift` category and, because of Pulsar’s pressure-pnorm-local-max aggregation, pulls the whole readiness band down.

After manually triangulating diagnostics against source code, a large share of the pressure is **not a code-quality failure** but a **calibration gap**: Pulsar’s generic defaults do not yet understand SolidJS Start `APIEvent` handlers, Effect error-refinement helpers, SST secret declarations, or v1→v2 UI migration clones. In a repo that adopted Pulsar and wrote a modest project module, several of the zero/score would move from red to yellow/green without touching OpenCode’s source.

The remaining findings are real and actionable: oversized components, unvalidated JSON body casts, a debug CLI that `new Function`s user input, high-churn complexity centers, and a meaningful set of `ts-ignore` / unfinished-implementation suppressions.

**Bottom line:** Pulsar’s *mechanism* is sound and would be valuable day-to-day, but its out-of-box **generic calibration is too coarse for Effect/SolidJS/SST monorepos**. For a mission-critical codebase, Pulsar is suitable only after an explicit calibration investment (project modules, conventions, glossary, baseline). That investment is well-supported by the CLI; the risk is that teams will interpret default red scores as ground truth rather than as uncalibrated evidence.

## 2. Methodology

1. Ran `pulsar score .` and `pulsar score --json .` for the full Observer output.
2. Ran single-signal mode for the nine lowest-scoring signals.
3. Ran every category in human mode.
4. Ran `pulsar calibrate suggest .` and `pulsar backpressure .`.
5. Read the source of the key TypeScript signals (`ts-ad-04`, `ts-ld-09`, `ts-cc-01`, `ts-ld-02`, `ts-de-04`) to understand detection heuristics.
6. Manually inspected the OpenCode files referenced in diagnostics to separate true positives from framework/calibration false positives.
7. Catalogued all TS-pack, RS-pack, and shared signals by reading `packages/*/src/signals` and `packages/*/src/pack.ts`.

All commands used `bun` per the project’s tooling constraint.

## 3. OpenCode scorecard

| Category | Score | Lowest signal | Notes |
|---|---|---|---|
| architectural-drift | **0.00** | TS-AD-04 (0.00) | Heavily poisoned by SolidJS Start route handlers |
| concurrency-safety | **0.02** | TS-CC-01 (0.02) | Flags idiomatic SolidJS lazy-dialog `void import(...)` |
| security-risk | **0.11** | TS-SEC-02 (0.11) | Real sinks + framework routing false positives |
| legibility-decay | **0.18** | TS-LD-02 (0.04) | Real oversized functions + Effect opacity misreads |
| review-pain | **0.42** | TS-RP-01 (0.27) | `provider.ts` and `transform.ts` are genuine hotspots |
| generated-slop | **0.64** | TS-SL-02 (0.44) | v1/v2 settings clones dominate |
| abstraction-bloat | **0.73** | TS-AB-04 (0.60) | Interface/impl ratio in UI packages |
| dependency-entropy | **0.93** | TS-DE-02 (0.91) | Healthy package graph |
| behavior-preservation | **1.00** | — | No baseline diff configured |
| **Readiness** | **0.00 / red** | — | Evidence mean 0.44, hard gate PASS |

### Top pressure signals

1. `TS-AD-04-boundary-parser-coverage` — 0.00 (poison authority)
2. `TS-CC-01-async-failure-control` — 0.018
3. `TS-LD-02-function-size-distribution` — 0.037
4. `TS-LD-09-error-channel-opacity` — 0.040
5. `TS-LD-07-unsafe-type-erosion` — 0.042

## 4. What Pulsar gets right (product strengths)

- **Deterministic, cacheable scoring.** The CLI prints SHA, vector source, calibration fingerprint, and cache contributors. Re-running produces identical numbers.
- **Clear separation of concerns.** Signals produce evidence; the vector weights it; pressure math shapes the final band. This makes calibration traceable.
- **Rich CLI surface.** `score`, `baseline`, `backpressure`, `bisect`, `calibrate suggest`, `persona`, `elicit`, `glossary`, `conventions`, and `coverage ingest` give a team multiple levers for improvement rather than a single vanity number.
- **Project-module architecture.** Calibration is meant to live in typed Effect modules (`.pulsar/modules/*.ts`) referenced by `.pulsar/project-modules.json`, not hidden inside signal source. This aligns with Pulsar’s stated invariant that taste must be repo-owned and attributable.
- **Composite signals.** `TS-RP-01` (churn × complexity), `TS-AD-05` (boundary trust composite), and `SHARED-11` (theory-encoding index) show how primitive evidence can be composed into higher-level pressures.
- **Trust-boundary UX.** The CLI explicitly says when it is using built-in defaults and warns that the home-directory vector is only an organization fallback. This prevents the “personal score” anti-pattern.

## 5. Product frictions and UX gaps

| Issue | Evidence | Impact |
|---|---|---|
| **Framework mis-detection** | Reports `nextjs-app-router low detected-inactive` for a SolidJS Start repo | Undermines confidence; means boundary heuristics are tuned for the wrong framework |
| **JSON has no diagnostics** | `pulsar score --json .` emits scores/factors but not the per-signal diagnostic list | Hard to build automated triage / CI dashboards on top of JSON |
| **`--diff` cannot be combined with `--category`** | Help text and experiments show `--diff` is observer-only | Category-level diff workflow is missing |
| **Backpressure default is confusing** | First run reports `yellow score=1.00 slope=0.000` because no time series exists | A user sees yellow 1.00 while categories are red; data is buried |
| **Single-signal output is capped** | `top_n_diagnostics` defaults hide the full picture (e.g. only 10 of many boundary findings) | Hard to assess false-positive rate from CLI alone |
| **`--signal` JSON unavailable** | Cannot get machine-readable diagnostics for one signal | Forces brittle parsing of human output |

## 6. Category findings — real vs calibration-driven

### 6.1 architectural-drift (0.00)

**Signal:** `TS-AD-04-boundary-parser-coverage`

OpenCode uses SolidJS Start server routes. Every route exports a `GET`/`POST` function whose parameter is typed `APIEvent` from `@solidjs/start/server`. Pulsar sees a request-like parameter with no parser call directly on that parameter and flags it.

**Real finding:**

```ts
// packages/console/app/src/routes/api/enterprise.ts:61
export async function POST(event: APIEvent) {
  const body = (await event.request.json()) as EnterpriseFormData
  // ...
}
```

The `as EnterpriseFormData` cast is a genuine unsafe boundary.

**Calibration false positive:**

```ts
// packages/console/app/src/routes/honeycomb/webhook.ts:77
export async function POST(input: APIEvent) {
  const body = await input.request.json()
  const parsed = honeycombWebhookPayload.safeParse(body)
  // ...
}
```

The body *is* parsed with Zod, but the parser is invoked on a local `body` variable, not on the weak parameter `input`. `TS-AD-04` only looks for parser-call arguments that directly reference the weak parameter name, so it misses the alias. This is a signal limitation, not a code defect.

**Other SolidJS auth routes** (`authorize.ts`, `logout.ts`, `status.ts`, `[...callback].ts`) are GET handlers that read cookies/query via helper functions; Pulsar cannot see that validation happens in those helpers because it does not perform interprocedural data-flow analysis. A SolidJS Start project module could mark `APIEvent` as a recognized boundary type and exempt read-only cookie helpers.

**Signal:** `TS-AD-05-boundary-trust-breach` (0.35)

This composite combines `TS-AD-04`, `TS-LD-07`, `TS-AD-01`, and `TS-LD-05`. Its pressure largely inherits the `TS-AD-04` calibration gap, so it improves automatically once `TS-AD-04` is calibrated.

### 6.2 concurrency-safety (0.02)

**Signal:** `TS-CC-01-async-failure-control`

Pulsar flags `void import(...).then(...)` patterns as “fire-and-forget.” In SolidJS this is the standard lazy-dialog pattern:

```ts
// packages/app/src/components/dialog-connect-provider.tsx:27
const all = () => {
  void import("./dialog-select-provider").then((x) => {
    dialog.show(() => <x.DialogSelectProvider />)
  })
}
```

A SolidJS project module could classify `void import(...).then(...)` inside event handlers as an intentional detached UI transition, or the signal could learn that `void` on a dynamic import in a component event handler is not the same as a floating `fetch`.

The `empty-catch` at `github/index.ts:284` may be defensible teardown code, but it is worth reviewing.

### 6.3 security-risk (0.11)

**Signal:** `TS-SEC-01-dangerous-capability-surface` (0.33)

Real: the debug CLI evaluates arbitrary `--params` with `new Function`:

```ts
// packages/opencode/src/cli/cmd/debug/agent.handler.ts:105
const parsed = iife(() => {
  try {
    return JSON.parse(trimmed)
  } catch (jsonError) {
    try {
      return new Function(`return (${trimmed})`)()
    } catch (evalError) { ... }
  }
})
```

This is exactly the kind of surface a security signal should surface.

**Signal:** `TS-SEC-03-secret-material` (0.60)

Flags `infra/secret.ts` because it contains string literals like `"R2SecretKey"` and `new sst.Secret(...)`. SST’s secret declarations are not committed secrets; they are infrastructure handles. This is a framework-calibration gap.

### 6.4 legibility-decay (0.18)

**Signal:** `TS-LD-02-function-size-distribution` (0.04)

Genuine outliers:

| Function | File | LOC |
|---|---|---|
| `PrivacyPolicy` | `packages/console/app/src/routes/legal/privacy-policy/index.tsx` | 1337 |
| `Home` | `packages/console/app/src/routes/index.tsx` | 782 |
| `PromptInput` | `packages/app/src/components/prompt-input.tsx` | 581 |
| `getSyntaxRules` | `packages/tui/src/theme/index.ts` | 502 |
| `TermsOfService` | `packages/console/app/src/routes/legal/terms-of-service/index.tsx` | 456 |

These are real review hotspots. The legal pages are likely generated content; a project module could tag them as `integration` or `content` and relax the policy, but the default finding is accurate.

**Signal:** `TS-LD-09-error-channel-opacity` (0.04)

Flags `refineRejection` in `packages/opencode/src/effect/promise.ts` as “Effect operation hides expected exception type in boundary `refineRejection`.” The function is a *typed* error-refinement helper:

```ts
export function refineRejection<A, E>(
  evaluate: (signal: AbortSignal) => PromiseLike<A>,
  refine: (cause: unknown) => E | undefined,
) {
  return Effect.tryPromise(evaluate).pipe(
    Effect.catch((error) => {
      const cause = Cause.isUnknownError(error) ? error.cause : error
      const refined = refine(cause)
      if (refined !== undefined) return Effect.fail(refined)
      return Effect.die(cause)
    }),
  )
}
```

This is an Effect idiom, not opacity. A project module for Effect could deweight `refineRejection`-shaped boundaries.

**Signal:** `TS-LD-07-unsafe-type-erosion` (0.04)

Many findings are in `packages/console/app/src/routes/zen/util/provider/*.ts`, where provider adapters use `any` for raw request/response bodies against third-party SDKs. These are legitimate adapter boundaries, but the lack of schemas is a real maintainability risk. Some `any`s are unavoidable; some could be `unknown` + `Schema.decodeUnknown`.

### 6.5 review-pain (0.42)

**Signal:** `TS-RP-01-hotspots` (0.27)

The top hotspots are credible churn/complexity centers:

| File | Churn | Complexity |
|---|---|---|
| `packages/opencode/src/provider/provider.ts` | 20 | 142 |
| `packages/opencode/src/provider/transform.ts` | 20 | 67 |
| `packages/opencode/src/session/prompt.ts` | 19 | 36 |
| `packages/opencode/src/session/processor.ts` | 12 | 76 |
| `packages/opencode/src/session/compaction.ts` | 10 | 38 |

These are the core LLM-provider/session-orchestration files. The signal correctly identifies where review attention should go.

### 6.6 generated-slop (0.64)

**Signal:** `TS-SL-02-inconsistent-clones` (0.44)

Top findings are `settings-general.tsx` vs `settings-v2/general.tsx` — a v1→v2 migration in progress. This is exactly the kind of temporary duplication Pulsar should surface, but it should not be read as slop without context. A project module could mark migration clones as `exclude` with a rule.

**Signal:** `TS-SL-03-suppressions` (0.93)

A handful of `ts-ignore` / `ts-expect-error` remain. Most look like deliberate adapter workarounds; a few may be hiding real type debt.

### 6.7 dependency-entropy (0.93)

**Signal:** `TS-DE-04-package-dependency-health` (0.93)

Healthy overall. Some findings are real but noisy:
- Missing dependency in `@opencode-ai/enterprise` for `@opencode-ai/sdk` — worth fixing.
- “Production code imports devDependency” for `sst` in infra/api files — SST is used at deploy/bundle time; this is a package-classification calibration gap.
- Long lists of “unused declared dependencies” are often platform-specific optional deps or peer deps that the static import scanner cannot see.

## 7. Calibration gaps that dominate the score

1. **SolidJS Start boundary detection.** `APIEvent` handlers are recognized as request-like only through substring matching (`APIEvent` contains `Event`). The signal does not know that SolidJS Start routes parse params/cookies via framework helpers, so many GET routes are flagged as unvalidated.
2. **Effect error-channel idioms.** `refineRejection`, `Effect.catch`, and `Effect.tryPromise` are interpreted as opaque channels. An Effect project module should teach `TS-LD-09` that `Effect` failures are typed and that refinement helpers are explicit error channels.
3. **SST secret infrastructure.** `TS-SEC-03` sees `new sst.Secret(...)` and `new random.RandomPassword(...)` as committed secrets. A project module (or framework calibration) should classify SST/Pulumi resource constructors as safe.
4. **Dynamic import in event handlers.** `TS-CC-01` treats `void import(...).then(...)` as fire-and-forget, but in SolidJS this is the canonical lazy-dialog pattern.
5. **v1/v2 migration clones.** `TS-SL-02` flags old/new settings components as divergent clones. Without repo context the finding is correct; with a migration rule it can be deweighted.
6. **Bounded concurrency.** `TS-CC-02` flags `Promise.all` even when the array is bounded. The signal could benefit from a calibration rule for known bounded fanouts.

## 8. Proposed new signals for Effect / SolidJS / AI-SDK monorepos

| ID | Category | What it measures | Why it matters for OpenCode |
|---|---|---|---|
| `TS-AD-06` | architectural-drift | Effect Layer fan-in / service-mesh complexity | `session/prompt.ts` yields ~27 services; high fan-in is a maintainability signal |
| `TS-AD-07` | architectural-drift / security-risk | OpenAPI / runtime schema drift between AI SDK tool schemas and consumed types | Many tool schemas are built from `jsonSchema`; drift between schema and runtime use is risky |
| `TS-LD-10` | legibility-decay | Effect error-channel explicitness (per-function typed-error coverage) | Complement to `TS-LD-09`; rewards `Effect<A, E>` over `Effect<A, never>` or untyped throws |
| `TS-SL-07` | generated-slop | Generated SDK / contract staleness | `ai-sdk` provider wrappers and internal generated clients can drift from source |
| `TS-CC-03` | concurrency-safety / legibility-decay | Reactive state mutation discipline (SolidJS stores vs direct signal mutation) | Catches mutation outside `produce` / `setStore` in complex components |

## 9. Recommendations for Pulsar

1. **Add framework calibration for SolidJS Start.** Extend `REQUEST_LIKE_TYPE_NAMES` and boundary heuristics, or ship a `pulsar-project-module-solidjs-start` module.
2. **Ship `pulsar-project-module-effect`.** Teach `TS-LD-09`, `TS-CC-01`, and `TS-AD-04` to recognize Effect error channels, dynamic-import UI patterns, and typed refinement helpers.
3. **Improve parser-evidence data flow.** `TS-AD-04` should follow one-hop local aliases (`const body = await input.request.json(); schema.safeParse(body)`). This removes the honeycomb-webhook false positive without calibration.
4. **Add JSON diagnostics to single-signal/category output.** Machine-readable diagnostics are essential for CI and agent workflows.
5. **Support `--diff --category <name>`.** Category-level diff is a common review-time need.
6. **Make backpressure first-run semantics clearer.** When no time series exists, report `unknown / awaiting baseline` instead of `yellow 1.00`.
7. **Document the calibration-first onboarding path.** `calibrate suggest` already does this; the default score output should emphasize that built-in defaults are uncalibrated evidence, not a final verdict.

## 10. Answers to the original questions

**“Would you use Pulsar day to day for coding?”**

Yes, after calibration. The CLI is fast, deterministic, and surfaces real hotspots. But I would not trust the default red band until the repo has a `.pulsar/vector.json` and at least one project module for its frameworks.

**“How suitable is Pulsar for a serious, mission-critical TypeScript codebase with dozens of squads?”**

Suitable, but with caveats:
- **Pros:** Deterministic scoring, strong cache/attribution model, calibration architecture, composite signals, baseline/backpressure/bisect for long-term trend management.
- **Cons:** Out-of-box defaults are too coarse for modern framework stacks; false positives can erode trust if teams are not calibrated; some UX gaps (JSON diagnostics, diff/category combos) make automation harder.
- **Requirement:** A central platform team must own `.pulsar/vector.json`, project modules, conventions, glossary, and baseline. Without that, Pulsar risks becoming noise.

## 11. Appendix A — commands run

```bash
# Full observer
cd /Users/guilhermecastro/Playground/opencode
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --json . > opencode-pulsar-default.json

# Single signals
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --signal TS-AD-04 .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --signal TS-LD-02 .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --signal TS-LD-09 .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --signal TS-LD-07 .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --signal TS-CC-01 .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --signal TS-RP-01 .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --signal TS-DE-04 .

# Categories and calibration
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts score --category architectural-drift .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts calibrate suggest .
bun /Users/guilhermecastro/Projects/pulsar/packages/cli/src/bin.ts backpressure .
```

## 12. Appendix B — TypeScript signal inventory

Extracted from `packages/ts-pack/src/signals`:

| ID | Name | Category |
|---|---|---|
| TS-LD-01 | Cyclomatic complexity | legibility-decay |
| TS-LD-02 | Function size distribution | legibility-decay |
| TS-LD-03 | Nesting depth | legibility-decay |
| TS-LD-04 | Naming convention consistency | legibility-decay |
| TS-LD-05 | Domain term consistency | legibility-decay |
| TS-LD-06 | Type annotation coverage | legibility-decay |
| TS-LD-07 | Unsafe type erosion | legibility-decay |
| TS-LD-08 | Exhaustiveness erosion | legibility-decay |
| TS-LD-09 | Error channel opacity | legibility-decay |
| TS-AD-01 | Module boundary violations | architectural-drift |
| TS-AD-02 | Circular dependencies | architectural-drift |
| TS-AD-03 | Re-export depth | architectural-drift |
| TS-AD-04 | Boundary parser coverage | architectural-drift |
| TS-AD-05 | Boundary trust breach | architectural-drift |
| TS-SEC-01 | Dangerous capability surface | security-risk |
| TS-SEC-02 | Untrusted boundary sinks | security-risk |
| TS-SEC-03 | Secret material | security-risk |
| TS-CC-01 | Async failure control | concurrency-safety |
| TS-CC-02 | Unbounded concurrency | concurrency-safety |
| TS-BP-01 | Public API signature diff | behavior-preservation |
| TS-DE-01 | Type-level coupling | dependency-entropy |
| TS-DE-02 | Fan-in/fan-out | dependency-entropy |
| TS-DE-03 | Propagation cost | dependency-entropy |
| TS-DE-04 | Package dependency health | dependency-entropy |
| TS-DE-05 | Duplicate dependency versions | dependency-entropy |
| TS-AB-01 | Public export surface | abstraction-bloat |
| TS-AB-02 | Unused exports reachability | abstraction-bloat |
| TS-AB-03 | Type indirection depth | abstraction-bloat |
| TS-AB-04 | Interface/implementation ratio | abstraction-bloat |
| TS-AB-05 | Generic proliferation | abstraction-bloat |
| TS-RP-01 | Hotspots | review-pain |
| TS-RP-02 | PR size | review-pain |
| TS-SL-01 | Duplication | generated-slop |
| TS-SL-02 | Inconsistent clones | generated-slop |
| TS-SL-03 | Suppressions | generated-slop |
| TS-SL-04 | Unfinished implementations | generated-slop |
| TS-SL-05 | Phantom tests | generated-slop |
| TS-SL-06 | Confidence claim mismatch | generated-slop |

Shared and Rust signal inventories are available in the full agent output at `agent-svl2zzgc/output.log`.
