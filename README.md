# Pulsar

Pulsar measures repository health with deterministic, inspectable signals — and lets your repository decide what those signals mean.

> **Status: experimental.** Usable for inspection and local scoring. Signal semantics, scoring bands, and package boundaries may change before a stable public API is declared.

## What is Pulsar?

Pulsar reads your repository — code, git history, manifests, coverage reports — and produces a health score built from grounded evidence. Every finding cites real files and lines. Every score can be explained, reproduced, cached, and diffed.

Three properties define it:

- **Deterministic.** Same repo, same policy, same score. Signals are computations over code and history, not model opinions.
- **Inspectable.** Every score decomposes into named signals, findings, and the evidence behind them. Nothing is a black box.
- **Programmable.** Your repository owns its scoring policy — an explicit, diffable, committed `.pulsar/vector.json`, plus optional executable calibration modules.

## Why Pulsar?

Code review by vibes doesn't scale, and generic linters can't tell the difference between a problem and a deliberate choice. Pulsar is built for the gap in between:

- **Harder to game.** Scores come from structural evidence — complexity, coupling, churn, boundary safety — not from metrics that are easy to inflate.
- **One policy per repo.** Everyone working in a repository shares that repository's Pulsar policy. Divergent per-person scoring would make the whole system theater.
- **Built for agents.** Pulsar's primary interface is a JSON-first CLI designed to be driven by AI coding agents: discover the policy, write code against it, verify the repair — all without a human in the loop.

## Quick start

```bash
npx @skastr0/pulsar agent score .
```

No account, no LLM key, no config required — Pulsar scores your repo against generic defaults and prints one JSON report. The published npm release (0.2.x) includes the full agent-first workflow:

```bash
npx @skastr0/pulsar agent catalog .   # discover signals, weights, calibration slots
npx @skastr0/pulsar agent score .     # assess
```

Install options:

| Channel | Command |
|---|---|
| npm runner (Node ≥ 18, macOS/Linux, arm64/x64) | `npx @skastr0/pulsar` / `bunx @skastr0/pulsar` |
| Standalone binary from source | `bun run build:cli && bun run install:local` |
| Dev from checkout | `bun install --frozen-lockfile && bun run dev agent score .` |

## The signals

Pulsar ships **74 production signals** in three packs: 12 language-agnostic shared signals, 38 TypeScript signals, and 24 Rust signals. Each signal declares a **provability tier** that caps how strongly it can enforce:

- **Tier 1** — pure deterministic computation over code or git history (complexity, cycles, churn).
- **Tier 1.5** — compound: combines other signals' outputs (hotspots, suppression governance).
- **Tier 2** — computation plus reference data (manifests, glossaries, coverage reports).
- **Tier 3** — reserved for LLM-assisted judgment; soft warning only, never a hard gate. No production signal uses it today.

Tier honesty is enforced by contract tests: a signal that reads reference data cannot claim Tier 1.

### Shared (language-agnostic)

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

### TypeScript

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

### Rust

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

## Why these signals?

The default signal set is deliberately conventional: complexity, coupling, churn, boundary safety, ownership concentration, coverage facts, public API churn, and suppression debt are broadly reusable software-engineering evidence, not one maintainer's architecture taste.

Defaults follow the principle of least surprise. Pulsar does **not** assume your repo prefers tiny files everywhere, maximal DRY, or any other one-school style. Where a judgment is taste-laden, it ships with a calibration surface, a documented non-tunable rationale, or an enforcement ceiling that prevents overclaiming — never as hidden default behavior.

## Why calibration?

Generic evidence needs local interpretation. A 600-line integration file is a liability in one architecture and the intended seam in another; a solo maintainer's bus factor of 1 is a fact, not a fixable defect. Calibration is how a repository says what the evidence *means* — explicitly, in files it owns and commits.

The rules that keep calibration honest:

- **Repo-level, always.** `.pulsar/vector.json` in the repo is the source of truth. A home-directory vector is only an organization-standard fallback, and CLI output labels it as such. There is no personal Pulsar vector.
- **Explicit, not hidden.** Score-affecting rules carry rule IDs, sources, activation evidence, and fingerprints. A policy change always shows up as a policy change.
- **Presets are templates, not policy.** A preset does nothing until it is applied to a repo-owned vector.
- **Opinionated distributions are opt-in.** Pulsar's own repo dogfoods a strong self-calibration (`.pulsar/modules/pulsar-self.ts`); that proves the customization model without defining the out-of-box ideal.

See [Defaults vs Programmable Taste](docs/explorations/defaults-vs-programmable-taste.md) for the full design boundary.

## How to calibrate

Zero calibration is required — the defaults work out of the box. When you want the scores to reflect your repo's actual priorities:

**1. Discover what's tunable.** Don't guess config keys; read the real schemas:

```bash
pulsar agent catalog .                              # every signal, weight, and slot
pulsar agent catalog . --signal TS-SL-04            # one signal's config schema
pulsar agent catalog . --slot typescript.size-policy # one calibration slot's typed contract
```

**2. Weight the vector.** Create `.pulsar/vector.json` — or start from a preset:

