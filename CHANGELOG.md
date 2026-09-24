# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning for its declared public API.

## [0.3.0] - 2026-09-24

### Added

- `TS-SL-07-rule-ownership-alignment`, a TypeScript check that scores how well the code matches the ownership rules a repository declares in `.pulsar/ownership.json`. It is advisory only (soft warning), and it is not applicable until a repository declares that file. Pulsar now ships 75 checks.
- `pulsar agent discover` proposes an ownership inventory from duplicated-code evidence. It prints JSON, adopts nothing, and makes no model call.
- `pulsar agent judge` judges the declared ownership groups with TypeSafe's Jev model (`jev-1.13.0`). It sends the declared source and context files and the repository's rubric to `api.typesafe.ai`, needs `TYPESAFE_API_KEY`, and saves requests and responses under `.pulsar/ownership-runs/`. `--dry-run` shows the rubric, paths, byte counts, and number of calls without sending anything. `agent score` replays the saved assessment offline.
- `agent score` reports `preference_alignment` for ownership checks, kept separate from the readiness score.

### Fixed

- An adopted ownership assessment now changes the input fingerprint, even when the file is gitignored.
- Uncertain ownership selections resolve to unknown instead of a verdict.
- Release assets exclude intermediate build files.

## [0.2.1] - 2026-09-16

This is the first published 0.2.x release. It includes the previously unpublished 0.2.0 changes below, including the Quartz/tsgo migration. Library consumers upgrading from 0.1.5 should also account for the move to Effect 4 and TypeScript 7.

### Added

- Agent-first discovery, policy validation, and repository assessments, with source and native external-consumer acceptance tests.

### Changed

- Reduced transient TypeScript analysis memory by sharing pending source-file requests, processing ordered file windows, and batching async-failure checker evidence.
- Reused type-indirection resolution indexes and fused dangerous-capability syntax traversals to reduce repeated analysis work.
- Streamed Git history and disk-cache I/O instead of materializing whole buffers, and validated cached time-series ledgers with file fingerprints instead of rereading their bytes on every operation.
- Removed a redundant serialization of compressed observer-cache output.

### Fixed

- Fail closed on Git output limits and wait for aborted subprocesses to exit.
- Preserve disk-cache correctness across concurrent loads, eviction, malformed records, and exclusive temporary-file collisions; sweep abandoned temporary files.
- Detect external time-series ledger replacement, corruption, and timestamp-preserving changes.

### Known limitations

- TS-AD-04 can still fail on some repositories; the performance comparisons preserved this existing failure.
- The Effect benchmark still exceeds a 4 GiB process-tree physical-footprint budget. The measured reductions are workload-specific, not a universal memory bound.
- Detailed measurements and output-parity evidence are recorded in [round one](docs/explorations/resource-performance-2026-09-14.md) and [round two](docs/explorations/resource-performance-2026-09-15.md).

## [0.2.0] - 2026-09-07

### Added

- Scored TypeScript through Quartz 0.2.1 and pinned tsgo `7.1.0-dev.20260905.1` instead of ts-morph.
- Embedded the native tsgo `lib/` tree in compiled CLI binaries so native score can open Quartz without a host TypeScript install.

### Changed

- Ready observer batches now run independent signals with unbounded Effect concurrency.
- Live worktree and single-signal CLI runs reuse one scoped Quartz session instead of reopening analysis for every observation.
- Module-graph aliases resolve only from declared tsconfig `paths`; `@/* → src/*` is no longer invented.

### Fixed

- Native extract copies sibling `lib.d.ts` with `tsc`, so tsgo no longer panics and hangs CI.
- AD-04 inherited parser credit requires a proven callee binding, not a same-name match across files.
- Native CLI compile now uses package dist and keeps onboard catalog tests out of the tsc project.

## [0.1.5] - 2026-08-17

### Added

- Added the guided `pulsar onboard` flow for reviewing real repository signals, recording typed calibration choices, previewing the resulting score, and explicitly accepting baseline debt.
- Added per-signal diagnostics to score JSON and inspectable artifact identity through `pulsar --build-info`.

### Changed

- Bound score and gate authority to explicit evidence classes, and made uncalibrated or operationally failed runs report their uncertainty instead of presenting a quality verdict.
- Made source, native, and npm delivery gates compare the same registry, output schema, findings, enforcement metadata, onboarding behavior, and build provenance on deterministic fixtures.
- Made repository development execution rebuild missing package outputs, including the stale-`tsbuildinfo` case, without changing published default exports.

### Fixed

- Prevented large JSON output from being truncated when Pulsar writes through a Unix pipe.
- Corrected SolidStart detection, finite-concurrency recognition, parser-alias coverage, and secret-metadata classification to reduce known false positives.
- Shipped onboarding in compiled binaries with the target OpenTUI native library embedded for each supported platform.

## [0.1.4] - 2026-06-10

### Added

- Added poison-authority and provider-role metadata so gate-bearing evidence is distinguishable from advisory signal output.
- Added direct GitHub binary releases and a truth-pass review skill for evidence-focused Pulsar assessments.

### Changed

- Reworked category and readiness aggregation around continuous local pressure, a lower p-norm, severity ceilings, and poison-authority-aware verdicts.
- Expanded readiness output with degraded and not-applicable states, dominant pressure drivers, and thin-margin context.
- Hardened the TypeScript and Rust packs with evidence floors, compiler-aware classification, and smoother score curves instead of dependency cliffs.

### Fixed

- Kept machine-readable stdout clean by routing Effect runtime logging to stderr.
- Treated single-author bus-factor windows as not applicable and excluded whole-file deletions from churn pressure.
- Reduced false positives across TypeScript boundary parsing, capability detection, secret detection, promise handling, error channels, clone divergence, and interface analysis.
- Improved Rust visibility, dependency, catch-all, error-posture, clone, literal, and nested-trait analysis from adversarial fixtures.

## [0.1.3] - 2026-05-30

### Changed

- Made npm publishing resumable by skipping package versions that already exist during a partial release rerun.

## [0.1.2] - 2026-05-30

### Added

- Added the Next.js project module to the npm publish workflow and documented package order.

### Changed

- Split shared theory-encoding output/model assembly into focused modules.

### Fixed

- Aligned persona scoring coverage with explicit changed-only diff mode.

## [0.1.1] - 2026-05-17

### Added

- Composite signal SDK foundations and additional TypeScript/shared signal composites.
- Architecture role metadata for opt-in calibration profiles.

### Changed

- Normalized self-calibration provenance and default calibration boundaries.
- Moved npm publishing to GitHub Actions trusted publishing.

### Fixed

- Normalized the npm runner `bin` path for clean `npx`, `bunx`, and `pnpm dlx` execution.

## [0.1.0] - 2026-05-15

### Added

- Initial public release candidate for the Pulsar monorepo.
- TypeScript, Rust, and shared signal packages.
- Project-module SDK and initial Effect/Convex technology calibration modules.
- Bun-native CLI source and standalone binary release workflow.
