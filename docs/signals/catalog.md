# Signals

Every signal Pulsar 0.3.0 ships. `pulsar agent catalog .` prints the same list for your repository, with config schemas, defaults, and weights; `pulsar agent catalog . --signal <id>` shows one.

Pulsar ships **75 production signals** in three packs: 12 language-agnostic shared signals, 39 TypeScript signals, and 24 Rust signals. Each signal declares a **provability tier** that caps how strongly it can enforce:

- **Tier 1** — pure deterministic computation over code or git history (complexity, cycles, churn).
- **Tier 1.5** — compound: combines other signals' outputs (hotspots, suppression governance).
- **Tier 2** — computation plus reference data (manifests, glossaries, coverage reports).
- **Tier 3** — LLM-assisted judgment; soft warning only, never a hard gate. `TS-SL-07` is the one Tier 3 signal: it replays a saved model assessment offline, and only `pulsar agent judge` calls the model.

Tier honesty is enforced by contract tests: a signal that reads reference data cannot claim Tier 1.

## Shared (language-agnostic)

| Signal | What it measures |
|---|---|
| `SHARED-CHURN-01` recent-churn | Volume of recent git change activity per file |
| `SHARED-CHURN-02` recency-weighted-churn | Churn with recent changes weighted heavier |
| `SHARED-COCHANGE-01` logical-coupling | Files that repeatedly change together in the same commits |
| `SHARED-02` bus-factor | Concentration of authorship — knowledge-loss risk |
| `SHARED-03` churn-rate | Churn normalized as a per-period rate |
| `SHARED-05` suppression-governance | Cross-language rollup of lint/type suppression debt |
| `SHARED-06` pr-dependency-delta | Dependency changes introduced by a PR |
| `SHARED-07` machine-feedback-coverage | Whether build/typecheck/test/static-analysis feedback exists in scripts and CI |
| `SHARED-09` contract-freshness | Whether generated/contract artifacts are fresh relative to their sources |
| `SHARED-10` domain-construction-control | Whether domain values are built through validated constructors |
| `SHARED-11` theory-encoding-index | How much of the repo's "theory" (contracts, coverage, provenance) is machine-encoded |
| `SHARED-COV-01` coverage-facts | Grounded test-coverage facts from Istanbul/LCOV reports |

## TypeScript

| Signal | What it measures |
|---|---|
| `TS-AB-01` public-export-surface | Size and shape of a package's public exports |
| `TS-AB-02` unused-exports | Exported symbols unreachable from any entrypoint |
| `TS-AB-03` type-indirection-depth | Depth of type-alias / conditional-type chains |
| `TS-AB-04` interface-implementation-ratio | Over-abstraction pressure |
| `TS-AB-05` generic-proliferation | Excess generic parameters per declaration |
| `TS-AD-01` boundary-violations | Imports crossing declared module-boundary rules |
| `TS-AD-02` circular-dependencies | Import cycles (SCC detection) |
| `TS-AD-03` reexport-depth | Re-export chains between a symbol and its consumers |
| `TS-AD-04` boundary-parser-coverage | Whether inputs at declared boundaries pass through a validating parser |
| `TS-AD-05` boundary-trust-breach | Composite trust-boundary integrity (parsers, `any` erosion, violations) |
| `TS-BP-01` public-api-signature-diff | Public API signature changes vs. a base revision |
| `TS-CC-01` async-failure-control | Swallowed or log-and-forget async errors |
| `TS-CC-02` unbounded-concurrency | Concurrent fan-out without a bound |
| `TS-DE-01` type-level-coupling | Coupling through type-level references |
| `TS-DE-02` fan-in-fan-out | Module fan-in/fan-out in the import graph |
| `TS-DE-03` propagation-cost | How far a change propagates through dependents |
| `TS-DE-04` package-dependency-health | Dependency classification, usage, manifest alignment |
| `TS-DE-05` duplicate-dependency-versions | Multiple versions of the same dependency in the lockfile |
| `TS-LD-01` cyclomatic-complexity | Per-function cyclomatic complexity |
| `TS-LD-02` function-size-distribution | Function sizes against thresholds |
| `TS-LD-03` nesting-depth | Control-flow nesting depth |
| `TS-LD-04` naming-conventions | Identifier casing/naming consistency |
| `TS-LD-05` domain-term-consistency | Use of declared glossary terms in identifiers |
| `TS-LD-06` annotation-coverage | Explicit type annotations on functions/exports |
| `TS-LD-07` unsafe-type-erosion | `any`, casts, and unsafe assertions |
| `TS-LD-08` exhaustiveness-erosion | Non-exhaustive switches over unions |
| `TS-LD-09` error-channel-opacity | Hidden failure channels (throw/catch, rejections) |
| `TS-RP-01` hotspots | Files combining high complexity and high churn |
| `TS-RP-02` pr-size | PR diff size against review-size policy |
| `TS-SEC-01` dangerous-capability-surface | `eval`, child process, dynamic import, etc. |
| `TS-SEC-02` untrusted-boundary-sinks | Untrusted input reaching dangerous sinks unvalidated |
| `TS-SEC-03` secret-material | Hard-coded secrets in source |
| `TS-SL-01` duplication | Structural/token-level duplicated blocks |
| `TS-SL-02` inconsistent-clones | Duplicated blocks that have drifted apart |
| `TS-SL-03` suppressions | Lint/type suppression comments, with justification accounting |
| `TS-SL-04` unfinished-implementations | Empty/todo/no-op code presented as real |
| `TS-SL-05` phantom-tests | Tests that assert nothing meaningful |
| `TS-SL-06` confidence-claim-mismatch | Validator-named functions that don't deliver the claimed guarantee |
| `TS-SL-07` rule-ownership-alignment | Fit between the code and the ownership rules declared in `.pulsar/ownership.json` (not applicable without it) |

