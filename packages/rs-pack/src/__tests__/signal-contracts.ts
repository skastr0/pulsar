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
  pendingSignalContract("RS-AD-02-crate-boundaries"),
  pendingSignalContract("RS-AD-03-circular-crate-dependencies"),
  pendingSignalContract("RS-DE-01-trait-coupling"),
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
