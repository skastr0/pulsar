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
      expect(out.functions.find((entry) => entry.name === "leaf")?.chainDepth).toBe(1)
      expect(out.functions.find((entry) => entry.name === "top")?.chainDepth).toBeGreaterThanOrEqual(3)
    } finally {
      await cleanupWorkspace(repo)
    }
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
      expect(out.parameterDistribution.max).toBeGreaterThanOrEqual(3)
      expect(out.overThreshold.some((entry) => entry.declarationName === "process")).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AB-04 counts standard and custom derives per type", async () => {
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
        "",
      ].join("\n"),
    })

    try {
      const out = await runSignalCompute(RsAb04, repo, RsAb04.defaultConfig)
      const model = out.types.find((entry) => entry.name === "Model")
      expect(model?.deriveCount).toBe(4)
      expect(model?.customDerives).toEqual(["Serialize", "Deserialize"])
    } finally {
      await cleanupWorkspace(repo)
    }
  })
})
