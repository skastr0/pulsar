# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project follows Semantic Versioning for its declared public API.

## [Unreleased]

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
