import { pendingSignalContract, type SignalContract } from "./signal-contract.js"

export const TS_SIGNAL_CONTRACTS: ReadonlyArray<SignalContract> = [
  {
    id: "TS-LD-01-cyclomatic-complexity",
    status: "verified",
    requiredEvidence: ["calibration"],
    evidence: {
      identity:
        "ts-ld-01.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ld-01.test.ts: configSchema decodes defaults; diagnostics test proves top_n_diagnostics affects real diagnose output.",
      positiveFixture:
        "ts-ld-01.test.ts: counts branches and boolean operators; single extreme function produces over-threshold pressure.",
      negativeFixture:
        "ts-ld-01.test.ts: simple applicable function scores healthy with no diagnostics; nested callbacks do not inflate the outer function.",
      applicability:
        "ts-ld-01.test.ts: empty inspected source reports totalFunctions=0, score 1, and not_applicable metadata.",
      score:
        "ts-ld-01.test.ts: healthy fixture scores 1; single extreme function makes local max pressure dominate and drops score below 0.4.",
      diagnostics:
        "ts-ld-01.test.ts: diagnose reports only over-threshold functions, honors top_n_diagnostics, and omits healthy diagnostics.",
      factorLedger:
        "ts-ld-01.test.ts: registered pack signal emits config.max_complexity and config.top_n_diagnostics factor-ledger entries.",
      cacheSemantics:
        "ts-ld-01.test.ts and pack.test.ts: wrapped pack cache version includes the TS-LD-01 semantic cacheVersion after diagnostic-semantics bumps.",
      calibration:
        "ts-ld-01.test.ts: callback-context calibration renames Effect.fn callbacks and records module processor attribution.",
    },
  },
  {
    id: "TS-LD-02-function-size-distribution",
    status: "verified",
    requiredEvidence: ["calibration"],
    evidence: {
      identity:
        "ts-ld-02.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ld-02.test.ts: configSchema decodes defaults and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ld-02.test.ts: true function outliers clear p95 + threshold; single extreme file/function creates local max pressure.",
      negativeFixture:
        "ts-ld-02.test.ts: small functions/files score 1; raw-threshold values below p95 + threshold are not outliers.",
      applicability:
        "ts-ld-02.test.ts: empty repo reports zero files/functions, score 1, and not_applicable metadata.",
      score:
        "ts-ld-02.test.ts: healthy fixtures score 1, true outliers lower score, and calibrated integration size pressure can restore score 1.",
      diagnostics:
        "ts-ld-02.test.ts: diagnostics cover true outliers, absolute threshold pressure, callback names, and sanitized total top_n_diagnostics cap.",
      factorLedger:
        "ts-ld-02.test.ts: registered pack signal emits max_function_loc, max_file_loc, and top_n_diagnostics factor-ledger entries.",
      cacheSemantics:
        "ts-ld-02.test.ts and pack.test.ts: wrapped pack cache version includes the TS-LD-02 semantic cacheVersion after diagnostic-limit semantics change.",
      calibration:
        "ts-ld-02.test.ts: size-policy calibration records factor provenance and callback-context calibration records naming attribution.",
    },
  },
  pendingSignalContract("TS-LD-03-nesting-depth"),
  pendingSignalContract("TS-LD-04-naming-conventions"),
  pendingSignalContract("TS-LD-05-domain-term-consistency"),
  pendingSignalContract("TS-AD-01-boundary-violations"),
  pendingSignalContract("TS-AD-02-circular-dependencies"),
  pendingSignalContract("TS-AD-03-reexport-depth"),
  pendingSignalContract("TS-AD-04-boundary-parser-coverage"),
  pendingSignalContract("TS-AD-05-boundary-trust-breach"),
  pendingSignalContract("TS-DE-01-type-level-coupling"),
  pendingSignalContract("TS-DE-02-fan-in-fan-out"),
  pendingSignalContract("TS-DE-03-propagation-cost"),
  pendingSignalContract("TS-DE-04-package-dependency-health"),
  pendingSignalContract("TS-DE-05-duplicate-dependency-versions"),
  pendingSignalContract("TS-AB-01-public-export-surface"),
  pendingSignalContract("TS-AB-02-unused-exports"),
  pendingSignalContract("TS-AB-03-type-indirection-depth"),
  pendingSignalContract("TS-AB-04-interface-implementation-ratio"),
  pendingSignalContract("TS-AB-05-generic-proliferation"),
  pendingSignalContract("TS-LD-06-annotation-coverage"),
  pendingSignalContract("TS-LD-07-unsafe-type-erosion"),
  pendingSignalContract("TS-LD-08-exhaustiveness-erosion"),
  pendingSignalContract("TS-LD-09-error-channel-opacity"),
  pendingSignalContract("TS-RP-01-hotspots"),
  pendingSignalContract("TS-SL-01-duplication"),
  pendingSignalContract("TS-SL-03-suppressions"),
  pendingSignalContract("TS-SL-04-unfinished-implementations"),
  pendingSignalContract("TS-RP-02-pr-size"),
  pendingSignalContract("TS-SL-02-inconsistent-clones"),
]
