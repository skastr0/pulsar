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
  {
    id: "TS-DE-01-type-level-coupling",
    status: "verified",
    requiredEvidence: ["calibration"],
    evidence: {
      identity:
        "ts-de-01.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-de-01.test.ts: configSchema decodes defaults, exclude_globs remove files from the module set, precise_module_limit selects the fast path, path aliases resolve in fast mode, and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-de-01.test.ts: real ts-morph fixtures count direct type imports, fast-path import declarations, fast-path import-type references, path-alias type imports, re-export attribution to original type definitions, mixed-reference dedupe, and diagnostic hub pressure.",
      negativeFixture:
        "ts-de-01.test.ts: empty projects, runtime value imports, ordinary one-type coupling, incoming model fan-in, and excluded files do not create score pressure or diagnostics.",
      applicability:
        "ts-de-01.test.ts: empty projects are measured as neutral output with totalModules=0, no outputMetadata applicability override, and no external input dependency.",
      score:
        "ts-de-01.test.ts: score is 1 for empty/ordinary/fan-in fixtures, drops for outlier outgoing type coupling, and returns to 1 when module calibration sets penalty_weight to 0.",
      diagnostics:
        "ts-de-01.test.ts: diagnostics include warning severity, file message, absolute location, outlier threshold, counterpart data, policy decision data, stable ranking, and sanitized diagnostic cap.",
      factorLedger:
        "ts-de-01.test.ts: registered pack signal emits exclude_globs, top_n_diagnostics, and precise_module_limit config factor-ledger entries; calibration tests assert module factor provenance for visibility, severity, and penalty_weight.",
      cacheSemantics:
        "ts-de-01.test.ts and pack.test.ts: wrapped pack cache version includes the TS-DE-01 semantic cacheVersion after diagnostic-limit and fast path target-resolution semantics changed.",
      calibration:
        "ts-de-01.test.ts: project-module type-coupling policy proves visible/severity/penalty ledger attribution and diagnostic policy payloads; Pulsar self-calibration proves repo-local penalty tuning with rule IDs, factor paths, provenance, and visible score effects.",
    },
  },
  {
    id: "TS-DE-02-fan-in-fan-out",
    status: "verified",
    evidence: {
      identity:
        "ts-de-02.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-de-02.test.ts: configSchema decodes defaults, default TS/TSX test excludes are asserted, exclude_globs remove TS, TSX, and custom files from the module set, thresholds control hub detection, and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-de-02.test.ts: real module-graph fixtures count runtime import fan-in/fan-out, runtime export edges, package-local source aliases, workspace package-name imports, hub fan-in/fan-out pressure, and stable multi-hub ordering.",
      negativeFixture:
        "ts-de-02.test.ts: empty projects, type-only imports, explicit and semantic type-only re-exports, ordinary chains, and excluded TSX/custom files produce no hub pressure or diagnostics.",
      applicability:
        "ts-de-02.test.ts: empty projects are neutral with totalModules=0, diagnosticLimit preserved, no outputMetadata applicability override, and no external input dependency.",
      score:
        "ts-de-02.test.ts: score is 1 for empty/ordinary/type-only fixtures, decreases by the documented hub-share formula for known hub fixtures, and threshold lowering creates hub pressure.",
      diagnostics:
        "ts-de-02.test.ts: diagnostics include warning severity, file message, absolute location, fanIn/fanOut data, stable ranking, and sanitized diagnostic cap.",
      factorLedger:
        "ts-de-02.test.ts: registered pack signal emits exclude_globs, hub_fan_in_threshold, hub_fan_out_threshold, and top_n_diagnostics config factor-ledger entries.",
      cacheSemantics:
        "ts-de-02.test.ts and pack.test.ts: wrapped pack cache version includes the TS-DE-02 semantic cacheVersion after diagnostic-limit, package-resolution, semantic type-only export, and TSX-exclusion semantics changed.",
    },
  },
  {
    id: "TS-DE-03-propagation-cost",
    status: "verified",
    evidence: {
      identity:
        "ts-de-03.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-de-03.test.ts: configSchema decodes defaults, default TS/TSX test excludes are asserted, exclude_globs remove custom files from the module graph, small-sample threshold controls diagnostics, and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-de-03.test.ts: real module-graph and reachability fixtures count diamond reverse reach, import chains, cycles condensed through SCCs, SCCs with external dependents, package-local source aliases, workspace package-name imports, star top propagators, and high-propagation diagnostics.",
      negativeFixture:
        "ts-de-03.test.ts: trivial graphs, explicit type-only import chains, runtime and type re-export declarations, below-target star graphs, and excluded TS/TSX/custom files do not create propagation pressure or high-propagator diagnostics.",
      applicability:
        "ts-de-03.test.ts: trivial one-module projects are measured as neutral output with totalModules=1, diagnosticLimit preserved, no outputMetadata applicability override, and no external input dependency.",
      score:
        "ts-de-03.test.ts: score is 1 under target, decreases by the documented (propagationCost - target) / scale formula for a known chain fixture, and cycles contribute SCC peer reach.",
      diagnostics:
        "ts-de-03.test.ts: diagnostics include small-sample and high-propagation warning severity, compact messages, absolute locations for propagators, reverseReach/propagationCost/reachabilityMode data, stable ranking, sanitized diagnostic cap, and caps larger than the compatibility top-10 output list.",
      factorLedger:
        "ts-de-03.test.ts: registered pack signal emits exclude_globs, target, scale, small_sample_threshold, and top_n_diagnostics config factor-ledger entries.",
      cacheSemantics:
        "ts-de-03.test.ts and pack.test.ts: wrapped pack cache version includes the TS-DE-03 semantic cacheVersion after diagnostic-limit, package-resolution, and TSX-exclusion semantics changed.",
    },
  },
  {
    id: "TS-DE-04-package-dependency-health",
    status: "verified",
    evidence: {
      identity:
        "ts-de-04.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-de-04.test.ts: configSchema decodes defaults, default excludes/test globs are asserted, dependency_aliases and allow_dev_dependency_in_prod change real classification, exclude_globs suppress generated/sample/vendor packages, git-backed discovery honors ignored package manifests, and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-de-04.test.ts: real repo fixtures detect imported-but-not-declared dependencies, unused declared dependencies, direct transitive lockfile usage, devDependency imports from production files, dynamic imports, createRequire resolution, package-root tooling files, opaque bundler external declarations, and package ownership for nested manifests.",
      negativeFixture:
        "ts-de-04.test.ts: declared runtime deps, npm: protocol alias deps, DefinitelyTyped type-only deps, bundled tsup/esbuild deps including manifest entrypoints outside src, workspace deps, tsconfig path aliases/baseUrl aliases, framework virtual modules, root tooling deps in tooling/test files, and generated/sample/demo exclusions avoid false positives.",
      applicability:
        "ts-de-04.test.ts: an empty repository is measured as neutral output with missingCount=0, unusedCount=0, diagnosticLimit preserved, score 1, no diagnostics, and no external input dependency.",
      score:
        "ts-de-04.test.ts: published runtime missing dependencies hard-gate score, private/type-only/tooling/dynamic missing dependencies warn with partial score pressure, unused dependencies lower score softly, and clean fixtures score 1.",
      diagnostics:
        "ts-de-04.test.ts: diagnostics include block/warn severity, severityReason, absolute locations, stable issueKind data, compact file examples with full file payloads, issue-kind/severity ordering, and sanitized total diagnostic caps.",
      factorLedger:
        "ts-de-04.test.ts: registered pack signal emits exclude_globs, test_globs, top_n_diagnostics, dependency_aliases, and allow_dev_dependency_in_prod config factor-ledger entries.",
      cacheSemantics:
        "ts-de-04.test.ts and pack.test.ts: wrapped pack cache version includes the TS-DE-04 semantic cacheVersion after diagnostic-limit, bundled-source/opaque-external classification, and npm-alias normalization semantics changed.",
    },
  },
  {
    id: "TS-DE-05-duplicate-dependency-versions",
    status: "verified",
    requiredEvidence: ["calibration"],
    evidence: {
      identity:
        "ts-de-05.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-de-05.test.ts: configSchema decodes defaults, config top_n_diagnostics is emitted through the registered pack factor ledger, and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-de-05.test.ts: real bun/package-lock/pnpm lockfile fixtures detect transitive duplicate versions, direct workspace duplicate versions, scoped nested packages, wrapper-mediated workspace pull-in chains, and stable direct/transitive evidence kinds.",
      negativeFixture:
        "ts-de-05.test.ts: flat supported lockfiles report zero duplicate groups, score 1, no diagnostics, and unsupported lockfiles skip duplicate-version analysis without failing.",
      applicability:
        "ts-de-05.test.ts: missing lockfiles and unsupported yarn.lock fixtures return neutral output with explicit lockfileStatus/lockfileFiles metadata, score 1, and capped info diagnostics.",
      score:
        "ts-de-05.test.ts: clean and suppressed fixtures score 1, transitive duplicate fixtures lower score softly, and direct workspace duplicate fixtures produce stronger score pressure.",
      diagnostics:
        "ts-de-05.test.ts: diagnostics include severity, compact direct/transitive messages, duplicate package data, versions, direct instance counts, pull-in chains, policy decisions, and sanitized diagnostic caps including missing/unsupported lockfile cases.",
      factorLedger:
        "ts-de-05.test.ts: registered pack signal emits config.top_n_diagnostics, dependency-version policy calibration records duplicate-specific visible/penalty factor entries with module attribution, and the pack-wrapped ledger preserves those entries.",
      cacheSemantics:
        "ts-de-05.test.ts and pack.test.ts: wrapped pack cache version includes the TS-DE-05 semantic cacheVersion after diagnostic-limit and pnpm chain semantics changed.",
      calibration:
        "ts-de-05.test.ts: dependency-version policy calibration suppresses a host-SDK-owned duplicate with rule attribution, calibrationDecisions, module-sourced factor entries, score restoration, and no visible diagnostics.",
    },
  },
  {
    id: "TS-AB-01-public-export-surface",
    status: "verified",
    evidence: {
      identity:
        "ts-ab-01.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-ab-01.test.ts: configSchema decodes defaults, public_export_globs/exclude_globs/surface_threshold/top_n_diagnostics are asserted through config and factor-ledger entries, and diagnostics honor sanitized top_n_diagnostics.",
      positiveFixture:
        "ts-ab-01.test.ts: real TsProject fixtures count function/class/interface/type/const/default/export-equals exports, named re-exports, export-star re-exports, source module attribution, weighted runtime/type-only surfaces, and both default public barrel glob shapes.",
      negativeFixture:
        "ts-ab-01.test.ts: non-public helper files and excluded docs/prototype barrels produce no public export surface, no diagnostics, and score 1.",
      applicability:
        "ts-ab-01.test.ts: repositories with no matching public barrel files return empty byFile, totalPublicExports=0, no largestSurface, preserved diagnosticLimit, no outputMetadata override, score 1, and no diagnostics.",
      score:
        "ts-ab-01.test.ts: below-threshold and type-only-weighted surfaces score 1, oversized runtime surfaces lower score, threshold config changes score, and mixed fixtures prove scoring uses the worst weighted surface rather than largest raw export count.",
      diagnostics:
        "ts-ab-01.test.ts: diagnostics include warning/info severity, compact messages, file locations, total/weighted/byKind/source-module payload data, weighted-pressure ordering with raw-count tie-breaks, and sanitized diagnostic caps.",
      factorLedger:
        "ts-ab-01.test.ts: registered pack signal emits public_export_globs, exclude_globs, surface_threshold, and top_n_diagnostics config factor-ledger entries.",
      cacheSemantics:
        "ts-ab-01.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AB-01 semantic cacheVersion after diagnostic-limit and weighted-surface semantics changed.",
    },
  },
  {
    id: "TS-AB-02-unused-exports",
    status: "verified",
    requiredEvidence: ["calibration"],
    evidence: {
      identity:
        "ts-ab-02.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-ab-02.test.ts: configSchema decodes defaults and factor-ledger assertions cover exclude_globs, public_entry_globs, boundary_rules, and top_n_diagnostics with sanitized diagnostic caps.",
      positiveFixture:
        "ts-ab-02.test.ts: real TsProject/TsPackageInfo repo fixtures classify unused, internal-only, cross-module, cross-package, package manifest entrypoints, public barrels, runtime APIs, framework config files, pi extensions, destructured exports, namespace imports, dynamic imports, and alias consumers.",
      negativeFixture:
        "ts-ab-02.test.ts: public entry imports do not promote imported internals, test support/example/generated/playground exports are excluded, Convex runtime exports stay unused without calibration, and concrete namespace/dynamic import fixtures leave unrelated exports unused.",
      applicability:
        "ts-ab-02.test.ts: repositories with no exported bindings return empty exports, zero counts, no boundaryConfined entries, preserved diagnosticLimit, score 1, and no diagnostics.",
      score:
        "ts-ab-02.test.ts: empty outputs score 1 and mixed runtime/type-only/test-hook/internal-only/cross-module fixtures prove weighted unused/internal penalties are divided by total exported bindings.",
      diagnostics:
        "ts-ab-02.test.ts: diagnostics omit healthy cross-module/cross-package exports, include block/warn/info severities, boundary hashes, locations, reference files, declaration files, classification/evidence/penalty payloads, deterministic ordering, and sanitized diagnostic caps.",
      factorLedger:
        "ts-ab-02.test.ts: registered pack signal emits config.exclude_globs, config.public_entry_globs, config.boundary_rules, and config.top_n_diagnostics factor-ledger entries with score roles.",
      cacheSemantics:
        "ts-ab-02.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AB-02 semantic cacheVersion after diagnostic-limit and precise namespace/dynamic consumer semantics changed.",
      calibration:
        "ts-ab-02.test.ts: export-reachability calibration marks a Convex runtime export public with module id, processor id, action, reason, path/symbol evidence, calibrationDecisions, and cross-package classification while ordinary unused exports remain penalized.",
    },
  },
  {
    id: "TS-AB-03-type-indirection-depth",
    status: "verified",
    evidence: {
      identity:
        "ts-ab-03.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-ab-03.test.ts: configSchema decodes defaults and factor-ledger assertions cover exclude_globs, max_depth, max_traversal_steps, and top_n_diagnostics with sanitized diagnostic caps.",
      positiveFixture:
        "ts-ab-03.test.ts and ts-ab-03-regressions.test.ts: real TsProject fixtures measure simple, deep, mapped, conditional, indexed-access, import-type, typeof, utility, same-file/imported/importer-shadowed alias chains, generic alias wrappers, interface/class heritage, heritage cycles, recursive aliases, and traversal caps.",
      negativeFixture:
        "ts-ab-03.test.ts: value-only files produce no tracked declarations; generated and test declarations are excluded; shallow local helper aliases remain info-level rather than boundary warnings.",
      applicability:
        "ts-ab-03.test.ts: repositories with no tracked declarations return empty declarations/byFile/overThreshold, zero repoDistribution, preserved caps, score 1, and no diagnostics.",
      score:
        "ts-ab-03.test.ts: clean fixtures score 1 and mixed over-threshold fixtures prove score is 1 minus over-threshold declarations divided by total tracked declarations.",
      diagnostics:
        "ts-ab-03.test.ts: diagnostics include severity, compact chain messages, file/line locations, depth/exported/chain/cycle/truncated/maxDepth/traversalCap payloads, deterministic ordering, and sanitized diagnostic caps.",
      factorLedger:
        "ts-ab-03.test.ts: registered pack signal emits config.exclude_globs, config.max_depth, config.max_traversal_steps, and config.top_n_diagnostics factor-ledger entries with score roles.",
      cacheSemantics:
        "ts-ab-03.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AB-03 semantic cacheVersion after diagnostic-limit, imported alias, generic argument, heritage, alias-cache, and truncation semantics changed.",
    },
  },
  {
    id: "TS-AB-04-interface-implementation-ratio",
    status: "verified",
    evidence: {
      identity:
        "ts-ab-04.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-ab-04.test.ts: configSchema decodes defaults; factor-ledger assertions cover exclude_globs, test_globs, public_entry_globs, and top_n_diagnostics with sanitized diagnostic caps.",
      positiveFixture:
        "ts-ab-04.test.ts: real TsProject fixtures measure single implementation pairs, multiple implementations, class expressions, nested classes, same-name interface isolation, namespace-qualified references, object literal substitutes, satisfies/as/composed substitutes, public re-export chains, package-local alias public entries, and local public export lists.",
      negativeFixture:
        "ts-ab-04.test.ts: value-only files, test-only interfaces, configured exclude_globs, structural data interfaces, object defaults, interface extension, unused non-object casts, type-only cast references, consumed casts, parenthesized casts, and destructured casts prove non-contract shapes are not penalized.",
      applicability:
        "ts-ab-04.test.ts: repositories with no production interfaces return empty pairs/flaggedPairs/deadInterfaces, zero pressures, diagnosticLimit 20, score 1, no diagnostics, and not_applicable metadata.",
      score:
        "ts-ab-04.test.ts: mixed one-implementation/dead-interface fixture proves both pressures are non-zero and score is 1 minus the maximum pressure, not a sum or isolated branch.",
      diagnostics:
        "ts-ab-04.test.ts: diagnostics include warn severity, pair/dead messages, distinct interface and implementation file payloads, file/line locations, deterministic multi-pair-before-multi-dead ordering, and sanitized top_n_diagnostics caps.",
      factorLedger:
        "ts-ab-04.test.ts: registered pack signal emits config.exclude_globs, config.test_globs, config.public_entry_globs, and config.top_n_diagnostics factor-ledger entries with score roles.",
      cacheSemantics:
        "ts-ab-04.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AB-04 semantic cacheVersion after identity, substitute, diagnostic-limit, object-data, cast-usage, public-entry, and class-implementation semantics changed.",
    },
  },
  {
    id: "TS-AB-05-generic-proliferation",
    status: "verified",
    evidence: {
      identity:
        "ts-ab-05.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-ab-05.test.ts: configSchema decodes defaults; factor-ledger assertions cover exclude_globs, max_generic_parameters, and top_n_diagnostics with sanitized diagnostic caps.",
      positiveFixture:
        "ts-ab-05.test.ts: real TsProject fixtures measure function declarations, function expressions, arrows, default export arrows, methods, interface method/call/construct signatures, direct type-alias function/constructor shapes, type aliases, interfaces, classes, generic counts, nested constraints, and true return-only generics.",
      negativeFixture:
        "ts-ab-05.test.ts: value-only files produce no tracked declarations; test, declaration, and generated files are excluded; constraint/default-dependent generics are not falsely classified as return-only.",
      applicability:
        "ts-ab-05.test.ts: repositories with no tracked declarations return empty byDeclaration/overThreshold, zero distribution, preserved thresholds, score 1, and no diagnostics.",
      score:
        "ts-ab-05.test.ts: mixed two-healthy/two-over-threshold fixture proves score is 1 minus over-threshold declarations divided by total tracked declarations.",
      diagnostics:
        "ts-ab-05.test.ts: diagnostics include warn severity, declaration messages, file/line locations, generic threshold data, returnOnlyParams, deterministic ordering, and sanitized top_n_diagnostics caps.",
      factorLedger:
        "ts-ab-05.test.ts: registered pack signal emits config.exclude_globs, config.max_generic_parameters, and config.top_n_diagnostics factor-ledger entries with score roles.",
      cacheSemantics:
        "ts-ab-05.test.ts and pack.test.ts: wrapped pack cache version includes the TS-AB-05 semantic cacheVersion after signature-scope, return-only, and diagnostic-limit semantics changed.",
    },
  },
  {
    id: "TS-LD-06-annotation-coverage",
    status: "verified",
    evidence: {
      identity:
        "ts-ld-06.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-ld-06.test.ts: configSchema decodes defaults; factor-ledger assertions cover exclude_globs and top_n_diagnostics; diagnostics-cap tests cover sanitized cap behavior.",
      positiveFixture:
        "ts-ld-06.test.ts: real TsProject fixtures measure annotated/unannotated boundary functions, exported variables, named/default exports, overload signatures, exported class methods/constructors, typed and untyped exported object-literal APIs, TSX component returns, framework-owned method contracts, and contextual function types.",
      negativeFixture:
        "ts-ld-06.test.ts: real fixtures prove internal-only functions stay out of boundary score, callbacks are excluded, nested same-name declarations do not inherit export status, object literal methods returned from exported class methods stay internal, and default/custom excluded files are ignored.",
      applicability:
        "ts-ld-06.test.ts: value-only repositories and internal-only repositories produce neutral boundary coverage, score 1, and no diagnostics while preserving internal measurement where applicable.",
      score:
        "ts-ld-06.test.ts: weighted boundary score is asserted for mixed param/return coverage and for default-initialized parameters; fully annotated and no-boundary cases score 1.",
      diagnostics:
        "ts-ld-06.test.ts: diagnostics assert warn/info severity, missingKind-specific messages, file/line locations, payload data, deterministic ordering, and sanitized top_n_diagnostics caps.",
      factorLedger:
        "ts-ld-06.test.ts: registered pack signal emits config.exclude_globs and config.top_n_diagnostics factor-ledger entries with score roles.",
      cacheSemantics:
        "ts-ld-06.test.ts and pack.test.ts: wrapped pack cache version includes the TS-LD-06 semantic cacheVersion after diagnostic-limit, overload, constructor, object-boundary, contextual object-typing, and export-linkage semantics changed.",
    },
  },
  {
    id: "TS-LD-07-unsafe-type-erosion",
    status: "verified",
    requiredEvidence: ["calibration"],
    evidence: {
      identity:
        "ts-ld-07.test.ts: canonical id, alias, title, tier/category/kind, no compound inputs, semantic cacheVersion, pack registration, and registry alias lookup are asserted.",
      config:
        "ts-ld-07.test.ts: configSchema decodes defaults; factor-ledger assertions cover exclude_globs, max_weighted_unsafe_per_kloc, max_boundary_weighted_unsafe, and top_n_diagnostics; diagnostics-cap tests cover sanitized cap behavior.",
      positiveFixture:
        "ts-ld-07.test.ts: real TsProject fixtures measure boundary and internal any in parameters, returns, properties, variables, type aliases, heritage clauses, assertions, default exports, exported object APIs, value type surfaces, inline function contract type surfaces, and same-line generic arguments.",
      negativeFixture:
        "ts-ld-07.test.ts: typed source has no unsafe erosion; path names do not promote boundary status; nested same-name variables do not inherit export status; returned object literals stay internal; internal and explicitly typed assertions remain internal; default and custom excluded files are ignored.",
      applicability:
        "ts-ld-07.test.ts: empty and all-excluded repositories report analyzedFiles=0, score 1, no diagnostics, and not_applicable metadata, while analyzed typed repositories stay applicable with no metadata override.",
      score:
        "ts-ld-07.test.ts: mixed boundary/internal fixture asserts weighted unsafe totals, boundary weighted totals, density pressure, boundary pressure, and score formula 1 / (1 + max pressure).",
      diagnostics:
        "ts-ld-07.test.ts: diagnostics assert warn/info severity, message text, file/line locations, payload data, deterministic ordering, and sanitized top_n_diagnostics caps.",
      factorLedger:
        "ts-ld-07.test.ts: registered pack signal emits config.exclude_globs, max_weighted_unsafe_per_kloc, max_boundary_weighted_unsafe, and top_n_diagnostics factor-ledger entries with score roles.",
      cacheSemantics:
        "ts-ld-07.test.ts and pack.test.ts: wrapped pack cache version includes the TS-LD-07 semantic cacheVersion after diagnostic-limit, export-boundary, unique-finding-id, value type-surface, applicability, inline function-contract, boundary assertion, and test-helper exclusion semantics changed.",
      calibration:
        "ts-ld-07.test.ts: unsafe-type-policy calibration records decisions, deweights deliberate existential unsafe types, changes severity/boundary/weight, and preserves policy attribution on occurrences.",
    },
  },
  pendingSignalContract("TS-LD-08-exhaustiveness-erosion"),
  pendingSignalContract("TS-LD-09-error-channel-opacity"),
  pendingSignalContract("TS-RP-01-hotspots"),
  pendingSignalContract("TS-SL-01-duplication"),
  pendingSignalContract("TS-SL-03-suppressions"),
  pendingSignalContract("TS-SL-04-unfinished-implementations"),
  pendingSignalContract("TS-RP-02-pr-size"),
  pendingSignalContract("TS-SL-02-inconsistent-clones"),
]
