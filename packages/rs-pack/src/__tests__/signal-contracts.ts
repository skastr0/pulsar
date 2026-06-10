import type { SignalContract } from "./signal-contract.js"

export const RS_SIGNAL_CONTRACTS: ReadonlyArray<SignalContract> = [
  {
    id: "RS-AD-01-visibility-surface",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ad-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "rs-ad-signals.test.ts: default exclude globs, warn_pub_ratio, and top_n_diagnostics decode through the real schema; strict, lenient, fractional, NaN, and Infinity config values are normalized through compute output.",
      positiveFixture:
        "rs-ad-signals.test.ts: a temporary Cargo crate exercises RustProjectLayer and collectRustProjectFacts for pub, spaced and unspaced pub(crate), pub(super), pub(in path), and private items across root, public inline, and private inline modules.",
      negativeFixture:
        "rs-ad-signals.test.ts: non-Rust workspaces and fully excluded Rust source fixtures return an empty measured surface without false pressure or diagnostics.",
      applicability:
        "rs-ad-signals.test.ts: populated Rust visibility surfaces are applicable; empty or excluded visibility surfaces emit insufficient_evidence metadata.",
      score:
        "rs-ad-signals.test.ts: score is asserted against the configured average-pub-ratio threshold, and lenient vs strict thresholds change score monotonically.",
      diagnostics:
        "rs-ad-signals.test.ts: diagnostics are ordered by highest public ratio, capped by normalized top_n_diagnostics, use the configured warn threshold for severity, and expose module, location, counts, ratio, and threshold payloads.",
      factorLedger:
        "rs-ad-signals.test.ts: registered RS pack signal emits config.exclude_globs, config.warn_pub_ratio, and config.top_n_diagnostics factor entries with signal-default source; warn_pub_ratio is score-bearing threshold while diagnostics/exclusion controls remain metadata.",
      cacheSemantics:
        "rs-ad-signals.test.ts and pack.test.ts: RS-AD-01 declares visibility-surface-config-thresholds-spaced-visibility-v2 cacheVersion and the RS pack wrapper preserves it after config threshold/cap and spaced visibility parsing semantics became output-affecting.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration executes RS-AD-01 inside the RS pack against a real Cargo fixture, while the CLI category path verifies Rust signals are selected for Rust-only repositories.",
    },
  },
  {
    id: "RS-AD-02-crate-boundaries",
    status: "verified",
    requiredEvidence: ["referenceData", "integration"],
    evidence: {
      identity:
        "rs-ad-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, and default config decoding are asserted.",
      config:
        "rs-ad-signals.test.ts: default exclude_globs and top_n_diagnostics decode through the real schema; fractional, negative, and NaN diagnostic caps are normalized through compute output.",
      positiveFixture:
        "rs-ad-signals.test.ts: temporary Cargo workspace fixtures exercise RustProjectLayer and collectRustProjectFacts for cross-crate imports that produce dependent-not-allowed, non-public-target, and boundary-rule violations, including hyphenated crate roots and dependency rename aliases.",
      negativeFixture:
        "rs-ad-signals.test.ts: clean allowed imports, no Rust source, and fully excluded importing crates return neutral output without false boundary pressure.",
      applicability:
        "rs-ad-signals.test.ts: loaded Rust schema conventions with checked imports are applicable, missing or ungoverned Rust boundary conventions emit insufficient_evidence metadata, and loaded conventions with no checked imports emit not_applicable metadata.",
      score:
        "rs-ad-signals.test.ts: violating fixtures score below clean fixtures, missing reference data stays score-neutral through applicability metadata, and violation pressure is bounded by checked import count.",
      diagnostics:
        "rs-ad-signals.test.ts: diagnostics assert block severity, file/line locations, deterministic violation ordering, unique stable hash payloads for duplicate imports on different lines, missing-reference warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ad-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ad-signals.test.ts, pack.test.ts, and core scoring-engine tests: RS-AD-02 declares crate-boundary-reference-data-config-aliases-use-segments-v3 cacheVersion, config/cacheVersion changes alter the signal config hash, the RS pack wrapper preserves the version, and Tier-2 scoring cache semantics include reference-data version hashes.",
      referenceData:
        "rs-ad-signals.test.ts: direct ReferenceData fixtures and canonical `.pulsar/conventions.json` loading prove schema-conventions rust_crate_boundaries drive boundary rules, generic boundaries are not accepted as Rust boundary rules, and missing schema-conventions remains distinct from a clean pass.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes RS-AD-02 in the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-AD-02 against a repository substrate with conventions loaded from disk.",
    },
  },
  {
    id: "RS-AD-03-circular-crate-dependencies",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ad-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-ad-signals.test.ts: top_n_diagnostics decodes through the real schema and fractional, negative, and NaN diagnostic caps are normalized through compute output.",
      positiveFixture:
        "rs-ad-signals.test.ts: temporary Cargo workspace fixtures run through RustProjectLayer and real cargo metadata to produce feature-induced workspace crate cycles with optional and dev-dependency edge facts.",
      negativeFixture:
        "rs-ad-signals.test.ts: clean acyclic Cargo workspaces, missing Cargo metadata, and empty workspaces return neutral output without false cycle pressure.",
      applicability:
        "rs-ad-signals.test.ts: loaded Cargo metadata with packages is applicable, missing metadata emits insufficient_evidence metadata, and loaded metadata with no workspace packages emits not_applicable metadata.",
      score:
        "rs-ad-signals.test.ts: cycle fixtures score below clean fixtures, missing metadata stays score-neutral through applicability metadata, and additional cycles plus larger strongly connected components increase score pressure.",
      diagnostics:
        "rs-ad-signals.test.ts: diagnostics assert block severity, manifest locations, deterministic cycle span payloads, stable hash payloads from cycle edges, feature-induced status, missing-metadata warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ad-signals.test.ts: registered RS pack signal emits config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ad-signals.test.ts and pack.test.ts: RS-AD-03 declares cargo-metadata-cycles-config-v1 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes RS-AD-03 in the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-AD-03 against a repository substrate with cargo metadata loaded from disk.",
    },
  },
  {
    id: "RS-DE-01-trait-coupling",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-de-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-de-signals.test.ts: exclude_globs and top_n_diagnostics decode through the real schema and fractional, negative, and NaN diagnostic caps are normalized through compute output.",
      positiveFixture:
        "rs-de-signals.test.ts: temporary Cargo crate fixtures run through RustProjectLayer and real tree-sitter Rust parsing to classify standard-library ergonomic, serialization, framework adapter, application-external, and orphan-workaround candidate trait implementations.",
      negativeFixture:
        "rs-de-signals.test.ts: local-trait/local-type impls, no Rust source, no trait impls, and fully excluded Rust source return neutral output without false foreign-trait pressure.",
      applicability:
        "rs-de-signals.test.ts: clean local trait impls remain applicable measured passes, no Rust source emits insufficient_evidence metadata, and no trait impls or fully excluded source emit not_applicable metadata.",
      score:
        "rs-de-signals.test.ts: concerning fixtures score below clean fixtures, no evidence stays score-neutral through applicability metadata, and additional concerning impls increase score pressure without dilution by clean modules.",
      diagnostics:
        "rs-de-signals.test.ts: diagnostics assert severity, file/line locations, deterministic module ordering, checkout-root-independent stable hash payloads, trait/type/family/orphan-workaround detail payloads, missing-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-de-signals.test.ts: registered RS pack signal emits config.exclude_globs and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-de-signals.test.ts and pack.test.ts: RS-DE-01 declares trait-coupling-config-applicability-diagnostics-v1 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes dependency-entropy Rust signals in the RS pack, while CLI single-signal mode executes RS-DE-01 against a repository substrate with real Rust source parsed from disk.",
    },
  },
  {
    id: "RS-DE-02-dependency-tree",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-de-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-de-signals.test.ts: top_n_diagnostics decodes through the real schema and fractional, negative, and NaN diagnostic caps are normalized through compute output.",
      positiveFixture:
        "rs-de-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer with real Cargo.toml and Cargo.lock files to prove duplicate versions, top-level dependency depth, versionless lock dependency entries, workspace-inherited dependency aliases and package renames, and same-name/same-version packages from distinct sources.",
      negativeFixture:
        "rs-de-signals.test.ts: clean direct dependencies, missing Cargo.lock, and no-dependency lockfiles return neutral output without false dependency-tree pressure.",
      applicability:
        "rs-de-signals.test.ts: loaded lockfiles with direct dependency evidence are applicable, missing Cargo.lock emits insufficient_evidence metadata, and loaded lockfiles with no dependency evidence emit not_applicable metadata.",
      score:
        "rs-de-signals.test.ts: duplicate/depth fixtures score below clean fixtures, missing/no-dependency evidence stays score-neutral through applicability metadata, and additional duplicates, depth, and dependency breadth increase score pressure.",
      diagnostics:
        "rs-de-signals.test.ts: diagnostics assert severity, Cargo.lock locations, deterministic duplicate-before-depth ordering, checkout-root-independent stable hash payloads, duplicate/version/depth/reachability payloads, missing-lock warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-de-signals.test.ts: registered RS pack signal emits config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-de-signals.test.ts and pack.test.ts: RS-DE-02 declares cargo-lock-dependency-tree-workspace-deps-v1 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes dependency-entropy Rust signals in the RS pack, while CLI single-signal mode executes RS-DE-02 against a repository substrate with Cargo.lock parsed from disk.",
    },
  },
  {
    id: "RS-DE-03-feature-flags",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-de-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-de-signals.test.ts: exclude_globs, warn_feature_count, and top_n_diagnostics decode through the real schema; fractional, negative, and NaN threshold/cap values are normalized through compute output.",
      positiveFixture:
        "rs-de-signals.test.ts: temporary Cargo workspaces run through RustProjectLayer and real cargo metadata to prove feature counts, cfg(feature) conditional sites, local feature references, dep: optional dependency activation, dependency/feature propagation, dependency?/feature weak propagation, and renamed dependency aliases.",
      negativeFixture:
        "rs-de-signals.test.ts: clean no-feature crates, missing cargo metadata, and excluded source files return neutral output without false feature-complexity pressure.",
      applicability:
        "rs-de-signals.test.ts: loaded feature surfaces are applicable, missing cargo metadata emits insufficient_evidence metadata, and loaded crates with no feature/cfg evidence emit not_applicable metadata.",
      score:
        "rs-de-signals.test.ts: feature/propagation/cfg fixtures score below clean fixtures, missing/no evidence stays score-neutral through applicability metadata, stricter warn_feature_count lowers score, and additional feature definitions, propagations, and cfg sites increase score pressure.",
      diagnostics:
        "rs-de-signals.test.ts: diagnostics assert severity, manifest locations, deterministic feature-pressure ordering, checkout-root-independent stable hash payloads, feature/propagation/cfg payloads, missing-metadata warning payloads, configured warn thresholds, and normalized diagnostic caps.",
      factorLedger:
        "rs-de-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-affecting evidence, config.warn_feature_count as a score-bearing threshold, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-de-signals.test.ts and pack.test.ts: RS-DE-03 declares cargo-feature-flags-config-propagation-v1 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes dependency-entropy Rust signals in the RS pack, while CLI single-signal mode executes RS-DE-03 against a repository substrate with Cargo metadata and Rust source parsed from disk.",
    },
  },
  {
    id: "RS-DE-04-fan-in-fan-out",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-de-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-de-signals.test.ts: exclude_globs, hub_fan_in_threshold, hub_fan_out_threshold, and top_n_diagnostics decode through the real schema; fractional, negative, and NaN thresholds/caps are normalized through compute output.",
      positiveFixture:
        "rs-de-signals.test.ts: temporary Cargo crate fixtures run through RustProjectLayer and real Rust source parsing to prove explicit crate/self/super and repeated-super local use resolution, grouped imports, wildcard imports, multi-file modules, fan-in, fan-out, hub detection, and resolved-edge counting.",
      negativeFixture:
        "rs-de-signals.test.ts: clean low-coupling crates, crates with no local use edges, external-only imports, missing Rust source, fully excluded Rust source, and excluded target modules return neutral output without false hub pressure.",
      applicability:
        "rs-de-signals.test.ts: loaded Rust source with local use evidence is applicable, no Rust source emits insufficient_evidence metadata, and loaded source with no resolved local edges or no analyzed modules emits not_applicable metadata.",
      score:
        "rs-de-signals.test.ts: hub fixtures score below clean fixtures, missing/no-use/excluded evidence stays score-neutral through applicability metadata, stricter hub thresholds lower scores, and additional hub fan-in/fan-out pressure lowers scores monotonically at fixed module count.",
      diagnostics:
        "rs-de-signals.test.ts: diagnostics assert severity, source locations, deterministic hub ordering, checkout-root-independent stable hash payloads, hub fan-in/fan-out/pressure payloads, configured threshold payloads, no-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-de-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-affecting evidence, hub fan-in/fan-out thresholds as score-bearing thresholds, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-de-signals.test.ts and pack.test.ts: RS-DE-04 declares rust-use-fan-in-out-config-v2 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes dependency-entropy Rust signals in the RS pack, while CLI single-signal mode executes RS-DE-04 against a repository substrate with Rust source parsed from disk.",
    },
  },
  {
    id: "RS-AB-01-unused-public-items",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ab-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-ab-signals.test.ts: exclude_globs and top_n_diagnostics decode through the real schema and fractional plus NaN diagnostic caps are normalized through compute output.",
      positiveFixture:
        "rs-ab-signals.test.ts: temporary Cargo workspace fixtures run through RustProjectLayer and real Rust source parsing to prove internal over-public items, exported root API, non-library public items, cross-crate public usage, dependency aliases, hyphenated crate identifiers, direct pub reexports, wildcard pub reexports, private reexports, and full public module-chain classification.",
      negativeFixture:
        "rs-ab-signals.test.ts: clean exported API, missing Rust source, private-only crates with and without cargo metadata, and fully excluded Rust source return neutral output without false unused-public pressure.",
      applicability:
        "rs-ab-signals.test.ts: loaded Rust source with public item evidence is applicable, no Rust source and missing cargo metadata with public item evidence emit insufficient_evidence metadata, and loaded source with no public items or no analyzed source emits not_applicable metadata.",
      score:
        "rs-ab-signals.test.ts: unused-public fixtures score below clean fixtures, missing/no-public/excluded evidence stays score-neutral through applicability metadata, and additional dead public items at fixed public item count lower scores monotonically.",
      diagnostics:
        "rs-ab-signals.test.ts: diagnostics assert severity, source locations, deterministic location ordering, stable hash payloads, item/surface/reexport/cross-crate payloads, no-source and missing-metadata warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ab-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-affecting evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ab-signals.test.ts and pack.test.ts: RS-AB-01 declares rs-ab-01-public-surface-use-segments-aliases-diagnostics-reexports-private-visibility-chain-metadata-applicability-v10 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes RS-AB-01 in the abstraction-bloat category, while CLI single-signal mode executes RS-AB-01 against a repository substrate with Rust source parsed from disk.",
    },
  },
  {
    id: "RS-AB-02-trait-object-depth",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ab-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-ab-signals.test.ts: exclude_globs, max_chain_depth, and top_n_diagnostics decode through the real schema; fractional and NaN threshold/cap values are normalized through compute output.",
      positiveFixture:
        "rs-ab-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real Rust parsing to prove dyn-return function discovery, local call-chain depth, scoped crate/self/super/relative calls, generic function calls, self method calls with impl-owner context, duplicate same-name functions, composite cfg test gates, and recursive-cycle bounding.",
      negativeFixture:
        "rs-ab-signals.test.ts: missing Rust source, no dyn-return functions, fully excluded Rust source, composite cfg test-gated dyn functions, and unresolved arbitrary receiver calls return neutral output without false trait-object depth pressure.",
      applicability:
        "rs-ab-signals.test.ts: loaded Rust source with dyn-return function evidence is applicable, no Rust source emits insufficient_evidence metadata, and loaded source with no dyn-return functions or no analyzed source emits not_applicable metadata.",
      score:
        "rs-ab-signals.test.ts: over-threshold chain fixtures score below clean/no-evidence fixtures, stricter max_chain_depth lowers scores, and recursive cycles are bounded to finite unique path length rather than inflated by cycle-back edges.",
      diagnostics:
        "rs-ab-signals.test.ts: diagnostics assert severity, source locations, deterministic depth ordering, function/module/return/callee payloads, no-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ab-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-affecting evidence, config.max_chain_depth as a score-bearing threshold, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ab-signals.test.ts and pack.test.ts: RS-AB-02 declares trait-object-depth-config-applicability-diagnostics-scoped-calls-cfg-test-gating-cycles-v4 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes RS-AB-02 in the abstraction-bloat category, while CLI single-signal mode executes RS-AB-02 against a repository substrate with Rust source parsed from disk.",
    },
  },
  {
    id: "RS-AB-03-generic-proliferation",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ab-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-ab-signals.test.ts: exclude_globs, max_generic_parameters, max_generic_complexity, and top_n_diagnostics decode through the real schema; fractional and NaN threshold/cap values are normalized through compute output.",
      positiveFixture:
        "rs-ab-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove generic functions, structs, enums, traits, type aliases, impl generics, lifetime parameters, const parameters, where predicates, type-parameter bounds, trait supertraits, scoped bounds, removed trait bounds, higher-ranked trait bounds, associated type bounds, and nested generic arguments.",
      negativeFixture:
        "rs-ab-signals.test.ts: missing Rust source, no generic declarations, fully excluded Rust source, and composite cfg test-gated generic declarations return neutral output without false generic proliferation pressure.",
      applicability:
        "rs-ab-signals.test.ts: loaded Rust source with generic declaration evidence is applicable, no Rust source emits insufficient_evidence metadata, and loaded source with no generic declarations or no analyzed source emits not_applicable metadata.",
      score:
        "rs-ab-signals.test.ts: parameter-count and generic-complexity fixtures score below clean fixtures, stricter max_generic_parameters and max_generic_complexity thresholds lower scores monotonically, and relaxed complexity thresholds remove complexity-only pressure without hiding parameter pressure.",
      diagnostics:
        "rs-ab-signals.test.ts: diagnostics assert severity, source locations, deterministic declaration ordering, module/param/where/bound/complexity payloads, exceeded-threshold payloads, no-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ab-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-affecting evidence, max_generic_parameters and max_generic_complexity as score-bearing thresholds, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ab-signals.test.ts and pack.test.ts: RS-AB-03 declares generic-proliferation-config-applicability-diagnostics-cfg-test-gating-bounds-complexity-v4 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes RS-AB-03 in the abstraction-bloat category, while CLI single-signal mode executes RS-AB-03 against a repository substrate with Rust source parsed from disk.",
    },
  },
  {
    id: "RS-AB-04-derive-density",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ab-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, and default config decoding are asserted.",
      config:
        "rs-ab-signals.test.ts: exclude_globs, max_custom_derives, max_derive_count, and top_n_diagnostics decode through the real schema; fractional and NaN threshold/cap values are normalized through compute output.",
      positiveFixture:
        "rs-ab-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove struct, enum, union, zero-derive tracked types, standard derives, custom derives, path-qualified derives, multiple direct derive attributes, cfg_attr feature derives, and non-test cfg_attr derives.",
      negativeFixture:
        "rs-ab-signals.test.ts: missing Rust source, no derive-bearing tracked types, fully excluded Rust source, cfg test-gated derived types, cfg_attr test-gated derives, and composite test cfg_attr derives return neutral/no false derive pressure.",
      applicability:
        "rs-ab-signals.test.ts: loaded Rust source with derive-bearing tracked types is applicable, no Rust source emits insufficient_evidence metadata, and loaded source with no tracked types, no derive-bearing tracked types, or no analyzed source emits not_applicable metadata.",
      score:
        "rs-ab-signals.test.ts: total derive-count and custom-derive fixtures score below clean tracked types, stricter max_derive_count and max_custom_derives thresholds lower scores, and relaxed thresholds remove threshold pressure.",
      diagnostics:
        "rs-ab-signals.test.ts: diagnostics assert severity, source locations, deterministic derive-pressure ordering, module/derive/custom/threshold payloads, exceeded-threshold payloads, no-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ab-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-affecting evidence, max_custom_derives and max_derive_count as score-bearing thresholds, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ab-signals.test.ts and pack.test.ts: RS-AB-04 declares derive-density-config-applicability-diagnostics-cfg-attr-thresholds-v4 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration includes RS-AB-04 in the abstraction-bloat category, while CLI single-signal mode executes RS-AB-04 against a repository substrate with Rust source parsed from disk.",
    },
  },
  {
    id: "RS-LD-01-unsafe-code",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ld-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, safe-only selector mode, and diagnostic cap policy are asserted.",
      config:
        "rs-ld-signals.test.ts: exclude_globs, safe_only_modules, and top_n_diagnostics decode through the real schema; fractional, NaN, and zero diagnostic caps are normalized through compute output; safe_only_modules selectors are normalized and applied as module-subtree selectors.",
      positiveFixture:
        "rs-ld-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove unsafe blocks, unsafe functions, local call-chain propagation, qualified call propagation before ambiguous bare-name fallback, unsafe trait declarations, unsafe impls, unsafe trait method signatures, foreign function declarations, static mut declarations, and hyphenated crate/nested module safe-only matching.",
      negativeFixture:
        "rs-ld-signals.test.ts: clean no-unsafe functions, missing Rust source, no-function Rust source, fully excluded Rust source, tests/ excluded unsafe source, cfg(test) unsafe functions, and composite cfg(any(test,...)) unsafe functions return neutral or excluded evidence without false unsafe pressure.",
      applicability:
        "rs-ld-signals.test.ts: loaded Rust source with unsafe evidence is applicable, no Rust source emits insufficient_evidence metadata, and analyzed Rust source with no functions/no unsafe sites or fully excluded source emits not_applicable metadata.",
      score:
        "rs-ld-signals.test.ts: score is asserted as one-minus-max-propagation-share-or-capped-site-share, safe-only violations hard-gate to zero, clean fixtures score 1, additional unsafe-bearing functions lower scores monotonically, and additional unsafe sites increase capped site pressure without reporting impossible percentages.",
      diagnostics:
        "rs-ld-signals.test.ts: diagnostics assert safe-only block severity and deterministic ordering, safe-only block diagnostics remain uncapped while warning diagnostics obey top_n_diagnostics, module-subtree selector payloads include matched selectors, unsafe surface warnings expose site kind/name/function/module/file/line samples, kind counts, propagation share, sites/function pressure, no-source warning payloads, and cap-policy metadata.",
      factorLedger:
        "rs-ld-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence, config.safe_only_modules as a score-bearing threshold, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ld-signals.test.ts and pack.test.ts: RS-LD-01 declares unsafe-code-config-applicability-diagnostics-call-graph-density-sites-safe-only-qualified-v6 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-LD-01 unsafe score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-LD-01 against the repository substrate through both source and compiled CLI entrypoints.",
    },
  },
  {
    id: "RS-LD-02-lifetime-complexity",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ld-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-ld-signals.test.ts: exclude_globs, max_lifetime_complexity, and top_n_diagnostics decode through the real schema; fractional, NaN, and zero diagnostic caps or thresholds are normalized through compute output.",
      positiveFixture:
        "rs-ld-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove lifetime parameters, parameter and where-clause bounds, input positions, output positions, constraint positions, lifetime-bearing function counts, by-file summaries, and threshold exceedance evidence.",
      negativeFixture:
        "rs-ld-signals.test.ts: missing Rust source, functions without explicit lifetime evidence, fully excluded Rust source, cfg(test) lifetime functions, and composite cfg(any(test,...)) lifetime functions return neutral or excluded evidence without false lifetime pressure.",
      applicability:
        "rs-ld-signals.test.ts: loaded Rust source with lifetime-bearing function evidence is applicable, no Rust source emits insufficient_evidence metadata, and analyzed Rust source with no explicit lifetimes or fully excluded source emits not_applicable metadata.",
      score:
        "rs-ld-signals.test.ts: score is asserted as one-minus double-weighted over-threshold lifetime-function share, with denominator named as lifetime-bearing functions; clean/no-evidence and under-threshold fixtures score 1, one-over-four scores 0.5, two-over-four scores 0, and stricter max_lifetime_complexity lowers the same fixture's score.",
      diagnostics:
        "rs-ld-signals.test.ts: diagnostics assert severity, source locations, deterministic complexity ordering, function/module/lifetime-count payloads, configured threshold payloads, score mode and denominator payloads, no-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ld-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence, config.max_lifetime_complexity as a score-bearing threshold, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ld-signals.test.ts and pack.test.ts: RS-LD-02 declares lifetime-complexity-config-applicability-diagnostics-cfg-test-score-v3 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-LD-02 lifetime score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-LD-02 against the repository substrate through both source and compiled CLI entrypoints.",
    },
  },
  {
    id: "RS-LD-03-match-catch-all",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ld-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-ld-signals.test.ts: exclude_globs, core_logic_globs, and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic caps are normalized through compute output; core_logic_globs limits the analyzed source substrate.",
      positiveFixture:
        "rs-ld-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove match expressions, underscore catch-all arms, guarded underscore arms, lower-case binding catch-all arms, guarded binding arms, catch-all arm counts, match counts, scoped file analysis, and diagnostic payloads.",
      negativeFixture:
        "rs-ld-signals.test.ts: clean explicit match arms, missing Rust source, no-match Rust source, fully excluded Rust source, cfg(test) catch-all matches, composite cfg(any(test,...)) catch-all matches, and non-catch-all path patterns return neutral or excluded evidence without false catch-all pressure.",
      applicability:
        "rs-ld-signals.test.ts: loaded Rust source with analyzed match expressions is applicable, no Rust source emits insufficient_evidence metadata, and analyzed Rust source with no match expressions or fully excluded source emits not_applicable metadata.",
      score:
        "rs-ld-signals.test.ts: score is asserted as one-minus closed-domain catch-all match share (1x, open-domain literal matches exempt as compiler-mandated wildcards, guarded arms not counted), with denominator named as analyzed match expressions; clean fixtures score 1 and additional catch-all-bearing matches lower scores monotonically.",
      diagnostics:
        "rs-ld-signals.test.ts: diagnostics assert severity, source locations, deterministic catch-all count ordering, function/module/match-arm payloads, score mode and denominator payloads, no-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ld-signals.test.ts: registered RS pack signal emits config.exclude_globs and config.core_logic_globs as score-bearing evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ld-signals.test.ts and pack.test.ts: RS-LD-03 declares match-catch-all-open-domain-guarded-arms-v5-byte-literals cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-LD-03 catch-all score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-LD-03 against the repository substrate through both source and compiled CLI entrypoints.",
    },
  },
  {
    id: "RS-LD-04-error-granularity",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ld-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-ld-signals.test.ts: exclude_globs and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic caps are normalized through compute output.",
      positiveFixture:
        "rs-ld-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove public Result-returning boundary functions, granular concrete error types, collapsed anyhow/String/&str/boxed dyn Error surfaces, anyhow::Result and eyre::Result aliases, explicit error slots on Result aliases, renamed imported error aliases, plain imported error names, grouped and nested grouped imported names, relative and chained relative re-export aliases, imported Result aliases, local Result type aliases, error-slot alias chains, module-scoped alias shadowing, block-local alias isolation, opaque impl Error surfaces, std::result::Result paths, score shares, and diagnostic payloads.",
      negativeFixture:
        "rs-ld-signals.test.ts: clean granular Result functions, missing Rust source, no-Result Rust source, fully excluded Rust source, cfg(test) collapsed Result functions, composite cfg(any(test,...)) collapsed Result functions, and concrete path-qualified error types return neutral or excluded evidence without false collapsed pressure.",
      applicability:
        "rs-ld-signals.test.ts: loaded Rust source with public Result boundary evidence is applicable, no Rust source emits insufficient_evidence metadata, and analyzed Rust source with no public Result boundaries or fully excluded source emits not_applicable metadata.",
      score:
        "rs-ld-signals.test.ts: score is asserted as granular result boundary share, with denominator named as public Result boundary functions; all-granular fixtures score 1, one-collapsed/two-total scores 0.5, two-collapsed/three-total scores one third, and additional collapsed boundaries lower scores monotonically.",
      diagnostics:
        "rs-ld-signals.test.ts: diagnostics assert severity, source locations, deterministic boundary ordering, function/module/error-type/classification payloads, score mode and denominator payloads, no-source warning payloads, and normalized diagnostic caps.",
      factorLedger:
        "rs-ld-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ld-signals.test.ts and pack.test.ts: RS-LD-04 declares error-granularity-uniform-posture-floor-v13 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-LD-04 error granularity score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-LD-04 against the repository substrate through both source and compiled CLI entrypoints.",
    },
  },
  {
    id: "RS-LD-05-cyclomatic-complexity",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-ld-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-ld-signals.test.ts: exclude_globs, max_complexity, and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic/threshold config values are normalized through compute output.",
      positiveFixture:
        "rs-ld-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove base complexity, if/else branches, boolean operator branches, match-arm branches, lexical nested function and closure boundaries, by-file summaries, score shares, diagnostics, and cfg(test) exclusion.",
      negativeFixture:
        "rs-ld-signals.test.ts: missing Rust source, Rust source with no functions, fully excluded Rust source, and cfg(test)/cfg(any(test,...)) functions return neutral or excluded evidence without false complexity pressure.",
      applicability:
        "rs-ld-signals.test.ts: loaded Rust source with analyzed functions is applicable, no Rust source emits insufficient_evidence metadata, and analyzed Rust source with no functions or fully excluded source emits not_applicable metadata.",
      score:
        "rs-ld-signals.test.ts: score is asserted as double-weighted over-threshold analyzed-function share, with denominator named as analyzed functions; no-function fixtures score 1 and two-over-four functions scores 0.",
      diagnostics:
        "rs-ld-signals.test.ts: diagnostics assert severity, source locations, deterministic complexity ordering, function/module/complexity payloads, normalized diagnostic caps, score mode, and denominator payloads.",
      factorLedger:
        "rs-ld-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence, config.max_complexity as score-bearing threshold, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ld-signals.test.ts and pack.test.ts: RS-LD-05 declares cyclomatic-complexity-config-applicability-diagnostics-cfg-test-lexical-v2 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-LD-05 cyclomatic complexity score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-LD-05 against the repository substrate through both source and compiled CLI entrypoints.",
    },
  },
  {
    id: "RS-LD-06-domain-term-consistency",
    status: "verified",
    requiredEvidence: ["referenceData", "integration"],
    evidence: {
      identity:
        "rs-ld-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-ld-signals.test.ts: exclude_globs and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic caps are normalized through compute output.",
      positiveFixture:
        "rs-ld-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove item/function/parameter identifiers, canonical glossary matches, alias phrase matches, all-known-token compositions, duplicate canonical token order, near-miss canonical conflicts, new-unique identifiers, deterministic score shares, and diagnostic payloads.",
      negativeFixture:
        "rs-ld-signals.test.ts: missing Rust source, Rust source with no identifiers, fully excluded source, missing glossary, empty glossary, and cfg(test)/cfg(any(test,...)) identifiers return neutral or excluded evidence without false domain-term drift pressure.",
      applicability:
        "rs-ld-signals.test.ts: loaded Rust source with non-empty glossary and identifiers is applicable, missing or empty glossary and no Rust source emit insufficient_evidence metadata, and analyzed Rust source with no identifiers or fully excluded source emits not_applicable metadata.",
      score:
        "rs-ld-signals.test.ts: score is asserted as weighted domain-term drift pressure over classified identifiers, with conflicts weighted 0.8, duplicate canonical order weighted 0.5, new unique terms weighted 0.2, and missing/empty/no-identifier fixtures remaining score-neutral.",
      diagnostics:
        "rs-ld-signals.test.ts: diagnostics assert severity, source locations, deterministic pressure ordering, identifier/module/kind/classification/suggested-canonical payloads, normalized diagnostic caps, missing-glossary warnings, empty-glossary warnings, score mode, and denominator payloads.",
      factorLedger:
        "rs-ld-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-ld-signals.test.ts and pack.test.ts: RS-LD-06 declares domain-terms-config-reference-data-applicability-diagnostics-cfg-test-aliases-v4 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      referenceData:
        "rs-ld-signals.test.ts, observer-integration.test.ts, and CLI score tests: direct ReferenceData fixtures and canonical `.pulsar/glossary.json` loading prove glossary terms and aliases drive domain-term classification, while missing and empty glossary data remain insufficient evidence rather than clean or failing evidence.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-LD-06 domain term score and diagnostics through the RS pack against a real Cargo fixture with glossary reference data, while CLI single-signal mode executes RS-LD-06 against a repository substrate with `.pulsar/glossary.json` loaded from disk.",
    },
  },
  {
    id: "RS-SL-01-duplication",
    status: "verified",
    requiredEvidence: ["gitContext", "integration"],
    evidence: {
      identity:
        "rs-sl-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-sl-signals.test.ts: exclude_globs, min_tokens, and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic/threshold config values are normalized through compute output.",
      positiveFixture:
        "rs-sl-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove body-level exact duplicate groups, identifier-normalized structural duplicate groups, changed-hunk duplicate grouping, module/function/line/member payloads, score shares, and diagnostics.",
      negativeFixture:
        "rs-sl-signals.test.ts: missing Rust source, Rust source with no functions, fully excluded Rust source, cfg(test) duplicate functions, structural-only boilerplate pressure, and helper-scale exact clones return neutral or bounded evidence without false whole-tree collapse.",
      applicability:
        "rs-sl-signals.test.ts: loaded Rust source with analyzed functions is applicable, no Rust source emits insufficient_evidence metadata, and analyzed Rust source with no functions or fully excluded source emits not_applicable metadata.",
      score:
        "rs-sl-signals.test.ts: score is asserted as bounded duplicate-function pressure over analyzed functions, with large exact duplicate pressure lowering score monotonically, helper-scale exact clones below the scoring token floor remaining neutral, and structural-only pressure capped above 0.8.",
      diagnostics:
        "rs-sl-signals.test.ts: diagnostics assert severity, source locations, deterministic group ordering, duplicate kind/token/member/scope/analysis payloads, normalized diagnostic caps, no-source warnings, score mode, and denominator payloads.",
      factorLedger:
        "rs-sl-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence, config.min_tokens as score-bearing threshold, and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-sl-signals.test.ts and pack.test.ts: RS-SL-01 declares advisory-rust-duplication-cfg-test-diagnostics-changed-hunks-body-v5 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      gitContext:
        "rs-sl-signals.test.ts: runSignalComputeWithContext supplies changedHunks against a real Rust fixture and proves a changed function that duplicates an unchanged existing function is detected with both members preserved and changed flags attributed.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-SL-01 duplication score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-SL-01 against the repository substrate through the source CLI path.",
    },
  },
  {
    id: "RS-SL-02-suppressions",
    status: "verified",
    requiredEvidence: ["gitContext", "integration"],
    evidence: {
      identity:
        "rs-sl-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-sl-signals.test.ts: exclude_globs and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic config values are normalized through compute output.",
      positiveFixture:
        "rs-sl-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove governed allow classification for broad lint groups and slop-hiding lints, cfg_attr-wrapped allow syntax, comment-bearing allow lint lists, mixed ordinary/governed lint payloads, active/expired/missing pulsar-allow status, module/line/location evidence, and diagnostic severity.",
      negativeFixture:
        "rs-sl-signals.test.ts: narrow ordinary Rust allow attributes, no Rust source, fully excluded Rust source, and cfg(test)-gated governed allows remain neutral or not applicable without false production suppression evidence.",
      applicability:
        "rs-sl-signals.test.ts: loaded Rust source is applicable even when no governed allow exists, no Rust source emits insufficient_evidence metadata, and fully excluded Rust source emits not_applicable metadata.",
      score:
        "rs-sl-signals.test.ts: score is asserted as governed-allow-debt, active governed allows lower score monotonically with bounded pressure, and missing or expired governance drives score to zero.",
      diagnostics:
        "rs-sl-signals.test.ts: diagnostics assert block/info severity, source locations, deterministic ordering, governed/ordinary lint payloads, justification status, normalized diagnostic caps, no-source warnings, score mode, and denominator payloads.",
      factorLedger:
        "rs-sl-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-sl-signals.test.ts and pack.test.ts: RS-SL-02 declares unused-allows-ordinary-diagnostics-cfg-attr-span-v4 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      gitContext:
        "rs-sl-signals.test.ts: runSignalComputeWithContext supplies changedHunks against real Rust fixtures and proves only changed allow-attribute evidence is emitted with changed-hunks scope metadata, including multiline allow attributes whose full attribute span overlaps the hunk.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-SL-02 suppression score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-SL-02 against the repository substrate through the source CLI path.",
    },
  },
  {
    id: "RS-SL-03-unwrap-expect",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-sl-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-sl-signals.test.ts: exclude_globs and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic config values are normalized through compute output.",
      positiveFixture:
        "rs-sl-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove method-call unwrap/expect usage, UFCS unwrap/expect usage, module attribution, per-module density, diagnostics, and score pressure.",
      negativeFixture:
        "rs-sl-signals.test.ts: cfg(test)-gated unwrap/expect calls and functions, non-test cfg strings such as feature = \"test\", macros, comments, strings, no Rust source, fully excluded Rust source, and Rust source with no functions remain correctly classified without false unwrap/expect evidence loss or gain.",
      applicability:
        "rs-sl-signals.test.ts: loaded Rust source with analyzed functions is applicable, no Rust source emits insufficient_evidence metadata, and fully excluded or functionless Rust source emits not_applicable metadata.",
      score:
        "rs-sl-signals.test.ts: score is asserted as bounded unwrap/expect density over analyzed functions per module, with mild, risky, and broad usage lowering score monotonically while preserving the bounded floor.",
      diagnostics:
        "rs-sl-signals.test.ts: diagnostics assert severity, module/file payloads, unwrap/expect counts, density, normalized diagnostic caps, no-source warnings, score mode, and denominator payloads.",
      factorLedger:
        "rs-sl-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-sl-signals.test.ts and pack.test.ts: RS-SL-03 declares advisory-density-scaled-cfg-test-gating-diagnostics-denominator-ufcs-cfg-predicate-v6 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-SL-03 unwrap/expect score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-SL-03 against the repository substrate through the source CLI path.",
    },
  },
  {
    id: "RS-SL-04-clone-abuse",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-sl-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, config-cache hash sensitivity, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-sl-signals.test.ts: exclude_globs and top_n_diagnostics decode through the real schema; fractional and NaN diagnostic config values are normalized through compute output.",
      positiveFixture:
        "rs-sl-signals.test.ts: temporary Cargo fixtures run through RustProjectLayer and real tree-sitter Rust parsing to prove syntax-likely expensive clone expressions, local owned Vec/String binding clones, UFCS Clone::clone and typed <Vec as Clone>::clone calls, module attribution, per-module density, diagnostics, and score pressure.",
      negativeFixture:
        "rs-sl-signals.test.ts: cheap Arc/Rc-style shared clones, &str reference clones, cheap-clone-dominated modules, cfg(test)-gated clones/functions, no Rust source, fully excluded Rust source, Rust source with no functions, strings/comments/macros outside call expressions, and functionless Rust source remain correctly classified without false clone pressure.",
      applicability:
        "rs-sl-signals.test.ts: loaded Rust source with analyzed functions is applicable, no Rust source emits insufficient_evidence metadata, and fully excluded or functionless Rust source emits not_applicable metadata.",
      score:
        "rs-sl-signals.test.ts: score is asserted as bounded likely-expensive-clone pressure, cheap clone-only output remains neutral, mild/risky/broad likely-expensive clone counts lower scores monotonically, and the bounded score floor is asserted.",
      diagnostics:
        "rs-sl-signals.test.ts: diagnostics assert severity, module/file payloads, coherent dual-count messages reporting total clone calls alongside the likely-expensive subset that drives score, per-module and repo-wide clone count payloads enabling score reconstruction, density, normalized diagnostic caps, density ordering before truncation, no-source warnings, score mode, and denominator payloads.",
      factorLedger:
        "rs-sl-signals.test.ts: registered RS pack signal emits config.exclude_globs as score-bearing evidence and config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-sl-signals.test.ts and pack.test.ts: RS-SL-04 declares likely-expensive-score-cfg-test-gating-diagnostics-denominator-bindings-ufcs-coherent-counts-v7 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-SL-04 clone score and diagnostics through the RS pack against a real Cargo fixture, while CLI single-signal mode executes RS-SL-04 against the repository substrate through the source CLI path.",
    },
  },
  {
    id: "RS-RP-01-hotspots",
    status: "verified",
    requiredEvidence: ["compoundInputs", "integration"],
    evidence: {
      identity:
        "rs-rp-signals.test.ts: canonical id, alias, title, tier/category/kind, semantic cacheVersion, pack registration, registry alias lookup, default config decoding, compound input declarations, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-rp-signals.test.ts: top_n, min_churn, and min_complexity decode through the real schema; fractional and NaN config values are normalized through compute output.",
      positiveFixture:
        "rs-rp-signals.test.ts: canonical and alias compound-input fixtures combine RS-LD-05 byFile max complexity with SHARED-CHURN-01 file churn to produce ranked Rust hotspot files with churn, complexity, hotspotScore, quadrant, and rank evidence.",
      negativeFixture:
        "rs-rp-signals.test.ts: missing required compound inputs, non-overlapping churn/complexity file paths, churn-only/complexity-only facts, and below-threshold aligned files avoid false hotspot pressure.",
      applicability:
        "rs-rp-signals.test.ts: missing required primitive inputs emit insufficient_evidence metadata, present inputs with no aligned churn plus complexity files emit not_applicable metadata, and measured clean inputs remain applicable with score 1.",
      score:
        "rs-rp-signals.test.ts: score is asserted as bounded hotspot pressure over aligned churn-complexity files; clean, mild, and broad aligned hotspot fixtures prove monotonic score pressure.",
      diagnostics:
        "rs-rp-signals.test.ts: diagnostics assert severity, deterministic hotspotScore then path ordering, normalized top_n caps, hotspot payloads, missing-input warnings, score mode, and denominator payloads.",
      factorLedger:
        "rs-rp-signals.test.ts: registered RS pack signal emits config.top_n as non-score-bearing metadata and min_churn/min_complexity as score-bearing thresholds with signal-default source.",
      cacheSemantics:
        "rs-rp-signals.test.ts and pack.test.ts: RS-RP-01 declares rust-hotspot-config-compound-applicability-ranking-v2 cacheVersion, config/cacheVersion/compound input policy changes alter the signal config hash, the RS pack wrapper preserves the cacheVersion, and both compound inputs declare cache fingerprints.",
      compoundInputs:
        "rs-rp-signals.test.ts: buildRegistry requires RS-LD-05-cyclomatic-complexity and SHARED-CHURN-01-recent-churn input signals, verifies composite input fingerprints, and compute tests assert the explanation records present or missing primitive input states.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration runs RS-RP-01 through the RS pack using real RS-LD-05 complexity and SHARED-CHURN-01 git churn inputs from a committed Cargo fixture, while CLI single-signal mode executes RS-RP-01 against the repository substrate through the source CLI path.",
    },
  },
  {
    id: "RS-RP-02-compile-time",
    status: "verified",
    requiredEvidence: ["integration"],
    evidence: {
      identity:
        "rs-rp-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, pack registration, registry alias lookup, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-rp-signals.test.ts: top_n_diagnostics and measure_live_builds decode through the real schema; fractional and NaN diagnostic cap values are normalized through compute output.",
      positiveFixture:
        "rs-rp-signals.test.ts: temporary Cargo fixtures with existing target/cargo-timings/cargo-timing.html files exercise real RustProjectLayer and parse multiple cargo timing units per crate, grouped duration, unit count, cascade impact, deterministic crate ranking, workspace crate presence, and nested-manifest timing report discovery.",
      negativeFixture:
        "rs-rp-signals.test.ts: missing timing reports, invalid UNIT_DATA payloads, no Cargo project workspaces, failed live builds with stale timing reports, unavailable output, and measured empty timing output avoid false compile-time pressure.",
      applicability:
        "rs-rp-signals.test.ts: missing or invalid cargo timing data emits insufficient_evidence metadata, no Cargo project emits not_applicable metadata, and measured timing reports remain applicable.",
      score:
        "rs-rp-signals.test.ts: score is asserted as slowest-crate compile-duration pressure; unavailable and empty measured outputs stay neutral while slower measured compile hotspots lower scores monotonically.",
      diagnostics:
        "rs-rp-signals.test.ts: diagnostics assert severity, normalized top_n_diagnostics caps, missing-data warnings, crate timing payloads, cache probe mode, measurement mode, score mode, and denominator payloads.",
      factorLedger:
        "rs-rp-signals.test.ts: registered RS pack signal emits config.top_n_diagnostics as non-score-bearing metadata and config.measure_live_builds as score-bearing evidence with signal-default source.",
      cacheSemantics:
        "rs-rp-signals.test.ts and pack.test.ts: RS-RP-02 declares cargo-timings-config-applicability-diagnostics-live-build-nested-v2 cacheVersion, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-RP-02 compile-time score and diagnostics through the RS pack against a real Cargo fixture with cargo timing HTML, while CLI single-signal mode executes RS-RP-02 against the repository substrate through the source CLI path.",
    },
  },
  {
    id: "RS-RP-03-pr-size",
    status: "verified",
    requiredEvidence: ["gitContext", "integration"],
    evidence: {
      identity:
        "rs-rp-signals.test.ts: canonical id, alias, title, tier/category/kind, empty input contract, semantic cacheVersion, git-revision-context dependency, pack registration, registry alias lookup, default config decoding, factor ledger, score mode, and score denominator are asserted.",
      config:
        "rs-rp-signals.test.ts: top_n_diagnostics decodes through the real schema; fractional and NaN diagnostic cap values are normalized through compute output.",
      positiveFixture:
        "rs-rp-signals.test.ts: temporary Cargo workspace fixtures exercise real RustProjectLayer, git working-tree diffs, clean-worktree commit ranges, changed-hunk fallback with changed Rust import lines, same-name workspace crate imports, and renamed plus hyphenated dependency aliases that produce new cross-crate edge facts.",
      negativeFixture:
        "rs-rp-signals.test.ts: missing git and changed-hunk evidence, commit ranges with no Rust diff, non-Rust changed hunks, and clean no-edge changed Rust hunks avoid false cross-crate or Rust PR-size pressure.",
      applicability:
        "rs-rp-signals.test.ts: missing diff evidence emits insufficient_evidence metadata, non-Rust changed-hunk fallback emits not_applicable metadata, and measured Rust diff or Rust changed-hunk evidence remains applicable.",
      score:
        "rs-rp-signals.test.ts: score is asserted as bounded PR-size and cross-crate-edge pressure over changed Rust lines and new cross-crate edges; small, broad, and edge-bearing fixtures lower scores monotonically while no Rust evidence remains neutral.",
      diagnostics:
        "rs-rp-signals.test.ts: diagnostics assert severity, normalized top_n_diagnostics caps, PR-surface payloads, cross-crate edge payloads, missing-diff warnings, diff modes, score mode, and score denominator payloads.",
      factorLedger:
        "rs-rp-signals.test.ts: registered RS pack signal emits config.top_n_diagnostics as non-score-bearing metadata with signal-default source.",
      cacheSemantics:
        "rs-rp-signals.test.ts and pack.test.ts: RS-RP-03 declares git-diff-pr-size-git-context-aliases-rust-hunks-v3 cacheVersion, git-revision-context cache dependency, config/cacheVersion changes alter the signal config hash, and the RS pack wrapper preserves the signal-specific cacheVersion and cacheDependencies.",
      gitContext:
        "rs-rp-signals.test.ts: direct fixtures initialize real git repositories, mutate working trees, commit docs-only and Rust changes, and verify working-tree, commit-range, and changed-hunk fallback modes without stubbing the diff substrate.",
      integration:
        "observer-integration.test.ts and CLI score tests: Rust observer integration carries RS-RP-03 PR-size score and diagnostics through the RS pack against a real Cargo workspace with working-tree git diff data, while CLI single-signal mode executes RS-RP-03 through the source CLI path for both git diff and untracked changed-hunk fallback substrates.",
    },
  },
]
