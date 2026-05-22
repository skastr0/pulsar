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
  {
    id: "TS-AD-02-circular-dependencies",
    status: "verified",
    evidence: {
      identity:
        "ts-ad-02.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ad-02.test.ts: configSchema decodes defaults and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ad-02.test.ts: fixtures detect self-loops, relative cycles, workspace package-name cycles, package-local alias cycles, larger SCCs, many scattered cycles, and repo-scale cycles.",
      negativeFixture:
        "ts-ad-02.test.ts: acyclic imports, same-file namespace re-exports, type-only cycles, generated, vendored, example, and sample sources produce no cycles.",
      applicability:
        "ts-ad-02.test.ts: acyclic projects stay applicable with no output metadata and score 1.",
      score:
        "ts-ad-02.test.ts: score distinguishes local, scattered, subsystem, and repo-scale cycles and preserves the documented floor.",
      diagnostics:
        "ts-ad-02.test.ts: diagnostics sort largest cycles first, include severity, candidate break location, hash/data payload, active/expired bypass behavior, and sanitized cycle cap.",
      factorLedger:
        "ts-ad-02.test.ts: registered pack signal emits top_n_diagnostics factor-ledger entry.",
      cacheSemantics:
        "ts-ad-02.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AD-02 semantic cacheVersion after diagnostic-limit and package-resolution semantics changes.",
    },
  },
  {
    id: "TS-AD-03-reexport-depth",
    status: "verified",
    evidence: {
      identity:
        "ts-ad-03.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ad-03.test.ts: configSchema decodes defaults and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ad-03.test.ts: fixtures detect deep relative chains, workspace package-name re-export chains, package-local alias chains, repeated branches, and circular re-exports.",
      negativeFixture:
        "ts-ad-03.test.ts: files without re-exports have zero depth and produce no diagnostics; repeated identical chains are deduplicated.",
      applicability:
        "ts-ad-03.test.ts: acyclic/no-reexport projects stay applicable with no output metadata and score 1.",
      score:
        "ts-ad-03.test.ts: score responds to effective depth over threshold while discounted directory-index relays can remain neutral.",
      diagnostics:
        "ts-ad-03.test.ts: diagnostics include severity, compact path messages, absolute hops, display hops, location, cycle flag, effective depth, representative starts, and sanitized chain cap.",
      factorLedger:
        "ts-ad-03.test.ts: registered pack signal emits top_n_diagnostics factor-ledger entry.",
      cacheSemantics:
        "ts-ad-03.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AD-03 semantic cacheVersion after diagnostic-limit and package-resolution semantics changes.",
    },
  },
  {
    id: "TS-AD-04-boundary-parser-coverage",
    status: "verified",
    evidence: {
      identity:
        "ts-ad-04.test.ts: pack registration exposes canonical id, alias, title, and wrapped cache version.",
      config:
        "ts-ad-04.test.ts: configSchema decodes defaults, custom parser_call_patterns affect parser evidence, and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ad-04.test.ts: fixtures detect weak any, unknown, untyped, request-like, anonymous default-export, and default-export function boundary parameters without parser evidence.",
      negativeFixture:
        "ts-ad-04.test.ts: parser pattern names in call arguments, parser-pattern substrings, parser calls that do not reference weak input, and parser calls outside the boundary function body do not count as parser evidence.",
      applicability:
        "ts-ad-04.test.ts: absent boundary files, not_configured boundary_globs, and boundary files with no weak external inputs produce distinct applicability states.",
      score:
        "ts-ad-04.test.ts: score is 0 for all uncovered weak boundary functions, 1 for covered/not-applicable states, and proportional for partial parser coverage.",
      diagnostics:
        "ts-ad-04.test.ts: diagnostics include warning severity, compact message, absolute location, finding data, missing-evidence text, and sanitized finding cap.",
      factorLedger:
        "ts-ad-04.test.ts: registered pack signal emits parser_call_patterns and top_n_diagnostics factor-ledger entries.",
      cacheSemantics:
        "ts-ad-04.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AD-04 semantic cacheVersion after diagnostic-limit and parser-attribution semantics changed.",
    },
  },
  {
    id: "TS-AD-05-boundary-trust-breach",
    status: "verified",
    evidence: {
      identity:
        "ts-ad-05.test.ts: compound identity, semantic cacheVersion, declared inputs, pinned input cache fingerprints, pack registration, title, and wrapped cache version are asserted.",
      config:
        "ts-ad-05.test.ts: configSchema decodes defaults, diagnostics honor sanitized top_n_diagnostics, and warn_threshold is sanitized before controlling diagnostic severity without changing score.",
      positiveFixture:
        "ts-ad-05.test.ts: synthetic primitive outputs combine parser gaps, unsafe boundary types, boundary violations, and domain drift into ranked boundary trust breaches; unsafe boundary types and boundary violations independently anchor breaches.",
      negativeFixture:
        "ts-ad-05.test.ts: measured zero inputs and domain-language drift without a boundary anchor produce no breaches or diagnostics.",
      applicability:
        "ts-ad-05.test.ts: missing, absent, and not_configured required parser coverage produce insufficient_evidence metadata, required parser not_applicable remains measured neutral, and missing/not_configured/not_applicable optional inputs remain explicit fact states.",
      score:
        "ts-ad-05.test.ts: score is neutral for insufficient/zero states, decreases with higher parser-gap pressure, and is unaffected by warn_threshold.",
      diagnostics:
        "ts-ad-05.test.ts: diagnostics include threshold-based severity, compact file message, absolute location, breach rank/data/evidence, stable ordering, and sanitized breach cap.",
      factorLedger:
        "ts-ad-05.test.ts: registered pack signal emits top_n_diagnostics and warn_threshold config factor-ledger entries; composite explanation records input weights, normalized values, available factor weight, and evidence completeness.",
      compoundInputs:
        "ts-ad-05.test.ts: declared composite inputs, aliases, canonical-id parity, pinned cache fingerprints, missing required parser coverage, required parser not-applicable state, missing optional inputs, optional reference-data absence, optional not-applicable states, and primitive normalized values are asserted.",
      cacheSemantics:
        "ts-ad-05.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AD-05 semantic cacheVersion after diagnostic-limit and warn-threshold semantics changed.",
    },
  },
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
