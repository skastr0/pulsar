import { pendingSignalContract, type SignalContract } from "./signal-contract.js"

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
        "rs-ad-signals.test.ts, pack.test.ts, and core scoring-engine tests: RS-AD-02 declares crate-boundary-reference-data-config-aliases-v2 cacheVersion, config/cacheVersion changes alter the signal config hash, the RS pack wrapper preserves the version, and Tier-2 scoring cache semantics include reference-data version hashes.",
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
  pendingSignalContract("RS-DE-02-dependency-tree"),
  pendingSignalContract("RS-DE-03-feature-flags"),
  pendingSignalContract("RS-DE-04-fan-in-fan-out"),
  pendingSignalContract("RS-AB-01-unused-public-items"),
  pendingSignalContract("RS-AB-02-trait-object-depth"),
  pendingSignalContract("RS-AB-03-generic-proliferation"),
  pendingSignalContract("RS-AB-04-derive-density"),
  pendingSignalContract("RS-LD-01-unsafe-code"),
  pendingSignalContract("RS-LD-02-lifetime-complexity"),
  pendingSignalContract("RS-LD-03-match-catch-all"),
  pendingSignalContract("RS-LD-04-error-granularity"),
  pendingSignalContract("RS-LD-05-cyclomatic-complexity"),
  pendingSignalContract("RS-LD-06-domain-term-consistency"),
  pendingSignalContract("RS-SL-01-duplication"),
  pendingSignalContract("RS-SL-02-suppressions"),
  pendingSignalContract("RS-SL-03-unwrap-expect"),
  pendingSignalContract("RS-SL-04-clone-abuse"),
  pendingSignalContract("RS-RP-01-hotspots"),
  pendingSignalContract("RS-RP-02-compile-time"),
  pendingSignalContract("RS-RP-03-pr-size"),
]
