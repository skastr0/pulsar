import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import { buildRegistry, computeConfigHash } from "@skastr0/pulsar-core/scoring"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { RS_PACK_SIGNALS } from "../pack.js"
import { makeRustProject } from "../project.js"
import { RsAb01 } from "../signals/rs-ab-01-unused-pub.js"
import { RsAb02 } from "../signals/rs-ab-02-trait-object-depth.js"
import { RsAb03 } from "../signals/rs-ab-03-generic-proliferation.js"
import { RsAb04 } from "../signals/rs-ab-04-derive-density.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
  runSignalComputeWithProject,
} from "./helpers.js"

describe("RS-AB-* signals", () => {
  test("RS-AB-01 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsAb01.id),
        { ...RsAb01, cacheVersion: `${RsAb01.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-AB-01")
    const decoded = Schema.decodeUnknownSync(RsAb01.configSchema)(RsAb01.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsAb01.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsAb01.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsAb01.id, registry, {
      id: "rs-ab-01-contract",
      domain: "test",
      signal_overrides: {
        [RsAb01.id]: {
          config: {
            ...RsAb01.defaultConfig,
            top_n_diagnostics: 3,
          },
        },
      },
    })

    expect(RsAb01).toMatchObject({
      id: "RS-AB-01-unused-public-items",
      aliases: ["RS-AB-01"],
      title: "Unused public items",
      tier: 1,
      category: "abstraction-bloat",
      kind: "structural",
      cacheVersion: "rs-ab-01-public-surface-use-segments-aliases-diagnostics-reexports-private-visibility-chain-metadata-applicability-v10",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      top_n_diagnostics: 20,
    })
    expect(registered?.id).toBe(RsAb01.id)
    expect(registered?.cacheVersion).toBe(RsAb01.cacheVersion)
    expect(registry.byId.get("RS-AB-01")?.id).toBe(RsAb01.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "config.exclude_globs", source: "signal-default" }),
        expect.objectContaining({ path: "config.top_n_diagnostics", source: "signal-default" }),
      ]),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-AB-01 distinguishes exported API from internal over-public items", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core", "crates/app", "crates/tool"]',
        'resolver = "2"',
        "",
      ].join("\n"),
      "crates/core/Cargo.toml": [
        "[package]",
        'name = "core_lib"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/core/src/lib.rs": [
        "pub struct Used;",
        "pub struct PublicApi;",
        "pub(crate) struct CrateOnly;",
        "mod internal {",
        "    pub struct Hidden;",
        "    pub struct ReExported;",
        "}",
        "pub mod api {",
        "    pub struct ApiUsed;",
        "    pub struct ExternalApi;",
        "}",
        "pub use internal::ReExported as ExportedAlias;",
        "",
      ].join("\n"),
      "crates/core/src/main.rs": [
        "pub fn binary_helper() {}",
        "",
      ].join("\n"),
      "crates/app/Cargo.toml": [
        "[package]",
        'name = "app_lib"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'core_lib = { path = "../core" }',
        "",
      ].join("\n"),
      "crates/app/src/lib.rs": [
        "use core_lib::api::ApiUsed;",
        "use core_lib::Used;",
        "pub fn use_items(_: Used, _: ApiUsed) {}",
        "",
      ].join("\n"),
      "crates/tool/Cargo.toml": [
        "[package]",
        'name = "tool_bin"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/tool/src/main.rs": [
        "mod cli;",
        "fn main() {}",
        "",
      ].join("\n"),
      "crates/tool/src/cli.rs": [
        "pub struct CliOnly;",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.deadPublicItems.find((item) => item.name === "Hidden")?.surface).toBe(
        "internal-overpublic",
      )
      expect(out.deadPublicItems.map((item) => item.name)).toEqual(["Hidden"])
      expect(out.deadPublicItems.some((item) => item.name === "PublicApi")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "ExternalApi")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "ReExported")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "CrateOnly")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "binary_helper")).toBe(false)
      expect(out.deadPublicItems.some((item) => item.name === "CliOnly")).toBe(false)
      expect(out.exportedApiItems.some((item) => item.name === "PublicApi")).toBe(true)
      expect(out.exportedApiItems.some((item) => item.name === "ExternalApi")).toBe(true)
      expect(out.exportedApiItems.find((item) => item.name === "ReExported")?.reexported).toBe(true)
      expect(out.nonLibraryPublicItems.some((item) => item.name === "binary_helper")).toBe(true)
      expect(out.nonLibraryPublicItems.some((item) => item.name === "CliOnly")).toBe(true)
      expect(RsAb01.outputMetadata?.(out)).toBeUndefined()
      expect(RsAb01.score(out)).toBeGreaterThan(0)
      expect(RsAb01.score(out)).toBeLessThan(1)

      const diagnostics = RsAb01.diagnose(out)
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Public struct Hidden is not referenced from other workspace crates",
        location: {
          file: expect.stringMatching(/crates\/core\/src\/lib\.rs$/),
          line: 5,
        },
        data: {
          hash: computeDiagnosticHash("core_lib|core_lib::crate::internal|Hidden|struct|5"),
          crate: "core_lib",
          module: "core_lib::crate::internal",
          name: "Hidden",
          kind: "struct",
          surface: "internal-overpublic",
          reexported: false,
          crossCrateUses: 0,
          analysisMode: "explicit-use-and-reexport-resolution",
        },
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 resolves hyphenated crates and dependency aliases as cross-crate uses", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-alias-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core-lib", "crates/hyphen-user", "crates/alias-user"]',
        'resolver = "2"',
        "",
      ].join("\n"),
      "crates/core-lib/Cargo.toml": [
        "[package]",
        'name = "core-lib"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/core-lib/src/lib.rs": [
        "pub struct HyphenUsed;",
        "pub struct AliasUsed;",
        "pub struct UnusedRoot;",
        "mod internal {",
        "    pub struct Hidden;",
        "}",
        "",
      ].join("\n"),
      "crates/hyphen-user/Cargo.toml": [
        "[package]",
        'name = "hyphen-user"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'core-lib = { path = "../core-lib" }',
        "",
      ].join("\n"),
      "crates/hyphen-user/src/lib.rs": [
        "use core_lib::HyphenUsed;",
        "pub fn use_hyphen(_: HyphenUsed) {}",
        "",
      ].join("\n"),
      "crates/alias-user/Cargo.toml": [
        "[package]",
        'name = "alias-user"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'domain = { package = "core-lib", path = "../core-lib" }',
        "",
      ].join("\n"),
      "crates/alias-user/src/lib.rs": [
        "use domain::AliasUsed;",
        "pub fn use_alias(_: AliasUsed) {}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.exportedApiItems.find((item) => item.name === "HyphenUsed")?.crossCrateUses).toBe(1)
      expect(out.exportedApiItems.find((item) => item.name === "AliasUsed")?.crossCrateUses).toBe(1)
      expect(out.deadPublicItems.map((item) => item.name)).toEqual(["Hidden"])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 classifies direct and wildcard public reexports as exported API", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-reexports-", {
      "Cargo.toml": [
        "[package]",
        'name = "reexported-api"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod direct {",
        "    pub struct DirectItem;",
        "}",
        "",
        "mod wildcard {",
        "    pub struct WildOne;",
        "    pub struct WildTwo;",
        "}",
        "",
        "pub use direct::DirectItem;",
        "pub use wildcard::*;",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.deadPublicItems).toEqual([])
      expect(out.exportedApiItems.map((item) => item.name)).toEqual([
        "DirectItem",
        "WildOne",
        "WildTwo",
      ])
      expect(out.exportedApiItems.every((item) => item.reexported)).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 ignores public reexports nested under private modules", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-private-reexport-", {
      "Cargo.toml": [
        "[package]",
        'name = "private-reexport"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod internal {",
        "    pub struct Hidden;",
        "}",
        "",
        "mod bridge {",
        "    pub use super::internal::Hidden;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.deadPublicItems.map((item) => item.name)).toEqual(["Hidden"])
      expect(out.deadPublicItems[0]?.surface).toBe("internal-overpublic")
      expect(out.deadPublicItems[0]?.reexported).toBe(false)
      expect(out.exportedApiItems.some((item) => item.name === "Hidden")).toBe(false)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 requires the full module chain to be public for exported API", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-private-nested-", {
      "Cargo.toml": [
        "[package]",
        'name = "private-nested"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub mod api {",
        "    mod hidden {",
        "        pub struct Ghost;",
        "    }",
        "",
        "    pub mod visible {",
        "        pub struct Surface;",
        "    }",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb01, repo, RsAb01.defaultConfig)
      expect(out.deadPublicItems.map((item) => item.name)).toEqual(["Ghost"])
      expect(out.deadPublicItems[0]?.surface).toBe("internal-overpublic")
      expect(out.exportedApiItems.map((item) => item.name)).toContain("Surface")
      expect(out.exportedApiItems.some((item) => item.name === "Ghost")).toBe(false)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 normalizes diagnostic caps and classifies config factors", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-diagnostics-", {
      "Cargo.toml": [
        "[package]",
        'name = "unused-public"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod internal {",
        "    pub struct Alpha;",
        "    pub struct Beta;",
        "    pub struct Gamma;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const capped = await runSignalCompute(
        RsAb01,
        repo,
        { ...RsAb01.defaultConfig, top_n_diagnostics: 1.8 },
      )
      const uncapped = await runSignalCompute(
        RsAb01,
        repo,
        { ...RsAb01.defaultConfig, top_n_diagnostics: 3 },
      )
      const hidden = await runSignalCompute(
        RsAb01,
        repo,
        { ...RsAb01.defaultConfig, top_n_diagnostics: Number.NaN },
      )
      const factorLedger = RsAb01.factorLedger?.(capped)

      expect(capped.diagnosticLimit).toBe(1)
      expect(RsAb01.diagnose(capped)).toHaveLength(1)
      expect(RsAb01.diagnose(capped)[0]?.data?.name).toBe("Alpha")
      expect(RsAb01.diagnose(uncapped)).toMatchObject([
        {
          location: { file: expect.stringMatching(/src\/lib\.rs$/), line: 2 },
          data: {
            hash: computeDiagnosticHash("unused-public|unused-public::crate::internal|Alpha|struct|2"),
            name: "Alpha",
          },
        },
        {
          location: { file: expect.stringMatching(/src\/lib\.rs$/), line: 3 },
          data: {
            hash: computeDiagnosticHash("unused-public|unused-public::crate::internal|Beta|struct|3"),
            name: "Beta",
          },
        },
        {
          location: { file: expect.stringMatching(/src\/lib\.rs$/), line: 4 },
          data: {
            hash: computeDiagnosticHash("unused-public|unused-public::crate::internal|Gamma|struct|4"),
            name: "Gamma",
          },
        },
      ])
      expect(hidden.diagnosticLimit).toBe(0)
      expect(RsAb01.diagnose(hidden)).toHaveLength(0)
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.exclude_globs",
          affectsScore: true,
          scoreRole: "evidence",
        }),
      )
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.top_n_diagnostics",
          affectsScore: false,
          scoreRole: "metadata",
        }),
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 treats missing cargo metadata as insufficient evidence", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab01-missing-metadata-", {
      "Cargo.toml": [
        "[package]",
        'name = "missing-metadata"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod internal {",
        "    pub struct Hidden;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const project = await Effect.runPromise(makeRustProject(repo))
      const out = await runSignalComputeWithProject(
        RsAb01,
        { ...project, cargoMetadata: undefined },
        RsAb01.defaultConfig,
      )

      expect(out.cargoMetadataStatus).toBe("missing")
      expect(out.publicItemCount).toBe(1)
      expect(RsAb01.score(out)).toBe(1)
      expect(RsAb01.outputMetadata?.(out)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAb01.diagnose(out)).toEqual([
        expect.objectContaining({
          severity: "warn",
          message: "RS-AB-01 could not load cargo metadata for public item surface analysis",
          data: expect.objectContaining({
            cargoMetadataStatus: "missing",
            publicItemCount: 1,
          }),
        }),
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-01 keeps clean, missing, no-public, and excluded source evidence honest", async () => {
    const clean = await createRustWorkspace("pulsar-rs-ab01-clean-", {
      "Cargo.toml": [
        "[package]",
        'name = "clean-public"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Api;",
        "mod internal {",
        "    struct PrivateOnly;",
        "}",
        "",
      ].join("\n"),
    })
    const missing = await createRustWorkspace("pulsar-rs-ab01-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "missing-source"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const privateOnly = await createRustWorkspace("pulsar-rs-ab01-private-", {
      "Cargo.toml": [
        "[package]",
        'name = "private-only"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod internal {",
        "    struct PrivateOnly;",
        "}",
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-ab01-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "excluded-public"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "mod internal {",
        "    pub struct Hidden;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const cleanOut = await runSignalCompute(RsAb01, clean, RsAb01.defaultConfig)
      const missingOut = await runSignalCompute(RsAb01, missing, RsAb01.defaultConfig)
      const privateOut = await runSignalCompute(RsAb01, privateOnly, RsAb01.defaultConfig)
      const privateWithoutMetadataProject = await Effect.runPromise(makeRustProject(privateOnly))
      const privateWithoutMetadataOut = await runSignalComputeWithProject(
        RsAb01,
        { ...privateWithoutMetadataProject, cargoMetadata: undefined },
        RsAb01.defaultConfig,
      )
      const excludedOut = await runSignalCompute(
        RsAb01,
        excluded,
        { ...RsAb01.defaultConfig, exclude_globs: ["**/*.rs"] },
      )

      expect(cleanOut.deadPublicItems).toEqual([])
      expect(RsAb01.score(cleanOut)).toBe(1)
      expect(RsAb01.diagnose(cleanOut)).toEqual([])
      expect(RsAb01.outputMetadata?.(cleanOut)).toBeUndefined()

      expect(missingOut.sourceFileCount).toBe(0)
      expect(RsAb01.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAb01.score(missingOut)).toBe(1)
      expect(RsAb01.diagnose(missingOut)).toEqual([
        expect.objectContaining({
          severity: "warn",
          message: "RS-AB-01 found no Rust source files for public item analysis",
        }),
      ])

      expect(privateOut.publicItemCount).toBe(0)
      expect(RsAb01.outputMetadata?.(privateOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb01.diagnose(privateOut)).toEqual([])
      expect(privateWithoutMetadataOut.cargoMetadataStatus).toBe("missing")
      expect(privateWithoutMetadataOut.publicItemCount).toBe(0)
      expect(RsAb01.outputMetadata?.(privateWithoutMetadataOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb01.diagnose(privateWithoutMetadataOut)).toEqual([])

      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(excludedOut.publicItemCount).toBe(0)
      expect(RsAb01.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb01.diagnose(excludedOut)).toEqual([])
    } finally {
      await cleanupWorkspace(clean)
      await cleanupWorkspace(missing)
      await cleanupWorkspace(privateOnly)
      await cleanupWorkspace(excluded)
    }
  })

  test("RS-AB-01 scores additional dead public items as higher pressure", async () => {
    const lowPressure = await createRustWorkspace("pulsar-rs-ab01-low-pressure-", {
      "Cargo.toml": [
        "[package]",
        'name = "low-pressure"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct ApiOne;",
        "pub struct ApiTwo;",
        "pub struct ApiThree;",
        "mod internal {",
        "    pub struct DeadOne;",
        "}",
        "",
      ].join("\n"),
    })
    const highPressure = await createRustWorkspace("pulsar-rs-ab01-high-pressure-", {
      "Cargo.toml": [
        "[package]",
        'name = "high-pressure"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct ApiOne;",
        "pub struct ApiTwo;",
        "mod internal {",
        "    pub struct DeadOne;",
        "    pub struct DeadTwo;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const low = await runSignalCompute(RsAb01, lowPressure, RsAb01.defaultConfig)
      const high = await runSignalCompute(RsAb01, highPressure, RsAb01.defaultConfig)

      expect(low.publicItemCount).toBe(4)
      expect(high.publicItemCount).toBe(4)
      expect(low.deadPublicItems).toHaveLength(1)
      expect(high.deadPublicItems).toHaveLength(2)
      expect(RsAb01.score(low)).toBeCloseTo(0.75)
      expect(RsAb01.score(high)).toBeCloseTo(0.5)
      expect(RsAb01.score(high)).toBeLessThan(RsAb01.score(low))
    } finally {
      await cleanupWorkspace(lowPressure)
      await cleanupWorkspace(highPressure)
    }
  })

  test("RS-AB-02 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsAb02.id),
        { ...RsAb02, cacheVersion: `${RsAb02.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-AB-02")
    const decoded = Schema.decodeUnknownSync(RsAb02.configSchema)(RsAb02.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsAb02.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsAb02.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsAb02.id, registry, {
      id: "rs-ab-02-contract",
      domain: "test",
      signal_overrides: {
        [RsAb02.id]: {
          config: {
            ...RsAb02.defaultConfig,
            max_chain_depth: 2,
          },
        },
      },
    })

    expect(RsAb02).toMatchObject({
      id: "RS-AB-02-trait-object-depth",
      aliases: ["RS-AB-02"],
      title: "Trait object depth",
      tier: 1,
      category: "abstraction-bloat",
      kind: "legibility",
      cacheVersion: "trait-object-depth-config-applicability-diagnostics-scoped-calls-cfg-test-gating-cycles-v4",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      max_chain_depth: 1,
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsAb02.id)
    expect(registered?.cacheVersion).toBe(RsAb02.cacheVersion)
    expect(registry.byId.get("RS-AB-02")?.id).toBe(RsAb02.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "config.exclude_globs", source: "signal-default" }),
        expect.objectContaining({ path: "config.max_chain_depth", source: "signal-default" }),
        expect.objectContaining({ path: "config.top_n_diagnostics", source: "signal-default" }),
      ]),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_chain_depth",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-AB-02 measures local trait-object call-chain depth", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab02-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Display;",
        "pub fn leaf() -> Box<dyn Display> { Box::new(String::from(\"leaf\")) }",
        "pub fn middle() -> Box<dyn Display> { leaf() }",
        "pub fn top() -> Box<dyn Display> { middle() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb02, repo, RsAb02.defaultConfig)
      const diagnostics = RsAb02.diagnose(out)

      expect(out.functions.map((entry) => [entry.name, entry.chainDepth])).toEqual([
        ["top", 3],
        ["middle", 2],
        ["leaf", 1],
      ])
      expect(out.functions.find((entry) => entry.name === "leaf")?.chainDepth).toBe(1)
      expect(out.functions.find((entry) => entry.name === "top")?.chainDepth).toBeGreaterThanOrEqual(3)
      expect(out.overThreshold.map((entry) => entry.name)).toEqual(["top", "middle"])
      expect(out.maxChainDepth).toBe(1)
      expect(out.diagnosticLimit).toBe(10)
      expect(RsAb02.outputMetadata?.(out)).toBeUndefined()
      expect(RsAb02.score(out)).toBeCloseTo(1 / 3)
      expect(diagnostics).toMatchObject([
        {
          severity: "warn",
          message: "Trait-object chain depth 3 in top",
          location: { file: expect.stringMatching(/src\/lib\.rs$/), line: 4 },
          data: {
            module: "trait-object-fixture::crate",
            name: "top",
            returnType: "Box<dyn Display>",
            calleeNames: ["middle"],
            analysisMode: "local-dyn-return-call-graph",
          },
        },
        {
          severity: "warn",
          message: "Trait-object chain depth 2 in middle",
          location: { file: expect.stringMatching(/src\/lib\.rs$/), line: 3 },
          data: {
            module: "trait-object-fixture::crate",
            name: "middle",
            returnType: "Box<dyn Display>",
            calleeNames: ["leaf"],
            analysisMode: "local-dyn-return-call-graph",
          },
        },
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-02 normalizes config, diagnostics, and applicability evidence", async () => {
    const chain = await createRustWorkspace("pulsar-rs-ab02-config-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-config"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Debug;",
        "pub fn leaf() -> Box<dyn Debug> { Box::new(1_u8) }",
        "pub fn middle() -> Box<dyn Debug> { leaf() }",
        "pub fn top() -> Box<dyn Debug> { middle() }",
        "",
      ].join("\n"),
    })
    const missing = await createRustWorkspace("pulsar-rs-ab02-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-missing"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const noDyn = await createRustWorkspace("pulsar-rs-ab02-no-dyn-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-no-dyn"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn ordinary() -> usize { 1 }",
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-ab02-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Debug;",
        "pub fn hidden() -> Box<dyn Debug> { Box::new(1_u8) }",
        "",
      ].join("\n"),
    })

    try {
      const capped = await runSignalCompute(
        RsAb02,
        chain,
        { ...RsAb02.defaultConfig, max_chain_depth: 1.8, top_n_diagnostics: 1.8 },
      )
      const hidden = await runSignalCompute(
        RsAb02,
        chain,
        { ...RsAb02.defaultConfig, max_chain_depth: Number.NaN, top_n_diagnostics: Number.NaN },
      )
      const strict = await runSignalCompute(
        RsAb02,
        chain,
        { ...RsAb02.defaultConfig, max_chain_depth: 0 },
      )
      const missingOut = await runSignalCompute(RsAb02, missing, RsAb02.defaultConfig)
      const noDynOut = await runSignalCompute(RsAb02, noDyn, RsAb02.defaultConfig)
      const excludedOut = await runSignalCompute(
        RsAb02,
        excluded,
        { ...RsAb02.defaultConfig, exclude_globs: ["**/*.rs"] },
      )

      expect(capped.maxChainDepth).toBe(1)
      expect(capped.diagnosticLimit).toBe(1)
      expect(RsAb02.diagnose(capped)).toHaveLength(1)
      expect(RsAb02.diagnose(capped)[0]?.data?.name).toBe("top")
      expect(hidden.maxChainDepth).toBe(1)
      expect(hidden.diagnosticLimit).toBe(0)
      expect(RsAb02.diagnose(hidden)).toHaveLength(0)
      expect(strict.overThreshold).toHaveLength(3)
      expect(RsAb02.score(strict)).toBeLessThan(RsAb02.score(capped))

      expect(missingOut.sourceFileCount).toBe(0)
      expect(RsAb02.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAb02.diagnose(missingOut)).toEqual([
        expect.objectContaining({
          severity: "warn",
          message: "RS-AB-02 found no Rust source files for trait-object depth analysis",
        }),
      ])

      expect(noDynOut.sourceFileCount).toBe(1)
      expect(noDynOut.functions).toEqual([])
      expect(RsAb02.outputMetadata?.(noDynOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb02.diagnose(noDynOut)).toEqual([])

      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(excludedOut.functions).toEqual([])
      expect(RsAb02.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb02.diagnose(excludedOut)).toEqual([])
    } finally {
      await cleanupWorkspace(chain)
      await cleanupWorkspace(missing)
      await cleanupWorkspace(noDyn)
      await cleanupWorkspace(excluded)
    }
  })

  test("RS-AB-02 resolves scoped local calls without same-name collisions", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab02-scoped-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-scoped"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Debug;",
        "pub mod a {",
        "    use std::fmt::Debug;",
        "    pub fn leaf() -> Box<dyn Debug> { Box::new(1_u8) }",
        "}",
        "pub mod b {",
        "    use std::fmt::Debug;",
        "    pub fn leaf() -> Box<dyn Debug> { Box::new(2_u8) }",
        "}",
        "pub mod nested {",
        "    use std::fmt::Debug;",
        "    pub mod c {",
        "        use std::fmt::Debug;",
        "        pub fn local() -> Box<dyn Debug> { Box::new(3_u8) }",
        "    }",
        "    pub fn via_self() -> Box<dyn Debug> { self::c::local() }",
        "    pub fn via_super() -> Box<dyn Debug> { super::a::leaf() }",
        "}",
        "pub fn via_relative() -> Box<dyn Debug> { a::leaf() }",
        "pub fn via_crate() -> Box<dyn Debug> { crate::nested::c::local() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb02, repo, RsAb02.defaultConfig)
      const byName = new Map(out.functions.map((entry) => [`${entry.module}::${entry.name}`, entry]))

      expect(byName.get("trait-object-scoped::crate::via_relative")?.chainDepth).toBe(2)
      expect(byName.get("trait-object-scoped::crate::via_relative")?.calleeNames).toEqual(["a::leaf"])
      expect(byName.get("trait-object-scoped::crate::via_crate")?.chainDepth).toBe(2)
      expect(byName.get("trait-object-scoped::crate::via_crate")?.calleeNames).toEqual([
        "crate::nested::c::local",
      ])
      expect(byName.get("trait-object-scoped::crate::nested::via_self")?.chainDepth).toBe(2)
      expect(byName.get("trait-object-scoped::crate::nested::via_self")?.calleeNames).toEqual([
        "self::c::local",
      ])
      expect(byName.get("trait-object-scoped::crate::nested::via_super")?.chainDepth).toBe(2)
      expect(byName.get("trait-object-scoped::crate::nested::via_super")?.calleeNames).toEqual([
        "super::a::leaf",
      ])
      expect(out.functions.filter((entry) => entry.name === "leaf").map((entry) => entry.chainDepth)).toEqual([1, 1])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-02 resolves generic function and self method calls conservatively", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab02-methods-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-methods"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Debug;",
        "pub fn generic_leaf<T>() -> Box<dyn Debug> { Box::new(1_u8) }",
        "pub fn generic_top() -> Box<dyn Debug> { generic_leaf::<u8>() }",
        "",
        "pub struct Builder;",
        "impl Builder {",
        "    pub fn leaf(&self) -> Box<dyn Debug> { Box::new(2_u8) }",
        "    pub fn middle(&self) -> Box<dyn Debug> { self.leaf() }",
        "    pub fn top(&self) -> Box<dyn Debug> { self.middle() }",
        "}",
        "",
        "pub struct Other;",
        "impl Other {",
        "    pub fn leaf(&self) -> Box<dyn Debug> { Box::new(3_u8) }",
        "}",
        "pub fn external_receiver(other: Other) -> Box<dyn Debug> { other.leaf() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb02, repo, RsAb02.defaultConfig)
      const entriesByName = new Map(out.functions.map((entry) => [entry.name, entry]))
      const leafDepths = out.functions
        .filter((entry) => entry.name === "leaf")
        .map((entry) => entry.chainDepth)
        .sort()

      expect(entriesByName.get("generic_top")?.chainDepth).toBe(2)
      expect(entriesByName.get("generic_top")?.calleeNames).toEqual(["generic_leaf"])
      expect(entriesByName.get("top")?.chainDepth).toBe(3)
      expect(entriesByName.get("top")?.calleeNames).toEqual(["self.middle"])
      expect(entriesByName.get("middle")?.chainDepth).toBe(2)
      expect(entriesByName.get("middle")?.calleeNames).toEqual(["self.leaf"])
      expect(entriesByName.get("external_receiver")?.chainDepth).toBe(1)
      expect(entriesByName.get("external_receiver")?.calleeNames).toEqual([])
      expect(leafDepths).toEqual([1, 1])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-02 excludes composite cfg test-gated functions", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab02-cfg-test-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-cfg-test"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Debug;",
        "#[cfg(any(test, feature = \"probe\"))]",
        "pub fn test_or_probe() -> Box<dyn Debug> { Box::new(1_u8) }",
        "#[cfg(all(test, feature = \"probe\"))]",
        "pub fn test_and_probe() -> Box<dyn Debug> { Box::new(2_u8) }",
        "#[cfg(not(test))]",
        "pub fn production_cfg() -> Box<dyn Debug> { Box::new(3_u8) }",
        "pub fn ordinary() -> Box<dyn Debug> { production_cfg() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb02, repo, RsAb02.defaultConfig)

      expect(out.functions.map((entry) => entry.name).sort()).toEqual([
        "ordinary",
        "production_cfg",
      ])
      expect(out.functions.find((entry) => entry.name === "ordinary")?.chainDepth).toBe(2)
      expect(out.functions.some((entry) => entry.name === "test_or_probe")).toBe(false)
      expect(out.functions.some((entry) => entry.name === "test_and_probe")).toBe(false)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-02 keeps recursive cycles from inflating finite chain depth", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab02-cycles-", {
      "Cargo.toml": [
        "[package]",
        'name = "trait-object-cycles"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "use std::fmt::Debug;",
        "pub fn alpha() -> Box<dyn Debug> { beta() }",
        "pub fn beta() -> Box<dyn Debug> { alpha() }",
        "pub fn leaf() -> Box<dyn Debug> { Box::new(1_u8) }",
        "pub fn middle() -> Box<dyn Debug> { leaf() }",
        "pub fn top() -> Box<dyn Debug> { middle() }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb02, repo, RsAb02.defaultConfig)
      const entriesByName = new Map(out.functions.map((entry) => [entry.name, entry]))

      expect(entriesByName.get("alpha")?.chainDepth).toBe(2)
      expect(entriesByName.get("beta")?.chainDepth).toBe(2)
      expect(entriesByName.get("top")?.chainDepth).toBe(3)
      expect(entriesByName.get("middle")?.chainDepth).toBe(2)
      expect(entriesByName.get("leaf")?.chainDepth).toBe(1)
      expect(RsAb02.score(out)).toBeCloseTo(0.2)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-03 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsAb03.id),
        { ...RsAb03, cacheVersion: `${RsAb03.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-AB-03")
    const decoded = Schema.decodeUnknownSync(RsAb03.configSchema)(RsAb03.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsAb03.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsAb03.id, versionedRegistry, undefined)
    const complexityConfiguredCacheHash = computeConfigHash(RsAb03.id, registry, {
      id: "rs-ab-03-complexity-contract",
      domain: "test",
      signal_overrides: {
        [RsAb03.id]: {
          config: {
            ...RsAb03.defaultConfig,
            max_generic_complexity: 7,
          },
        },
      },
    })
    const configuredCacheHash = computeConfigHash(RsAb03.id, registry, {
      id: "rs-ab-03-contract",
      domain: "test",
      signal_overrides: {
        [RsAb03.id]: {
          config: {
            ...RsAb03.defaultConfig,
            max_generic_complexity: 7,
            max_generic_parameters: 2,
          },
        },
      },
    })

    expect(RsAb03).toMatchObject({
      id: "RS-AB-03-generic-proliferation",
      aliases: ["RS-AB-03"],
      title: "Generic proliferation",
      tier: 1,
      category: "abstraction-bloat",
      kind: "legibility",
      cacheVersion: "generic-proliferation-config-applicability-diagnostics-cfg-test-gating-bounds-complexity-v4",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      max_generic_complexity: 8,
      max_generic_parameters: 3,
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsAb03.id)
    expect(registered?.cacheVersion).toBe(RsAb03.cacheVersion)
    expect(registry.byId.get("RS-AB-03")?.id).toBe(RsAb03.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(complexityConfiguredCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_generic_complexity",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_generic_parameters",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-AB-03 summarizes generic parameter proliferation", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab03-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Pair<T, U>(pub T, pub U);",
        "pub fn process<T, U, V>(left: T, right: U) -> V",
        "where",
        "    T: Clone,",
        "    U: Into<V>,",
        "    V: Clone,",
        "{",
        "    right.into()",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(
        RsAb03,
        repo,
        { ...RsAb03.defaultConfig, max_generic_parameters: 2 },
      )
      const diagnostics = RsAb03.diagnose(out)

      expect(out.declarations.map((entry) => [entry.declarationName, entry.paramCount])).toEqual([
        ["process", 3],
        ["Pair", 2],
      ])
      expect(out.declarations.find((entry) => entry.declarationName === "Pair")).toMatchObject({
        whereClausePredicates: 0,
        complexity: 2,
      })
      expect(out.declarations.find((entry) => entry.declarationName === "process")).toMatchObject({
        whereClausePredicates: 3,
        complexity: 9,
      })
      expect(out.complexityDistribution.max).toBeGreaterThanOrEqual(9)
      expect(out.parameterDistribution.max).toBeGreaterThanOrEqual(3)
      expect(out.overThreshold.some((entry) => entry.declarationName === "process")).toBe(true)
      expect(out.maxGenericComplexity).toBe(8)
      expect(out.maxGenericParameters).toBe(2)
      expect(out.diagnosticLimit).toBe(10)
      expect(RsAb03.outputMetadata?.(out)).toBeUndefined()
      expect(RsAb03.score(out)).toBeCloseTo(0.5)
      expect(diagnostics).toMatchObject([
        {
          severity: "warn",
          message: "process uses 3 generic parameters with generic signature complexity 9",
          location: { file: expect.stringMatching(/src\/lib\.rs$/), line: 2 },
          data: {
            module: "generic-fixture::crate",
            paramCount: 3,
            whereClausePredicates: 3,
            boundCount: 3,
            complexity: 9,
            maxGenericComplexity: 8,
            maxGenericParameters: 2,
            thresholdsExceeded: ["generic_parameters", "generic_complexity"],
            analysisMode: "ast-generic-signature-counts",
          },
        },
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-03 scores both generic parameter and bound complexity pressure", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab03-score-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-score"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Clean<T>(pub T);",
        "pub struct ParamHeavy<T, U, V, W>(pub T, pub U, pub V, pub W);",
        "pub fn bound_heavy<T>(value: T)",
        "where",
        "    T: Clone + Send + Sync + Default + 'static + Into<String> + AsRef<str>,",
        "{",
        "    let _ = value;",
        "}",
        "",
      ].join("\n"),
    })

    try {
      const pressured = await runSignalCompute(
        RsAb03,
        repo,
        { ...RsAb03.defaultConfig, max_generic_complexity: 8, max_generic_parameters: 3 },
      )
      const relaxedComplexity = await runSignalCompute(
        RsAb03,
        repo,
        { ...RsAb03.defaultConfig, max_generic_complexity: 12, max_generic_parameters: 3 },
      )
      const diagnostics = RsAb03.diagnose(pressured)

      expect(pressured.overThreshold.map((entry) => entry.declarationName)).toEqual([
        "ParamHeavy",
        "bound_heavy",
      ])
      expect(RsAb03.score(pressured)).toBeCloseTo(1 / 3)
      expect(relaxedComplexity.overThreshold.map((entry) => entry.declarationName)).toEqual([
        "ParamHeavy",
      ])
      expect(RsAb03.score(relaxedComplexity)).toBeCloseTo(2 / 3)
      expect(diagnostics).toMatchObject([
        {
          message: "ParamHeavy uses 4 generic parameters",
          data: {
            thresholdsExceeded: ["generic_parameters"],
          },
        },
        {
          message: "bound_heavy has generic signature complexity 9",
          data: {
            paramCount: 1,
            whereClausePredicates: 1,
            boundCount: 7,
            complexity: 9,
            maxGenericComplexity: 8,
            maxGenericParameters: 3,
            thresholdsExceeded: ["generic_complexity"],
          },
        },
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-03 normalizes config, diagnostics, and applicability evidence", async () => {
    const generic = await createRustWorkspace("pulsar-rs-ab03-config-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-config"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Alpha<T, U, V>(pub T, pub U, pub V);",
        "pub struct Beta<T, U>(pub T, pub U);",
        "pub fn gamma<T, U, V, W>() {}",
        "",
      ].join("\n"),
    })
    const missing = await createRustWorkspace("pulsar-rs-ab03-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-missing"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const noGeneric = await createRustWorkspace("pulsar-rs-ab03-no-generic-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-none"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Plain;",
        "pub fn ordinary() {}",
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-ab03-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Hidden<T, U, V>(pub T, pub U, pub V);",
        "",
      ].join("\n"),
    })

    try {
      const capped = await runSignalCompute(
        RsAb03,
        generic,
        {
          ...RsAb03.defaultConfig,
          max_generic_complexity: 5.8,
          max_generic_parameters: 2.8,
          top_n_diagnostics: 1.8,
        },
      )
      const hidden = await runSignalCompute(
        RsAb03,
        generic,
        {
          ...RsAb03.defaultConfig,
          max_generic_complexity: Number.NaN,
          max_generic_parameters: Number.NaN,
          top_n_diagnostics: Number.NaN,
        },
      )
      const strict = await runSignalCompute(
        RsAb03,
        generic,
        { ...RsAb03.defaultConfig, max_generic_complexity: 1, max_generic_parameters: 1 },
      )
      const missingOut = await runSignalCompute(RsAb03, missing, RsAb03.defaultConfig)
      const noGenericOut = await runSignalCompute(RsAb03, noGeneric, RsAb03.defaultConfig)
      const excludedOut = await runSignalCompute(
        RsAb03,
        excluded,
        { ...RsAb03.defaultConfig, exclude_globs: ["**/*.rs"] },
      )

      expect(capped.maxGenericComplexity).toBe(5)
      expect(capped.maxGenericParameters).toBe(2)
      expect(capped.diagnosticLimit).toBe(1)
      expect(RsAb03.diagnose(capped)).toHaveLength(1)
      expect(RsAb03.diagnose(capped)[0]?.data?.paramCount).toBe(4)
      expect(RsAb03.diagnose(capped)[0]?.data?.maxGenericComplexity).toBe(5)
      expect(hidden.maxGenericComplexity).toBe(8)
      expect(hidden.maxGenericParameters).toBe(3)
      expect(hidden.diagnosticLimit).toBe(0)
      expect(RsAb03.diagnose(hidden)).toHaveLength(0)
      expect(strict.overThreshold).toHaveLength(3)
      expect(RsAb03.score(strict)).toBeLessThan(RsAb03.score(capped))

      expect(missingOut.sourceFileCount).toBe(0)
      expect(RsAb03.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAb03.diagnose(missingOut)).toEqual([
        expect.objectContaining({
          severity: "warn",
          message: "RS-AB-03 found no Rust source files for generic proliferation analysis",
        }),
      ])

      expect(noGenericOut.sourceFileCount).toBe(1)
      expect(noGenericOut.declarations).toEqual([])
      expect(RsAb03.outputMetadata?.(noGenericOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb03.diagnose(noGenericOut)).toEqual([])

      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(excludedOut.declarations).toEqual([])
      expect(RsAb03.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb03.diagnose(excludedOut)).toEqual([])
    } finally {
      await cleanupWorkspace(generic)
      await cleanupWorkspace(missing)
      await cleanupWorkspace(noGeneric)
      await cleanupWorkspace(excluded)
    }
  })

  test("RS-AB-03 counts lifetime, const, trait, type, and impl generics", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab03-shapes-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-shapes"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Pair<'a, T, const N: usize>(pub &'a [T; N]);",
        "pub enum Choice<T, E> { Ok(T), Err(E) }",
        "pub trait Service<'a, T> { fn handle(&self, value: &'a T); }",
        "pub type Alias<T> = Vec<T>;",
        "impl<'a, T, const N: usize> Pair<'a, T, N>",
        "where",
        "    T: Clone,",
        "{",
        "    pub fn new(value: &'a [T; N]) -> Self { Self(value) }",
        "}",
        "#[cfg(any(test, feature = \"probe\"))]",
        "pub struct TestOnly<T, U, V>(pub T, pub U, pub V);",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb03, repo, RsAb03.defaultConfig)
      const byName = new Map(out.declarations.map((entry) => [entry.declarationName, entry]))
      const implEntry = out.declarations.find((entry) => entry.declarationName.startsWith("impl "))

      expect(byName.get("Pair")?.paramCount).toBe(3)
      expect(byName.get("Pair")?.whereClausePredicates).toBe(0)
      expect(byName.get("Pair")?.complexity).toBe(3)
      expect(byName.get("Choice")?.paramCount).toBe(2)
      expect(byName.get("Service")?.paramCount).toBe(2)
      expect(byName.get("Alias")?.paramCount).toBe(1)
      expect(implEntry?.paramCount).toBe(3)
      expect(implEntry?.whereClausePredicates).toBe(1)
      expect(implEntry?.complexity).toBe(5)
      expect(out.declarations.some((entry) => entry.declarationName === "TestOnly")).toBe(false)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-03 counts individual generic bounds in signatures", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab03-bounds-", {
      "Cargo.toml": [
        "[package]",
        'name = "generic-bounds"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub trait Store<T>: Send + Sync + 'static",
        "where",
        "    T: Clone + AsRef<str>,",
        "{",
        "    fn get(&self) -> T;",
        "}",
        "pub fn bound_heavy<T: Clone + Send, U, V>(value: T) -> V",
        "where",
        "    U: Into<V> + TryFrom<T>,",
        "    V: Clone + Send + 'static,",
        "{",
        "    todo!()",
        "}",
        "pub struct Borrowed<'a, T: 'a + Clone>(pub &'a T);",
        "pub struct Nested<T: Into<Vec<Option<T>>> + Iterator<Item = Result<T, E>>, E>(pub T, pub E);",
        "pub fn associated<T>()",
        "where",
        "    T: Iterator<Item: Clone + Send> + ExactSizeIterator,",
        "{}",
        "pub struct Fancy<'a, T: 'a + ?Sized + std::fmt::Debug + for<'b> Fn(&'b str)>(pub &'a T);",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb03, repo, RsAb03.defaultConfig)
      const byName = new Map(out.declarations.map((entry) => [entry.declarationName, entry]))

      expect(byName.get("Store")).toMatchObject({
        paramCount: 1,
        whereClausePredicates: 1,
        boundCount: 5,
        complexity: 7,
      })
      expect(byName.get("bound_heavy")).toMatchObject({
        paramCount: 3,
        whereClausePredicates: 2,
        boundCount: 7,
        complexity: 12,
      })
      expect(byName.get("Borrowed")).toMatchObject({
        paramCount: 2,
        whereClausePredicates: 0,
        boundCount: 2,
        complexity: 4,
      })
      expect(byName.get("Nested")).toMatchObject({
        paramCount: 2,
        whereClausePredicates: 0,
        boundCount: 2,
        complexity: 4,
      })
      expect(byName.get("associated")).toMatchObject({
        paramCount: 1,
        whereClausePredicates: 1,
        boundCount: 4,
        complexity: 6,
      })
      expect(byName.get("Fancy")).toMatchObject({
        paramCount: 2,
        whereClausePredicates: 0,
        boundCount: 4,
        complexity: 6,
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-04 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsAb04.id),
        { ...RsAb04, cacheVersion: `${RsAb04.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-AB-04")
    const decoded = Schema.decodeUnknownSync(RsAb04.configSchema)(RsAb04.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsAb04.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsAb04.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsAb04.id, registry, {
      id: "rs-ab-04-contract",
      domain: "test",
      signal_overrides: {
        [RsAb04.id]: {
          config: {
            ...RsAb04.defaultConfig,
            max_custom_derives: 2,
            max_derive_count: 5,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsAb04).toMatchObject({
      id: "RS-AB-04-derive-density",
      aliases: ["RS-AB-04"],
      title: "Derive density",
      tier: 1,
      category: "abstraction-bloat",
      kind: "legibility",
      cacheVersion: "derive-density-config-applicability-diagnostics-cfg-attr-thresholds-v4",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      max_custom_derives: 1,
      max_derive_count: 4,
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsAb04.id)
    expect(registered?.cacheVersion).toBe(RsAb04.cacheVersion)
    expect(registry.byId.get("RS-AB-04")?.id).toBe(RsAb04.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_custom_derives",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_derive_count",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-AB-04 counts standard and custom derives per tracked type", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab04-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[derive(Clone, Debug, Serialize, Deserialize)]",
        "pub struct Model { pub id: u32 }",
        "pub struct Plain;",
        "#[derive(Default)]",
        "pub enum Choice { A }",
        "#[cfg(any(test, feature = \"probe\"))]",
        "#[derive(Clone, Debug, Serialize, Deserialize)]",
        "pub struct TestOnly;",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb04, repo, RsAb04.defaultConfig)
      const model = out.types.find((entry) => entry.name === "Model")
      const plain = out.types.find((entry) => entry.name === "Plain")
      const diagnostics = RsAb04.diagnose(out)

      expect(out.sourceFileCount).toBe(1)
      expect(out.analyzedSourceFileCount).toBe(1)
      expect(out.trackedTypeCount).toBe(3)
      expect(out.deriveBearingTypeCount).toBe(2)
      expect(out.maxCustomDerives).toBe(1)
      expect(out.maxDeriveCount).toBe(4)
      expect(model?.deriveCount).toBe(4)
      expect(model?.customDerives).toEqual(["Serialize", "Deserialize"])
      expect(plain).toMatchObject({
        deriveCount: 0,
        standardDerives: [],
        customDerives: [],
      })
      expect(out.types.some((entry) => entry.name === "TestOnly")).toBe(false)
      expect(RsAb04.outputMetadata?.(out)).toBeUndefined()
      expect(RsAb04.score(out)).toBeCloseTo(2 / 3)
      expect(diagnostics).toMatchObject([
        {
          severity: "warn",
          message: "Model derives 2 custom macros",
          location: { file: expect.stringMatching(/src\/lib\.rs$/), line: 2 },
          data: {
            module: "derive-fixture::crate",
            deriveCount: 4,
            standardDerives: ["Clone", "Debug"],
            customDerives: ["Serialize", "Deserialize"],
            maxCustomDerives: 1,
            maxDeriveCount: 4,
            thresholdsExceeded: ["custom_derives"],
            analysisMode: "attribute-attached-derive-count",
          },
        },
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-04 scores total derive and custom derive pressure", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab04-score-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-score"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Clean;",
        "#[derive(Clone, Debug, Default, Eq, PartialEq)]",
        "pub struct TotalHeavy;",
        "#[derive(Clone, Serialize, Deserialize)]",
        "pub struct CustomHeavy;",
        "",
      ].join("\n"),
    })

    try {
      const pressured = await runSignalCompute(
        RsAb04,
        repo,
        { ...RsAb04.defaultConfig, max_custom_derives: 1, max_derive_count: 4 },
      )
      const relaxed = await runSignalCompute(
        RsAb04,
        repo,
        { ...RsAb04.defaultConfig, max_custom_derives: 3, max_derive_count: 8 },
      )
      const diagnostics = RsAb04.diagnose(pressured)

      expect(pressured.overThreshold.map((entry) => entry.name)).toEqual([
        "TotalHeavy",
        "CustomHeavy",
      ])
      expect(RsAb04.score(pressured)).toBeCloseTo(1 / 3)
      expect(relaxed.overThreshold).toEqual([])
      expect(RsAb04.score(relaxed)).toBe(1)
      expect(diagnostics).toMatchObject([
        {
          message: "TotalHeavy derives 5 macros",
          data: {
            deriveCount: 5,
            customDerives: [],
            thresholdsExceeded: ["derive_count"],
          },
        },
        {
          message: "CustomHeavy derives 2 custom macros",
          data: {
            deriveCount: 3,
            customDerives: ["Serialize", "Deserialize"],
            thresholdsExceeded: ["custom_derives"],
          },
        },
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-04 extracts direct and cfg_attr derives deliberately", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ab04-cfg-attr-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-cfg-attr"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[derive(Clone)]",
        "#[derive(serde::Serialize, Deserialize)]",
        "pub struct Direct;",
        "#[cfg_attr(feature = \"serde\", derive(Serialize, Deserialize))]",
        "pub enum FeatureDerived { A }",
        "#[cfg_attr(test, derive(Clone, Debug, Serialize))]",
        "pub struct TestOnlyConditional;",
        "#[cfg_attr(all(test, feature = \"serde\"), derive(Serialize, Deserialize))]",
        "pub struct CompositeTestOnly;",
        "#[cfg_attr(not(test), derive(Clone))]",
        "pub union NonTestConditional { field: u32 }",
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb04, repo, RsAb04.defaultConfig)
      const byName = new Map(out.types.map((entry) => [entry.name, entry]))

      expect(byName.get("Direct")).toMatchObject({
        deriveCount: 3,
        standardDerives: ["Clone"],
        customDerives: ["serde::Serialize", "Deserialize"],
      })
      expect(byName.get("FeatureDerived")).toMatchObject({
        deriveCount: 2,
        standardDerives: [],
        customDerives: ["Serialize", "Deserialize"],
      })
      expect(byName.get("TestOnlyConditional")).toMatchObject({
        deriveCount: 0,
        standardDerives: [],
        customDerives: [],
      })
      expect(byName.get("CompositeTestOnly")).toMatchObject({
        deriveCount: 0,
        standardDerives: [],
        customDerives: [],
      })
      expect(byName.get("NonTestConditional")).toMatchObject({
        deriveCount: 1,
        standardDerives: ["Clone"],
        customDerives: [],
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-04 normalizes diagnostics and applicability evidence", async () => {
    const derive = await createRustWorkspace("pulsar-rs-ab04-config-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-config"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[derive(Clone, Debug, Serialize, Deserialize)]",
        "pub struct Model;",
        "#[derive(Default)]",
        "pub struct Other;",
        "pub struct Plain;",
        "",
      ].join("\n"),
    })
    const missing = await createRustWorkspace("pulsar-rs-ab04-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-missing"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
    })
    const noDerive = await createRustWorkspace("pulsar-rs-ab04-none-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-none"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub struct Plain;",
        "",
      ].join("\n"),
    })
    const noType = await createRustWorkspace("pulsar-rs-ab04-no-type-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-no-type"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn ordinary() {}",
        "",
      ].join("\n"),
    })
    const excluded = await createRustWorkspace("pulsar-rs-ab04-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "derive-excluded"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "#[derive(Clone, Debug, Serialize, Deserialize)]",
        "pub struct Hidden;",
        "",
      ].join("\n"),
    })

    try {
      const capped = await runSignalCompute(
        RsAb04,
        derive,
        {
          ...RsAb04.defaultConfig,
          max_custom_derives: 0.8,
          max_derive_count: 3.8,
          top_n_diagnostics: 1.8,
        },
      )
      const hidden = await runSignalCompute(
        RsAb04,
        derive,
        {
          ...RsAb04.defaultConfig,
          max_custom_derives: Number.NaN,
          max_derive_count: Number.NaN,
          top_n_diagnostics: Number.NaN,
        },
      )
      const missingOut = await runSignalCompute(RsAb04, missing, RsAb04.defaultConfig)
      const noDeriveOut = await runSignalCompute(RsAb04, noDerive, RsAb04.defaultConfig)
      const noTypeOut = await runSignalCompute(RsAb04, noType, RsAb04.defaultConfig)
      const excludedOut = await runSignalCompute(
        RsAb04,
        excluded,
        { ...RsAb04.defaultConfig, exclude_globs: ["**/*.rs"] },
      )

      expect(capped.maxCustomDerives).toBe(0)
      expect(capped.maxDeriveCount).toBe(3)
      expect(capped.diagnosticLimit).toBe(1)
      expect(RsAb04.diagnose(capped)).toHaveLength(1)
      expect(hidden.maxCustomDerives).toBe(1)
      expect(hidden.maxDeriveCount).toBe(4)
      expect(hidden.diagnosticLimit).toBe(0)
      expect(RsAb04.diagnose(hidden)).toHaveLength(0)

      expect(missingOut.sourceFileCount).toBe(0)
      expect(RsAb04.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAb04.diagnose(missingOut)).toEqual([
        expect.objectContaining({
          severity: "warn",
          message: "RS-AB-04 found no Rust source files for derive density analysis",
          data: expect.objectContaining({
            sourceFileCount: 0,
            analyzedSourceFileCount: 0,
            trackedTypeCount: 0,
            deriveBearingTypeCount: 0,
          }),
        }),
      ])

      expect(noDeriveOut.sourceFileCount).toBe(1)
      expect(noDeriveOut.trackedTypeCount).toBe(1)
      expect(noDeriveOut.deriveBearingTypeCount).toBe(0)
      expect(RsAb04.outputMetadata?.(noDeriveOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb04.diagnose(noDeriveOut)).toEqual([])

      expect(noTypeOut.sourceFileCount).toBe(1)
      expect(noTypeOut.trackedTypeCount).toBe(0)
      expect(noTypeOut.deriveBearingTypeCount).toBe(0)
      expect(RsAb04.outputMetadata?.(noTypeOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb04.diagnose(noTypeOut)).toEqual([])

      expect(excludedOut.sourceFileCount).toBe(1)
      expect(excludedOut.analyzedSourceFileCount).toBe(0)
      expect(excludedOut.trackedTypeCount).toBe(0)
      expect(RsAb04.outputMetadata?.(excludedOut)).toEqual({
        applicability: "not_applicable",
      })
      expect(RsAb04.diagnose(excludedOut)).toEqual([])
    } finally {
      await cleanupWorkspace(derive)
      await cleanupWorkspace(missing)
      await cleanupWorkspace(noDerive)
      await cleanupWorkspace(noType)
      await cleanupWorkspace(excluded)
    }
  })
})