```bash
pulsar persona list                                  # shipped templates
pulsar persona apply strict-type-safety --to ./.pulsar/vector.json
```

A vector override is `{ active?, weight?, config? }` per signal ID. Weights are 0–2 (relative contribution, not confidence); unknown keys and invalid weights are load-time errors, not silent fixes. Shipped presets: `velocity-first`, `refactor-friendly`, `security-paranoid`, `strict-type-safety`, `domain-purist`, `ai-slop-defense` — each labeled `workflow-risk`, `technology-practice`, or `architecture-taste` so you know what kind of judgment you're adopting.

**3. Add executable calibration (optional).** When weights aren't enough, a **project module** attaches deterministic TypeScript/Effect processors to typed calibration slots (file classification, size policy, clone policy, boundary trust, mixer policy…). Write `.pulsar/modules/<name>.ts` with the [project-module SDK](docs/project-modules.md), register it in `.pulsar/project-modules.json`, and validate with `pulsar agent config --trust-project-code`. Trust is explicit permission to execute the repo's calibration code in-process — it is not a sandbox, so inspect the code first. Ready-made examples: `@skastr0/pulsar-project-module-effect` and `@skastr0/pulsar-project-module-convex`.

**4. Commit and verify.** `.pulsar/` files are ordinary committed source. Every policy resolves to a fingerprint; pin it when you score:

```bash
pulsar agent config . --trust-project-code           # prints result.policy.fingerprint
pulsar agent score . --expect-policy <fingerprint> --trust-project-code
```

Any change to weights, config, or module source changes the fingerprint — a policy edit can never masquerade as a code repair.

## Agent mode

`pulsar agent` is a JSON-first protocol designed for AI coding agents (and scripts). Every operation emits exactly one JSON envelope on stdout — `{schema, operation, status, result}` — with logs on stderr and errors carrying structured `code`/`issues`/`recovery` fields.

| Operation | Purpose |
|---|---|
| `pulsar agent catalog [repo]` | Discover signals, config schemas, defaults, weights, and calibration slots. Never executes project code. |
| `pulsar agent config [repo]` | Validate and explain candidate or adopted policy without scoring or writing anything. |
| `pulsar agent score [repo]` | Full assessment under the resolved policy: findings with locations, severities, fix hints, and the policy fingerprint. |

Exit codes: **0** complete · **1** invalid input/config/trust/policy error · **2** proven hard-gate violations · **3** incomplete evidence.

The agent loop is three steps:

```bash
pulsar agent catalog $REPO                                   # 1. discover
pulsar agent config $REPO --vector ./vector.candidate.json   # 2. customize (preview)
pulsar agent score $REPO --expect-policy $FINGERPRINT        # 3. assess → repair → re-score
```

Agent operations write nothing to your repo — no vectors, no baselines — only disposable caches. `--full` lifts the compact-mode cap (~10 findings, 16 KB); `--signal` filters detail without changing the verdict.

See the [complete agent guide](docs/agent-first.md) for runnable examples, trust requirements, and the acceptance harness. Agent mode ships in the npm release (0.2.x) and in binaries built from source; running from a checkout requires Bun 1.3.14 and Git.

## Repository layout

| Package | Role |
|---|---|
| `@skastr0/pulsar-core` | Signal runtime, registry, scoring engine, vectors, calibration |
| `@skastr0/pulsar-ts-pack` / `@skastr0/pulsar-rs-pack` | TypeScript / Rust signal packs |
| `@skastr0/pulsar-shared-signals` | Language-agnostic signals |
| `@skastr0/pulsar-project-module-sdk` | Typed authoring APIs for calibration modules |
| `@skastr0/pulsar-project-module-effect` / `-convex` | Technology calibration modules |
| `@skastr0/pulsar-cli` | CLI source and standalone binary target |
| `@skastr0/pulsar` | npm runner for `npx`/`bunx`/`pnpm dlx` |

## Configuration files

Repo-owned policy lives under `.pulsar/` and is meant to be committed:

- `.pulsar/vector.json` — scoring weights and overrides
- `.pulsar/project-modules.json` + `.pulsar/modules/**` — executable calibration
- `.pulsar/conventions.json`, `.pulsar/glossary.json`, `.pulsar/author-aliases.json` — reference data

Generated caches and history snapshots live under `~/.config/pulsar/repos/<repo-id>/` — local runtime state, never policy. CI ratcheting debt is recorded separately in `pulsar-baseline.json`.

## For contributors

```bash
bun run typecheck && bun run test && bun run verify   # verify is the CI baseline
```

Production signals must use real repository-shaped fixtures and cite correctness evidence in the pack contract matrix — see [Signal Authoring](docs/signals/authoring.md). Publishing requires an explicit maintainer gate — see [PUBLISHING.md](PUBLISHING.md).

## Support, security, license

- Bugs and scoped proposals: [GitHub issues](https://github.com/skastr0/pulsar/issues). External PRs are not the default path while experimental — see [CONTRIBUTING.md](CONTRIBUTING.md) and [SUPPORT.md](SUPPORT.md).
- Report vulnerabilities privately — see [SECURITY.md](SECURITY.md).
- [MIT](LICENSE).
