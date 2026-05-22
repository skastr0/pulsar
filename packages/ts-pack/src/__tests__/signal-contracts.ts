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
  {
    id: "TS-LD-03-nesting-depth",
    status: "verified",
    requiredEvidence: ["calibration"],
    evidence: {
      identity:
        "ts-ld-03.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ld-03.test.ts: configSchema decodes defaults; threshold and sanitized top_n_diagnostics affect real output.",
      positiveFixture:
        "ts-ld-03.test.ts: nested for/if/try/if/for control flow reaches depth 5 and produces over-threshold pressure.",
      negativeFixture:
        "ts-ld-03.test.ts: top-level branch scores healthy with no diagnostics; nested callbacks reset depth at function boundaries.",
      applicability:
        "ts-ld-03.test.ts: empty repo reports zero functions, no threshold findings, score 1, and no diagnostics.",
      score:
        "ts-ld-03.test.ts: healthy fixture scores 1, true nesting violation scores 0, and calibrated penalty weight partially deweights pressure.",
      diagnostics:
        "ts-ld-03.test.ts: diagnostics include severity, message, location, threshold data, and sanitized total top_n_diagnostics cap.",
      factorLedger:
        "ts-ld-03.test.ts: registered pack signal emits max_nesting and top_n_diagnostics factor-ledger entries.",
      cacheSemantics:
        "ts-ld-03.test.ts and pack.test.ts: wrapped pack cache version includes the TS-LD-03 semantic cacheVersion after diagnostic-limit semantics change.",
      calibration:
        "ts-ld-03.test.ts: nesting-policy calibration records factor provenance, visibility/threshold/penalty changes, and repo self-calibration attribution.",
    },
  },
  {
    id: "TS-LD-04-naming-conventions",
    status: "verified",
    requiredEvidence: ["referenceData"],
    evidence: {
      identity:
        "ts-ld-04.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ld-04.test.ts: configSchema decodes defaults and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ld-04.test.ts: inconsistent function/class/interface/type/enum/const identifiers each produce naming violations.",
      negativeFixture:
        "ts-ld-04.test.ts: configured conventions accept canonical names, context-aware constants, and type-level runtime values.",
      applicability:
        "ts-ld-04.test.ts: empty repo with conventions is neutral; missing conventions return insufficient_evidence metadata.",
      score:
        "ts-ld-04.test.ts: conforming and empty fixtures score 1, missing reference data scores 1, and all-violating fixture scores 0.",
      diagnostics:
        "ts-ld-04.test.ts: diagnostics include warning severity, stable hashes, expected/actual patterns, and sanitized total top_n_diagnostics cap.",
      factorLedger:
        "ts-ld-04.test.ts: registered pack signal emits top_n_diagnostics factor-ledger entry.",
      cacheSemantics:
        "ts-ld-04.test.ts and pack.test.ts: wrapped pack cache version includes the TS-LD-04 semantic cacheVersion after diagnostic-limit semantics change.",
      referenceData:
        "ts-ld-04.test.ts: schema-conventions reference data drives loaded naming checks; missing reference data degrades explicitly and observer applicability matches single-signal output.",
    },
  },
  {
    id: "TS-LD-05-domain-term-consistency",
    status: "verified",
    requiredEvidence: ["referenceData"],
    evidence: {
      identity:
        "ts-ld-05.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ld-05.test.ts: configSchema decodes defaults and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ld-05.test.ts: glossary fixture classifies duplicate, conflict, and novel identifiers with canonical suggestions.",
      negativeFixture:
        "ts-ld-05.test.ts: canonical glossary terms match without diagnostics; empty loaded-glossary repo has no identifiers.",
      applicability:
        "ts-ld-05.test.ts: empty repo with glossary is neutral; missing glossary returns insufficient_evidence metadata.",
      score:
        "ts-ld-05.test.ts: loaded glossary drift fixture scores from weighted conflict/duplicate/novel counts; missing and empty glossary-backed fixtures score 1.",
      diagnostics:
        "ts-ld-05.test.ts: diagnostics include info/warn severity by classification, canonical suggestions, locations, data, and sanitized total top_n_diagnostics cap.",
      factorLedger:
        "ts-ld-05.test.ts: registered pack signal emits top_n_diagnostics factor-ledger entry.",
      cacheSemantics:
        "ts-ld-05.test.ts and pack.test.ts: wrapped pack cache version includes the TS-LD-05 semantic cacheVersion after diagnostic-limit semantics change.",
      referenceData:
        "ts-ld-05.test.ts: glossary reference data drives loaded term classification; missing glossary degrades explicitly with info diagnostic and insufficient_evidence metadata.",
    },
  },
  {
    id: "TS-AD-01-boundary-violations",
    status: "verified",
    requiredEvidence: ["referenceData"],
    evidence: {
      identity:
        "ts-ad-01.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ad-01.test.ts: configSchema decodes defaults and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ad-01.test.ts: fixtures flag deep reaches, blocked targets, non-allowlisted imports, unexported subpaths, and cross-package relative reaches.",
      negativeFixture:
        "ts-ad-01.test.ts: root-entry workspace imports, manifest-exported subpaths, and an empty convention-backed repo produce no violations.",
      applicability:
        "ts-ad-01.test.ts: loaded conventions with zero imports are neutral; missing schema-conventions returns insufficient_evidence metadata in single-signal and observer output.",
      score:
        "ts-ad-01.test.ts: loaded violation score follows 1 - violations / totalImports and zero-import or missing-reference outputs score 1.",
      diagnostics:
        "ts-ad-01.test.ts: diagnostics include block severity, kind/specifier/from/to message, file/line location, hash/data payload, and sanitized total top_n_diagnostics cap.",
      factorLedger:
        "ts-ad-01.test.ts: registered pack signal emits top_n_diagnostics factor-ledger entry.",
      cacheSemantics:
        "ts-ad-01.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AD-01 semantic cacheVersion after diagnostic-limit semantics change.",
      referenceData:
        "ts-ad-01.test.ts: schema-conventions boundary reference data drives loaded boundary classification; missing conventions degrade explicitly through signal and observer paths.",
    },
  },
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
