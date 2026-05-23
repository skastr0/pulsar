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
  pendingSignalContract("SHARED-02-bus-factor"),
  pendingSignalContract("SHARED-03-churn-rate"),
  pendingSignalContract("SHARED-05-suppression-governance"),
  pendingSignalContract("SHARED-06-pr-dependency-delta"),
  pendingSignalContract("SHARED-07-machine-feedback-coverage"),
  pendingSignalContract("SHARED-09-contract-freshness"),
  pendingSignalContract("SHARED-10-domain-construction-control"),
  pendingSignalContract("SHARED-11-theory-encoding-index"),
  pendingSignalContract("SHARED-COV-01-coverage-facts"),
]
