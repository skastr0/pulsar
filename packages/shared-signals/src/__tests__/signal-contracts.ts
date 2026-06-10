import { pendingSignalContract, type SignalContract } from "./signal-contract.js"

export const SHARED_SIGNAL_CONTRACTS: ReadonlyArray<SignalContract> = [
  {
    id: "SHARED-CHURN-01-recent-churn",
    status: "verified",
    requiredEvidence: ["gitContext"],
    evidence: {
      identity:
        "shared-churn-01.test.ts: canonical id, alias, title, tier/category/kind, no-input contract, semantic cacheVersion, git-revision cache dependency, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-churn-01.test.ts: default window/max-commit/include/exclude settings are decoded; real compute fixtures prove finite-safe window and max-commit handling, empty include-extension behavior, and explicit extension/path filtering.",
      positiveFixture:
        "shared-churn-01.test.ts: real git fixtures prove per-file churn counts over a rolling HEAD-relative window, multiple touches to the same file, Rust source inclusion, TypeScript module-extension inclusion, max-commit sampling, and deterministic equivalent-repo output.",
      negativeFixture:
        "shared-churn-01.test.ts: commits outside the window, non-included extensions, configured excluded paths, and empty include_extensions produce no churn facts instead of misleading counts.",
      applicability:
        "shared-churn-01.test.ts: SHARED-CHURN-01 is a provider/context signal; outputs remain score-neutral with not_applicable metadata while still exposing deterministic churn facts for downstream consumers.",
      score:
        "shared-churn-01.test.ts: score is asserted as neutral provider score regardless of churn facts; max-commit sampling is recorded as evidence rather than direct score pressure.",
      diagnostics:
        "shared-churn-01.test.ts: diagnose is asserted as an empty provider diagnostic surface; downstream composite signals own user-facing churn diagnostics.",
      factorLedger:
        "shared-churn-01.test.ts: registered shared-pack signal emits config.window_days and config.include_extensions factor entries with signal-default source and correct score roles.",
      cacheSemantics:
        "shared-churn-01.test.ts and pack.test.ts: SHARED-CHURN-01 declares git-revision-context and provider-not-applicable-git-context-v1 cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization and TS module-extension semantics changed.",
      gitContext:
        "shared-churn-01.test.ts: tests run against real git repositories with authored commit dates, proving HEAD-relative history windows, max-count sampling, extension pathspecs, excluded-path behavior, and deterministic repeated history interpretation.",
    },
  },
  {
    id: "SHARED-CHURN-02-recency-weighted-churn",
    status: "verified",
    requiredEvidence: ["gitContext"],
    evidence: {
      identity:
        "shared-churn-02.test.ts: canonical id, alias, title, tier/category/kind, no-input contract, semantic cacheVersion, git-revision cache dependency, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-churn-02.test.ts: default window/half-life/max-commit/include/exclude/diagnostic settings are decoded; real compute fixtures prove finite-safe window, half-life, max-commit, and diagnostic-limit handling, empty include-extension behavior, and explicit extension/glob filtering.",
      positiveFixture:
        "shared-churn-02.test.ts: real git fixtures prove recency-weighted exponential decay over HEAD-relative history, raw churn preservation, same-file repeated history, half-life sensitivity, TypeScript module-extension inclusion, max-commit sampling, rename handling, and deterministic equivalent-repo output.",
      negativeFixture:
        "shared-churn-02.test.ts: commits outside the window, non-included extensions, default generated/test/build exclusions, configured excluded globs, and empty include_extensions produce no weighted churn facts instead of misleading counts.",
      applicability:
        "shared-churn-02.test.ts: SHARED-CHURN-02 is a provider/context signal; outputs remain score-neutral with not_applicable metadata while still exposing deterministic recency-weighted churn facts for downstream consumers.",
      score:
        "shared-churn-02.test.ts: score is asserted as neutral provider score regardless of churn facts; recency-weighted pressure is exposed as evidence for downstream composite signals rather than direct score pressure.",
      diagnostics:
        "shared-churn-02.test.ts: diagnose proves weighted-churn descending order, deterministic file tie-breaks, diagnostic caps, severity threshold, message format, location, and payload data.",
      factorLedger:
        "shared-churn-02.test.ts: registered shared-pack signal emits config.window_days and config.include_extensions factor entries with signal-default source and correct score roles.",
      cacheSemantics:
        "shared-churn-02.test.ts and pack.test.ts: SHARED-CHURN-02 declares git-revision-context and exponential-decay-normalized-history-v1 cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization and TS module-extension semantics changed.",
      gitContext:
        "shared-churn-02.test.ts: tests run against real git repositories with authored commit dates, proving HEAD-relative decay windows, max-count sampling, extension pathspecs, excluded-glob behavior, rename interpretation, and deterministic repeated history interpretation.",
    },
  },
  {
    id: "SHARED-COCHANGE-01-logical-coupling",
    status: "verified",
    requiredEvidence: ["gitContext"],
    evidence: {
      identity:
        "shared-cochange-01.test.ts: canonical id, alias, title, tier/category/kind, no-input contract, semantic cacheVersion, git-revision cache dependency, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-cochange-01.test.ts: default window/max-commit/include/exclude/min-co-change/diagnostic settings are decoded; real compute fixtures prove finite-safe window, max-commit, min-count, and diagnostic-limit handling, empty include-extension behavior, and explicit extension/glob filtering.",
      positiveFixture:
        "shared-cochange-01.test.ts: real git fixtures prove repeated co-change pair construction, support and confidence formulas, same-file touch accounting, TypeScript module-extension inclusion, Rust inclusion, max-commit sampling, rename behavior, and deterministic equivalent-repo output.",
      negativeFixture:
        "shared-cochange-01.test.ts: commits outside the window, single-file/source-less commits, non-included extensions, default generated/test/build exclusions, configured excluded globs, and empty include_extensions produce no logical-coupling facts instead of misleading pairs.",
      applicability:
        "shared-cochange-01.test.ts: SHARED-COCHANGE-01 is a provider/context signal; outputs remain score-neutral with not_applicable metadata while still exposing deterministic logical-coupling facts for downstream consumers.",
      score:
        "shared-cochange-01.test.ts: score is asserted as neutral provider score regardless of co-change facts; logical-coupling pressure is exposed as evidence for downstream composite signals rather than direct score pressure.",
      diagnostics:
        "shared-cochange-01.test.ts: diagnose proves pair order preservation from computed ranking, diagnostic caps, severity threshold, message format, location, and payload data.",
      factorLedger:
        "shared-cochange-01.test.ts: registered shared-pack signal emits config.window_days, config.min_co_change_count, and config.include_extensions factor entries with signal-default source and correct score roles.",
      cacheSemantics:
        "shared-cochange-01.test.ts and pack.test.ts: SHARED-COCHANGE-01 declares git-revision-context and history-pairs-normalized-config-v1 cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization and TS module-extension semantics changed.",
      gitContext:
        "shared-cochange-01.test.ts: tests run against real git repositories with authored commit dates, proving HEAD-relative pair windows, max-count sampling, extension pathspecs, excluded-glob behavior, rename interpretation, and deterministic repeated history interpretation.",
    },
  },
  {
    id: "SHARED-02-bus-factor",
    status: "verified",
    requiredEvidence: ["gitContext", "calibration"],
    evidence: {
      identity:
        "shared-02-bus-factor.test.ts: canonical id, alias, title, tier/category/kind, no-input contract, semantic cacheVersion, git-revision cache dependency, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-02-bus-factor.test.ts: default window/max-commit/include/exclude/min-LOC/diagnostic settings are decoded; real compute fixtures prove finite-safe window, max-commit, min-LOC, and diagnostic-limit handling, empty include-extension behavior, and explicit extension/glob filtering.",
      positiveFixture:
        "shared-02-bus-factor.test.ts and core shared-02-bus-factor.test.ts: real git fixtures prove single-author ownership pressure, multi-author ownership relief, LOC-weighted silo ordering, mailmap and .pulsar author alias normalization, TypeScript module-extension inclusion, Rust inclusion, max-commit sampling, and deterministic equivalent-repo output.",
      negativeFixture:
        "shared-02-bus-factor.test.ts: commits outside the window, docs-only history, non-included extensions, default generated/test/build exclusions, configured excluded globs, empty include_extensions, and below-min-LOC files produce insufficient/no pressure instead of misleading ownership findings.",
      applicability:
        "shared-02-bus-factor.test.ts: empty or source-less history reports insufficient_evidence metadata; measured ownership facts remain applicable with defined metadata semantics.",
      score:
        "shared-02-bus-factor.test.ts and core shared-02-bus-factor.test.ts: score bounds and monotonic pressure are asserted by comparing single-author silo pressure, multi-author relief, LOC-weighted penalty caps, and calibrated neutralization.",
      diagnostics:
        "shared-02-bus-factor.test.ts: diagnose proves no-relevant-files and single-author informational messages plus ordered silo diagnostics, diagnostic caps, severity, message format, location, and payload data.",
      factorLedger:
        "shared-02-bus-factor.test.ts and core shared-02-bus-factor.test.ts: registered shared-pack signal emits config.window_days, config.min_loc, and config.include_extensions factor entries; core calibration test proves module-attributed bus_factor.*.penalty_weight factor entries.",
      cacheSemantics:
        "shared-02-bus-factor.test.ts and pack.test.ts: SHARED-02 declares git-revision-context and bounded-history-v6-solo-window-not-applicable cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization, TS module-extension semantics, and cache dependency changed.",
      gitContext:
        "shared-02-bus-factor.test.ts and core shared-02-bus-factor.test.ts: tests run against real git repositories with authored commit dates and authors, proving HEAD-relative ownership windows, max-count sampling, extension pathspecs, excluded-glob behavior, mailmap/alias interpretation, and deterministic repeated history interpretation.",
      calibration:
        "core shared-02-bus-factor.test.ts: project-module bus-factor policy processors can neutralize visible pressure with calibration decisions, rule IDs, factor paths, and module attribution preserved in effective silo entries and factor ledger output.",
    },
  },
  {
    id: "SHARED-03-churn-rate",
    status: "verified",
    requiredEvidence: ["gitContext", "calibration"],
    evidence: {
      identity:
        "shared-03-churn-rate.test.ts: canonical id, alias, title, tier/category/kind, no-input contract, semantic cacheVersion, git-revision cache dependency, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-03-churn-rate.test.ts: default window/max-mature-commit/similarity/include/exclude/diagnostic settings are decoded; real compute fixtures prove finite-safe window, max-mature-commit, similarity-threshold, diagnostic-limit handling, empty include-extension behavior, and explicit extension/glob filtering.",
      positiveFixture:
        "shared-03-churn-rate.test.ts and core shared-03-churn-rate.test.ts: real git fixtures prove mature-line churn, unchanged-line retention, revert-window churn, deleted-file churn, exact and edited rename handling, dirty worktree exclusion, TypeScript module-extension inclusion, Rust inclusion, source-filtered max-mature-commit sampling, and deterministic equivalent-repo output.",
      negativeFixture:
        "shared-03-churn-rate.test.ts: docs-only history, non-production test files, excluded globs, empty include_extensions, and source-less mature windows produce insufficient/no pressure instead of misleading churn findings.",
      applicability:
        "shared-03-churn-rate.test.ts and core shared-03-churn-rate.test.ts: source-less or not-yet-mature windows report insufficient_evidence metadata; measured mature churn facts remain applicable with defined metadata semantics.",
      score:
        "shared-03-churn-rate.test.ts and core shared-03-churn-rate.test.ts: score bounds and monotonic pressure are asserted by comparing retained mature lines, increasing churned-line pressure, calibrated neutralization, and capped full-pressure churn.",
      diagnostics:
        "shared-03-churn-rate.test.ts: diagnose proves insufficient-history informational messages plus ordered churn payloads, diagnostic caps, severity, message format, location, and repo/file rate data.",
      factorLedger:
        "shared-03-churn-rate.test.ts and core shared-03-churn-rate.test.ts: registered shared-pack signal emits config.window_days, config.similarity_threshold, and config.include_extensions factor entries; core calibration test proves module-attributed churn_rate.*.penalty_weight factor entries.",
      cacheSemantics:
        "shared-03-churn-rate.test.ts and pack.test.ts: SHARED-03 declares git-revision-context and applicability-v4-deleted-files-excluded cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization, TS module-extension semantics, and cache dependency changed.",
      gitContext:
        "shared-03-churn-rate.test.ts and core shared-03-churn-rate.test.ts: tests run against real git repositories with authored commit dates, proving HEAD-relative mature windows, revert-window line survival, deleted-file survival failure, source-pathspec commit caps, rename-plus-edit interpretation, dirty worktree isolation, and deterministic repeated history interpretation.",
      calibration:
        "core shared-03-churn-rate.test.ts: project-module churn-rate policy processors can neutralize visible pressure with calibration decisions, rule IDs, factor paths, and module attribution preserved in effective file entries and factor ledger output.",
    },
  },
  {
    id: "SHARED-05-suppression-governance",
    status: "verified",
    requiredEvidence: ["compoundInputs"],
    evidence: {
      identity:
        "shared-05-suppression.test.ts: canonical id, alias, title, tier/category/kind, compound input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-05-suppression.test.ts: default top_n_diagnostics is decoded and config-factor-ledger-backed; fractional, negative, and NaN diagnostic limits are normalized through real compute output.",
      positiveFixture:
        "shared-05-suppression.test.ts: TypeScript and Rust suppression fixture inputs prove cross-language governance pressure, missing and expired justification aggregation, justified-suppression pressure, alias/canonical input equivalence, and deterministic output.",
      negativeFixture:
        "shared-05-suppression.test.ts: missing optional inputs, all-empty inputs, single-language inputs, and one-language-with-empty-peer inputs stay score-neutral and not_applicable instead of creating false cross-language pressure.",
      applicability:
        "shared-05-suppression.test.ts: outputMetadata reports not_applicable until suppressions appear in at least two language packs; two-language suppression facts remain applicable even when all suppressions are justified.",
      score:
        "shared-05-suppression.test.ts: score bounds and monotonic pressure are asserted for single-language neutrality, missing justification pressure, expired-justification pressure, justified multi-language debt, and cross-language unjustified debt.",
      diagnostics:
        "shared-05-suppression.test.ts: diagnose proves ordered overall/TypeScript/Rust diagnostics, diagnostic caps, not-applicable info severity, applicable warn severity, and structured aggregate/language payloads.",
      factorLedger:
        "shared-05-suppression.test.ts: registered shared-pack signal emits config.top_n_diagnostics factor entries through withConfigFactorLedger.",
      cacheSemantics:
        "shared-05-suppression.test.ts and pack.test.ts: SHARED-05 declares single-language-applicability-v2-normalized-diagnostics cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after diagnostic normalization and applicability semantics changed.",
      compoundInputs:
        "shared-05-suppression.test.ts: compound inputs declare cache fingerprints for TS-SL-03-suppressions and RS-SL-02-suppressions; tests prove optional missing inputs, canonical ids, legacy aliases, empty peer inputs, and deterministic map-order handling.",
    },
  },
  {
    id: "SHARED-06-pr-dependency-delta",
    status: "verified",
    requiredEvidence: ["compoundInputs", "gitContext", "integration"],
    evidence: {
      identity:
        "shared-06-pr-dep-delta.test.ts: canonical id, alias, title, tier/category/kind, compound input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-06-pr-dep-delta.test.ts: default top_n_diagnostics is decoded and config-factor-ledger-backed; fractional, negative, NaN, and Infinity diagnostic limits are normalized through real compute output.",
      positiveFixture:
        "shared-06-pr-dep-delta.test.ts: TypeScript and Rust PR-size fixture inputs prove cross-boundary, cross-package, and cross-crate dependency-edge aggregation, per-language facts, alias/canonical input equivalence, deterministic output, and measured line-churn context.",
      negativeFixture:
        "shared-06-pr-dep-delta.test.ts: missing optional inputs, clean measured diffs, empty dependency deltas, missing git diff evidence, and changed-hunks fallback evidence are distinguished instead of collapsing every zero-edge output into a healthy result.",
      applicability:
        "shared-06-pr-dep-delta.test.ts: outputMetadata reports not_applicable for no PR surface, stays applicable for measured line churn with no new dependency edges, and reports insufficient_evidence for missing or unavailable dependency-delta facts.",
      score:
        "shared-06-pr-dep-delta.test.ts: score bounds and monotonic pressure are asserted for cross-package, cross-crate, cross-boundary, mixed-language, no-edge, and saturated edge-count cases.",
      diagnostics:
        "shared-06-pr-dep-delta.test.ts: diagnose proves ordered aggregate/TypeScript/Rust diagnostics, diagnostic caps, info/warn severity for measured and insufficient evidence states, and structured aggregate/language payloads.",
      factorLedger:
        "shared-06-pr-dep-delta.test.ts: registered shared-pack signal emits config.top_n_diagnostics factor entries through withConfigFactorLedger.",
      cacheSemantics:
        "shared-06-pr-dep-delta.test.ts and pack.test.ts: SHARED-06 declares empty-diff-applicability-v2-evidence-state-diagnostics cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after evidence-state and diagnostic semantics changed.",
      compoundInputs:
        "shared-06-pr-dep-delta.test.ts: compound inputs declare cache fingerprints for TS-RP-02-pr-size and RS-RP-03-pr-size; tests prove optional missing inputs, canonical ids, legacy aliases, dependency evidence states, and deterministic map-order handling.",
      gitContext:
        "cli shared-signals.test.ts, ts-rp-02.test.ts, and rs-rp-signals.test.ts: tests run against real git repositories and committed follow-up diffs, proving upstream TS/Rust PR-size signals feed SHARED-06 with git commit-range dependency-delta facts rather than synthetic-only output.",
      integration:
        "cli shared-signals.test.ts and bun run dev score --signal SHARED-06 .: aggregate observer and direct single-signal runtime fixtures provide TS/Rust language layers for SHARED-06 compound inputs and execute the shared signal on real worktree substrate.",
    },
  },
  {
    id: "SHARED-07-machine-feedback-coverage",
    status: "verified",
    requiredEvidence: ["gitContext", "integration"],
    evidence: {
      identity:
        "shared-07-machine-feedback-coverage.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-07-machine-feedback-coverage.test.ts: default required_classes and top_n_diagnostics are decoded and config-factor-ledger-backed; duplicate required classes are normalized to a canonical set and fractional, negative, NaN, and Infinity diagnostic limits are normalized through real compute output.",
      positiveFixture:
        "shared-07-machine-feedback-coverage.test.ts: package-script and parser-backed GitHub workflow fixtures prove build/typecheck/test/static_analysis/coverage discovery, workflow script-alias expansion, YAML block-scalar run commands, CI reachability, repo-path-stable sourceFingerprint, and deterministic repeated output.",
      negativeFixture:
        "shared-07-machine-feedback-coverage.test.ts: missing manifests/workflows are explicit absent facts, malformed package metadata and malformed workflow YAML are unknown with parse-error evidence rather than absent/present, and empty required class lists do not hide malformed evidence.",
      applicability:
        "shared-07-machine-feedback-coverage.test.ts: outputMetadata is asserted as not_applicable because SHARED-07 is a fact provider consumed by composites such as SHARED-11 rather than a direct score-bearing pressure signal.",
      score:
        "shared-07-machine-feedback-coverage.test.ts: score remains neutral for present, absent, and empty-required fact-provider outputs while missing/unknown counts are preserved for downstream composite scoring.",
      diagnostics:
        "shared-07-machine-feedback-coverage.test.ts: diagnose proves warning-first class ordering, required absent/unknown warning severity, present info severity, diagnostic caps, and structured class/evidence payloads.",
      factorLedger:
        "shared-07-machine-feedback-coverage.test.ts: registered shared-pack signal emits config.required_classes and config.top_n_diagnostics factor entries through withConfigFactorLedger.",
      cacheSemantics:
        "shared-07-machine-feedback-coverage.test.ts and pack.test.ts: SHARED-07 declares scripts-and-github-workflows-v2-yaml-parser-stable-fingerprint cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization, parser-backed workflow evidence, repo-relative fingerprinting, and diagnostic ordering changed.",
      gitContext:
        "shared-07-machine-feedback-coverage.test.ts and cli shared-signals.test.ts: tests provide SignalContextTag with real worktree paths and filesystem fixtures for package.json and .github/workflows evidence.",
      integration:
        "cli shared-signals.test.ts and bun run dev score --signal SHARED-07 .: aggregate observer and direct single-signal runtime execute SHARED-07 against repository substrate and expose machine feedback facts without language-pack dependencies.",
    },
  },
  {
    id: "SHARED-09-contract-freshness",
    status: "verified",
    requiredEvidence: ["referenceData", "integration"],
    evidence: {
      identity:
        "shared-09-contract-freshness.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-09-contract-freshness.test.ts: default diagnostic and weighted-finding caps are decoded and config-factor-ledger-backed; fractional, NaN, and Infinity diagnostic/pressure config values are normalized through real compute output.",
      positiveFixture:
        "shared-09-contract-freshness.test.ts: canonical .pulsar/contract-freshness.json fixtures prove fresh source/artifact hashes, stale source hashes, stale artifact hashes, missing source contracts, missing generated artifacts, missing source-hash provenance, opt-in orphan globs, deterministic finding order, and repo-path-stable sourceFingerprint output.",
      negativeFixture:
        "shared-09-contract-freshness.test.ts: absent manifests are not_configured with insufficient evidence, malformed manifests are unknown with warn diagnostics, and contracts missing source-hash provenance do not claim zero freshness merely because an artifact hash exists.",
      applicability:
        "shared-09-contract-freshness.test.ts: outputMetadata is undefined for present/zero reference data, insufficient_evidence for not_configured and unknown reference data, and explicit score-neutral behavior is preserved when no findings exist.",
      score:
        "shared-09-contract-freshness.test.ts: score bounds and monotonic pressure are asserted by relationally comparing zero, missing-provenance, stale-artifact, mixed-finding, tight-cap, at-cap, and loose-cap cases plus finite score behavior under non-finite config.",
      diagnostics:
        "shared-09-contract-freshness.test.ts: diagnose proves severity/weight ordering, diagnostic caps, missing-manifest and malformed-manifest summary diagnostics, file/line locations, and structured payload fields for weighted pressure, cache contributors, and claim limits.",
      factorLedger:
        "shared-09-contract-freshness.test.ts: registered shared-pack signal emits config.top_n_diagnostics and config.max_weighted_findings factor entries through explicit threshold classification plus withConfigFactorLedger.",
      cacheSemantics:
        "shared-09-contract-freshness.test.ts and pack.test.ts: SHARED-09 declares reference-data-v2-normalized-config-source-provenance cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after source-provenance and config-normalization semantics changed.",
      referenceData:
        "shared-09-contract-freshness.test.ts and core reference-data-loader.test.ts: tests load canonical contract freshness entries from repo-owned .pulsar/contract-freshness.json through loadCanonicalReferenceDataEntries rather than injecting synthetic signal output.",
      integration:
        "cli shared-signals.test.ts and bun run dev score --signal SHARED-09 .: aggregate observer and direct single-signal runtime execute SHARED-09 against repository substrate with canonical reference-data loading, including zero, not_configured, unknown, and missing-provenance states.",
    },
  },
  {
    id: "SHARED-10-domain-construction-control",
    status: "verified",
    requiredEvidence: ["referenceData", "integration"],
    evidence: {
      identity:
        "shared-10-domain-construction-control.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-10-domain-construction-control.test.ts: default diagnostic cap, weighted-finding cap, and explicit-open diagnostic toggle are decoded and config-factor-ledger-backed; fractional, NaN, and Infinity diagnostic/pressure config values are normalized through real compute output.",
      positiveFixture:
        "shared-10-domain-construction-control.test.ts and core domain-construction.test.ts: canonical .pulsar/domain-construction.json fixtures prove controlled constructs with private constructors and parser evidence, public/implicit constructor detection, default-exported declaration and parser syntax, generic class constraints with braces, regex-literal class bodies, controlled export evidence, explicitly open constructs, stale declaration/evidence hashes, missing source-hash provenance, missing declaration files, duplicate-path provenance dedupe, deterministic finding order, and repo-path-stable reference-data output.",
      negativeFixture:
        "shared-10-domain-construction-control.test.ts and core domain-construction.test.ts: absent manifests are not_configured, empty manifests are not_applicable, malformed manifests are unknown, missing declaration files are stale-source, missing exported construct declarations are score-bearing, missing/symbol-mismatched parser evidence is score-bearing, type-only and ambient parser evidence are rejected, non-exported and ambient controlled export evidence is rejected, and manifests missing source-hash provenance do not claim zero construction control.",
      applicability:
        "shared-10-domain-construction-control.test.ts: outputMetadata is undefined for present/zero reference data, not_applicable for empty manifests, insufficient_evidence for not_configured and unknown reference data, and explicitly open constructs remain visible while score-neutral.",
      score:
        "shared-10-domain-construction-control.test.ts: score bounds and monotonic pressure are asserted by relationally comparing zero, missing-construction-evidence, missing-source-provenance, uncontrolled-constructor/stale-source mixed pressure, tight-cap, at-cap, and loose-cap cases plus finite score behavior under non-finite config.",
      diagnostics:
        "shared-10-domain-construction-control.test.ts: diagnose proves severity/weight ordering, explicit-open filtering, diagnostic caps, missing-manifest and malformed-manifest summary diagnostics, file/line locations, and structured payload fields for weighted pressure, cache contributors, and claim limits.",
      factorLedger:
        "shared-10-domain-construction-control.test.ts: registered shared-pack signal emits config.top_n_diagnostics, config.max_weighted_findings, and config.include_explicitly_open_diagnostics factor entries through explicit threshold classification plus withConfigFactorLedger.",
      cacheSemantics:
        "shared-10-domain-construction-control.test.ts and pack.test.ts: SHARED-10 declares reference-data-v2-normalized-config-source-provenance cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after source-provenance and config-normalization semantics changed.",
      referenceData:
        "shared-10-domain-construction-control.test.ts, core domain-construction.test.ts, and core reference-data-loader.test.ts: tests load canonical domain construction entries from repo-owned .pulsar/domain-construction.json through loadCanonicalReferenceDataEntries and source-level loadDomainConstructionFacts rather than injecting synthetic signal output.",
      integration:
        "cli shared-signals.test.ts and bun run dev score --signal SHARED-10 .: aggregate observer and direct single-signal runtime execute SHARED-10 against repository substrate with canonical reference-data loading, including zero, not_configured, unknown, and missing-source-provenance states.",
    },
  },
  {
    id: "SHARED-11-theory-encoding-index",
    status: "verified",
    requiredEvidence: ["compoundInputs", "integration"],
    evidence: {
      identity:
        "shared-11-theory-encoding-index.test.ts: canonical id, alias, title, tier/category/kind, semantic cacheVersion, pack registration, registry alias lookup, and derived enforcement ceiling are asserted.",
      config:
        "shared-11-theory-encoding-index.test.ts: default diagnostic cap, warning threshold, and minimum available factor weight are decoded; non-finite diagnostic/threshold/minimum values are normalized through real compute output.",
      positiveFixture:
        "shared-11-theory-encoding-index.test.ts: measured SHARED-10 and SHARED-09 foundation facts produce zero pressure; combined foundation, machine-feedback, coverage, boundary-parser, error-channel, property/spec, and churn facts produce deterministic weighted pressure, ordered gaps, property/spec evidence, and value-level primitive-input explanations.",
      negativeFixture:
        "shared-11-theory-encoding-index.test.ts: missing required inputs, not_configured required foundations, optional facts attempting to rescue unmeasured foundations, unknown machine-feedback evidence, zero-denominator coverage, empty churn facts, contract inventory, and model filenames are rejected instead of being treated as healthy theory evidence.",
      applicability:
        "shared-11-theory-encoding-index.test.ts, cli shared-signals.test.ts, and ts-pack observer-integration.test.ts: missing or unmeasured required foundations emit insufficient_evidence metadata; measured required foundations remain applicable even when optional facts are absent.",
      score:
        "shared-11-theory-encoding-index.test.ts: score bounds and monotonic pressure are asserted by comparing insufficient evidence, zero foundation facts, mixed weighted gaps, and non-finite config normalization cases.",
      diagnostics:
        "shared-11-theory-encoding-index.test.ts, cli shared-signals.test.ts, and ts-pack observer-integration.test.ts: diagnose proves insufficient-evidence warning payloads, measured-zero info diagnostics, warning threshold severity, deterministic gap order, and diagnostic caps through direct compute and public runtime paths.",
      factorLedger:
        "shared-11-theory-encoding-index.test.ts: registered shared-pack signal emits config.top_n_diagnostics, config.warn_threshold, and config.min_available_factor_weight factor entries through explicit threshold classification.",
      cacheSemantics:
        "shared-11-theory-encoding-index.test.ts and pack.test.ts: SHARED-11 declares theory-encoding-index-composite-v4-grounded-optionals cacheVersion, all compound inputs declare cache fingerprints, and the shared-pack wrapper preserves the signal cacheVersion after required-foundation, grounded optional-evidence, and config-normalization semantics changed.",
      compoundInputs:
        "shared-11-theory-encoding-index.test.ts: canonical compound input ids, aliases, required-vs-optional status, cache fingerprints, alias-equivalent output, primitive-input explanations, and required-foundation gating are asserted across SHARED-10, SHARED-09, SHARED-07, SHARED-COV-01, TS-AD-04, TS-LD-09, and SHARED-CHURN-02.",
      integration:
        "cli shared-signals.test.ts, cli score.test.ts, ts-pack observer-integration.test.ts, and bun run dev score --signal SHARED-11 .: aggregate observer, direct single-signal runtime, and user-facing CLI wrapper execute SHARED-11 against repository substrates, proving measured foundation facts, missing-reference-data insufficient evidence, public metadata, public diagnostics, and factor-audit rendering.",
    },
  },
  {
    id: "SHARED-COV-01-coverage-facts",
    status: "verified",
    requiredEvidence: ["referenceData", "integration"],
    evidence: {
      identity:
        "shared-cov-01-coverage-facts.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "shared-cov-01-coverage-facts.test.ts: default diagnostic cap is decoded; fractional, negative, NaN, and Infinity diagnostic values are normalized through real compute output.",
      positiveFixture:
        "shared-cov-01-coverage-facts.test.ts and core coverage-facts.test.ts: LCOV and Istanbul coverage reference facts are parsed and emitted with tool, source path, checked paths, per-file facts, and line/function/branch summaries.",
      negativeFixture:
        "shared-cov-01-coverage-facts.test.ts, core coverage-facts.test.ts, and core reference-data-loader.test.ts: existing zero-coverage reports remain measured zero, absent coverage reports remain absent, malformed coverage becomes unknown, and omitted ReferenceData state is not_configured instead of a false healthy coverage fact.",
      applicability:
        "shared-cov-01-coverage-facts.test.ts: present and zero coverage facts are applicable provider facts; absent, unknown, and not_configured coverage facts emit insufficient_evidence metadata.",
      score:
        "shared-cov-01-coverage-facts.test.ts: score is asserted as neutral provider score for present and measured-zero coverage; unavailable evidence is carried by applicability metadata rather than pressure.",
      diagnostics:
        "shared-cov-01-coverage-facts.test.ts and cli shared-signals.test.ts: diagnose proves state/source/path/measured-summary payloads, unknown-state warning severity, unavailable-state messages without synthetic coverage percentages, and diagnostic caps through direct compute and runtime paths.",
      factorLedger:
        "shared-cov-01-coverage-facts.test.ts: registered shared-pack signal emits config.top_n_diagnostics factor entry with signal-default source and threshold role through withConfigFactorLedger.",
      cacheSemantics:
        "shared-cov-01-coverage-facts.test.ts and pack.test.ts: SHARED-COV-01 declares reference-data-v3-unavailable-unmeasured-config cacheVersion and the shared-pack wrapper preserves the signal cacheVersion after config-normalization and unavailable-state semantics changed.",
      referenceData:
        "shared-cov-01-coverage-facts.test.ts, core coverage-facts.test.ts, and core reference-data-loader.test.ts: tests parse canonical coverage/lcov.info and coverage/coverage-final.json data and load canonical coverage entries through loadCanonicalReferenceDataEntries rather than relying only on synthetic signal output.",
      integration:
        "cli shared-signals.test.ts, cli score.test.ts, and bun run dev score --signal SHARED-COV-01 .: aggregate observer, direct single-signal runtime, and user-facing CLI wrapper execute SHARED-COV-01 against repository substrates, proving absent coverage, loaded LCOV coverage, public diagnostics, metadata, and factor-audit rendering.",
    },
  },
]
