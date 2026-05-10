# Pulsar self-score baseline

Date: 2026-05-10

Command:

```bash
bun packages/cli/src/bin.ts score --json .
```

Evidence file during capture: `/tmp/pulsar-self-score.json`.

Working tree note: this baseline was captured on the current worktree, which includes pre-existing package metadata and release-document changes. The PR-size score therefore reflects current uncommitted worktree surface, not only committed source quality.

## Summary

| Metric | Value |
| --- | ---: |
| Weighted mean | `0.713` |
| Readiness | `0.149` |
| Status | `blocked` |
| Hard gate | `fail` |
| Hard-gate violations | `13` |
| Worst signal | `TS-LD-02-function-size-distribution` |

## Non-max signal taxonomy

| Signal | Score | Main evidence | Classification | Next action |
| --- | ---: | --- | --- | --- |
| `TS-LD-02-function-size-distribution` | `0.149` | `ScoringEngineLayer` 335 LOC, `collectRustProjectFacts` 173 LOC, package-health compute 154 LOC, very large TS-SL-04/package-health/bisect/SDK files | real code issue | split large functions and files around real domain boundaries; do not tune this away |
| `TS-LD-07-unsafe-type-erosion` | `0.511` | boundary `any` in observer, runner, scoring engine layer factory, calibration processor aliases, project-module processor definitions, `AnySignal` | real code issue with possible type-modeling gaps | replace public `any` with typed generics/unknown/variance-safe contracts; only revise signal if TypeScript cannot represent a safe boundary |
| `TS-LD-01-cyclomatic-complexity` | `0.571` | `isIntentionalNoop`, Rust analysis callbacks, bisect report rendering, package-health analysis, production-file classifier | real code issue | extract decision tables and smaller classifiers; TS-SL-04 cleanup already reduced but did not solve this |
| `SHARED-02-bus-factor` | `0.650` | single-author corpus in last 180 days | repo/process policy or score stance | decide whether solo/pre-release repositories can declare an org-owned ownership policy; otherwise this cannot be fixed by code |
| `TS-AB-01-public-export-surface` | `0.703` | core exports 333 symbols, rs-pack 162, ts-pack 154, SDK 77 | real code issue | narrow public barrels, split internal exports, introduce explicit public/internal API surfaces |
| `TS-AB-04-interface-implementation-ratio` | `0.752` | many data-shape interfaces reported as dead interfaces, especially CLI/plugin DTOs | generic signal bug / scoring stance | distinguish object-shape contracts from OO implementation interfaces before using this as refactor pressure |
| `TS-RP-02-pr-size` | `0.783` | current dirty worktree: +171/-46 across 14 files, mostly package metadata and release docs | worktree hygiene | land or separate unrelated release/package changes; do not encode repo policy for this baseline |
| `SHARED-03-churn-rate` | `0.785` | recent churn in shared type/export analysis, churn signals, opencode plugin, Rust walker, module graph | score stance / temporal review-pain signal | decide how strict maximum-score workflow treats unavoidable active-development churn; code changes cannot immediately remove time-window pressure |
| `TS-LD-04-naming-conventions` | `0.936` | UPPER_SNAKE constants, PascalCase Effect Layer values/types in plugin and CLI | repo convention plus technology semantics | encode repo naming conventions and Effect Layer naming semantics explicitly; fix inconsistent names that remain |
| `TS-DE-01-type-level-coupling` | `0.967` | core `signal`, `observer`, `scoring-engine`, `time-series`, `errors`, `vector`, `runner` type hubs | real code issue | reduce central type coupling by splitting contracts and moving derived output shapes closer to owners |
| `TS-DE-05-duplicate-dependency-versions` | `0.981` | duplicate transitive versions for `effect`, `fast-check`, `pure-rand` | dependency hygiene or external runtime skew | inspect package graph; dedupe where possible, otherwise document unavoidable external skew with policy |
| `TS-AB-02-unused-exports` | `0.982` | internal-only exports from opencode plugin, bisect helpers, runtime helpers, shared-history helpers | real code issue | remove exports or route them through explicit internal/public API structure |
| `TS-LD-06-annotation-coverage` | `0.983` | missing boundary return annotations for plugin layer factories and CLI commands | real code issue | add explicit return types to boundary functions |
| `TS-AB-03-type-indirection-depth` | `0.990` | opencode plugin hook aliases resolving through `Parameters`/`NonNullable` indexed access chains | repo/API ergonomics or real code issue | simplify hook input/output aliases where possible; otherwise encode external hook-shape semantics through API role policy |
| `TS-LD-03-nesting-depth` | `0.998` | Tarjan visitors, export consumer indexing, `collectInto`, effective line counter | real code issue | flatten remaining high-nesting functions during refactor passes |

## Hard-gate violations

All current hard gates come from `TS-AD-01-boundary-violations`.

| Area | Evidence | Classification | Next action |
| --- | --- | --- | --- |
| opencode plugin imports core/packs | server files import `@skastr0/pulsar-core`, `@skastr0/pulsar-rs-pack`, `@skastr0/pulsar-shared-signals`, `@skastr0/pulsar-ts-pack` without allowlist coverage | repo reference-data gap unless plugin architecture is wrong | update repo conventions if the plugin is intended to embed Pulsar runtime; otherwise introduce a narrower runtime package |
| project modules import SDK/core | Convex and Effect modules import `@skastr0/pulsar-project-module-sdk`; SDK imports `@skastr0/pulsar-core` | repo reference-data gap or package-boundary design issue | allow project-module packages to depend on SDK/core in conventions, or split public contracts into a smaller package |

## Maximum-score implications

The current maximum-score path should not start with vector suppression. The first source changes should be:

1. Refactor size and complexity hotspots.
2. Remove public `any` from exported boundaries.
3. Narrow public export surfaces and internal-only exports.
4. Fix boundary package conventions so intended package dependencies are explicit.
5. Correct the interface-ratio signal so TypeScript data contracts are not treated as dead OO abstractions.
6. Decide product stance for temporal/process signals (`bus factor`, `churn`) because strict immediate `1.000` may require either elapsed time, team/process change, or explicit repo policy.

## Customization discipline

Legitimate repo customizations from this baseline are limited to cases where code changes would make the repo worse:

- package-boundary conventions for intended workspace dependencies;
- naming conventions for deliberate constants and Effect-style layer values;
- external runtime skew if dependency graph inspection proves it cannot be deduped safely;
- temporal/process policy for solo or active-development repository states.

Everything else should first be treated as a code fix or signal fix.
