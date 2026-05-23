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
        "shared-02-bus-factor.test.ts and pack.test.ts: SHARED-02 declares git-revision-context and bounded-history-v5-normalized-config-git-context-factor-policy cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization, TS module-extension semantics, and cache dependency changed.",
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
        "shared-03-churn-rate.test.ts and pack.test.ts: SHARED-03 declares git-revision-context and applicability-v3-normalized-config-git-context-factor-policy cacheVersion; wrapped shared-pack cache version preserves the signal cacheVersion after config normalization, TS module-extension semantics, and cache dependency changed.",
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
  pendingSignalContract("SHARED-06-pr-dependency-delta"),
  pendingSignalContract("SHARED-07-machine-feedback-coverage"),
  pendingSignalContract("SHARED-09-contract-freshness"),
  pendingSignalContract("SHARED-10-domain-construction-control"),
  pendingSignalContract("SHARED-11-theory-encoding-index"),
  pendingSignalContract("SHARED-COV-01-coverage-facts"),
]