## Rust

| Signal | What it measures |
|---|---|
| `RS-AD-01` visibility-surface | Ratio of `pub` items — how much of the crate is exposed |
| `RS-AD-02` crate-boundaries | Imports crossing declared crate-boundary rules |
| `RS-AD-03` circular-crate-dependencies | Cycles in the Cargo dependency graph |
| `RS-AB-01` unused-public-items | Public items never used in the workspace |
| `RS-AB-02` trait-object-depth | `dyn` chaining/indirection depth |
| `RS-AB-03` generic-proliferation | Excess generic parameters per item |
| `RS-AB-04` derive-density | Density of derives, especially custom ones |
| `RS-DE-01` trait-coupling | Coupling via trait implementations |
| `RS-DE-02` dependency-tree | Shape/health of the Cargo dependency tree |
| `RS-DE-03` feature-flags | Feature-flag count and complexity |
| `RS-DE-04` fan-in-fan-out | Module fan-in/fan-out in the use graph |
| `RS-LD-01` unsafe-code | `unsafe` blocks/functions and their concentration |
| `RS-LD-02` lifetime-complexity | Lifetime annotation complexity |
| `RS-LD-03` match-catch-all | Catch-all match arms eroding exhaustiveness |
| `RS-LD-04` error-granularity | Coarse vs. typed error enums |
| `RS-LD-05` cyclomatic-complexity | Per-function cyclomatic complexity |
| `RS-LD-06` domain-term-consistency | Declared glossary terms in identifiers |
| `RS-SL-01` duplication | Token-level duplicated blocks |
| `RS-SL-02` suppressions | `#[allow]`/clippy suppression attributes |
| `RS-SL-03` unwrap-expect | `unwrap`/`expect` density — panic-on-error paths |
| `RS-SL-04` clone-abuse | Excessive `.clone()` masking ownership problems |
| `RS-RP-01` hotspots | Complexity × churn ranking |
| `RS-RP-02` compile-time | Crate compile-time pressure |
| `RS-RP-03` pr-size | PR diff size against review-size policy |

## Defaults

The default signal set is deliberately conventional: complexity, coupling, churn, boundary safety, ownership concentration, coverage facts, public API churn, and suppression debt are broadly reusable software-engineering evidence, not one maintainer's architecture taste.

Defaults follow the principle of least surprise. Pulsar does **not** assume your repo prefers tiny files everywhere, maximal DRY, or any other one-school style. Where a judgment is taste-laden, it ships with a calibration surface, a documented non-tunable rationale, or an enforcement ceiling that prevents overclaiming — never as hidden default behavior.

How a repository changes what these signals mean: [calibration](../calibration.md).
