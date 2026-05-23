import {
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
  ReferenceDataTag,
} from "@skastr0/pulsar-core/reference-data"
import { buildRegistry, computeConfigHash } from "@skastr0/pulsar-core/scoring"
import { InMemoryCacheLayer } from "@skastr0/pulsar-core/signal"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { RS_PACK_SIGNALS } from "../pack.js"
import {
  makeRustProject,
  RustProjectLayer,
  type RustProject,
} from "../project.js"
import {
  RsAd01,
  type RsAd01Output,
} from "../signals/rs-ad-01-visibility-surface.js"
import {
  RsAd02,
} from "../signals/rs-ad-02-crate-boundaries.js"
import type { RsAd02Output } from "../signals/rs-ad-02-types.js"
import { RsAd03 } from "../signals/rs-ad-03-circular-crate-deps.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
  runSignalComputeWithProject,
} from "./helpers.js"

const createRsAd02Workspace = () =>
  createRustWorkspace("pulsar-rs-ad02-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/core", "crates/app", "crates/rogue"]',
      'resolver = "2"',
      "",
    ].join("\n"),
    "crates/core/Cargo.toml": [
      "[package]",
      'name = "core"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "crates/core/src/lib.rs": [
      "pub mod api {",
      "    pub struct Thing;",
      "}",
      "",
      "mod internal {",
      "    pub struct Hidden;",
      "}",
      "",
      "pub mod internal_pub {",
      "    pub struct Exposed;",
      "}",
      "",
    ].join("\n"),
    "crates/app/Cargo.toml": [
      "[package]",
      'name = "app"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'core = { path = "../core" }',
      "",
    ].join("\n"),
    "crates/app/src/lib.rs": [
      "use core::api::Thing;",
      "use core::internal::Hidden;",
      "use core::internal_pub::Exposed;",
      "",
      "pub fn build(_thing: Thing) {",
      "    let _ = core::mem::size_of::<Thing>();",
      "}",
      "",
    ].join("\n"),
    "crates/rogue/Cargo.toml": [
      "[package]",
      'name = "rogue"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'core = { path = "../core" }',
      "",
    ].join("\n"),
    "crates/rogue/src/lib.rs": [
      "use core::api::Thing;",
      "",
      "pub fn steal(_thing: Thing) {}",
      "",
    ].join("\n"),
  })

const createRsAd02CleanWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad02-clean-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/core", "crates/app"]',
      'resolver = "2"',
      "",
    ].join("\n"),
    "crates/core/Cargo.toml": [
      "[package]",
      'name = "core"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "crates/core/src/lib.rs": [
      "pub mod api {",
      "    pub struct Thing;",
      "}",
      "",
    ].join("\n"),
    "crates/app/Cargo.toml": [
      "[package]",
      'name = "app"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'core = { path = "../core" }',
      "",
    ].join("\n"),
    "crates/app/src/lib.rs": [
      "use core::api::Thing;",
      "",
      "pub fn build(_thing: Thing) {}",
      "",
    ].join("\n"),
  })

const createRsAd02AliasWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad02-alias-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/core-lib", "crates/app", "crates/hyphen-user"]',
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
      "pub mod api {",
      "    pub struct Thing;",
      "}",
      "pub mod internal_pub {",
      "    pub struct Exposed;",
      "}",
      "",
    ].join("\n"),
    "crates/app/Cargo.toml": [
      "[package]",
      'name = "app"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'core_alias = { package = "core-lib", path = "../core-lib" }',
      "",
    ].join("\n"),
    "crates/app/src/lib.rs": [
      "use core_alias::internal_pub::Exposed;",
      "use core_alias::internal_pub::Exposed as ExposedAgain;",
      "",
      "pub fn build(_value: Exposed, _again: ExposedAgain) {}",
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
      "use core_lib::internal_pub::Exposed;",
      "",
      "pub fn build(_value: Exposed) {}",
      "",
    ].join("\n"),
  })

const rsAd03CycleWorkspaceFiles = (): Readonly<Record<string, string>> => ({
  "Cargo.toml": [
    "[workspace]",
    'members = ["crates/a", "crates/b"]',
    'resolver = "2"',
    "",
  ].join("\n"),
  "crates/a/Cargo.toml": [
    "[package]",
    'name = "a"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dependencies]",
    'b = { path = "../b", optional = true }',
    "",
  ].join("\n"),
  "crates/a/src/lib.rs": "pub fn a() {}\n",
  "crates/b/Cargo.toml": [
    "[package]",
    'name = "b"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
    "[dev-dependencies]",
    'a = { path = "../a" }',
    "",
  ].join("\n"),
  "crates/b/src/lib.rs": "pub fn b() {}\n",
})

const createRsAd03CycleWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad03-cycle-", rsAd03CycleWorkspaceFiles())

const createRsAd03RenamedCycleWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad03-renamed-cycle-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/a", "crates/b"]',
      'resolver = "2"',
      "",
    ].join("\n"),
    "crates/a/Cargo.toml": [
      "[package]",
      'name = "a"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'b_alias = { package = "b", path = "../b", optional = true }',
      "",
      "[features]",
      "default = []",
      'use-b = ["dep:b_alias"]',
      "",
    ].join("\n"),
    "crates/a/src/lib.rs": "pub fn a() {}\n",
    "crates/b/Cargo.toml": [
      "[package]",
      'name = "b"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dev-dependencies]",
      'a = { path = "../a" }',
      "",
    ].join("\n"),
    "crates/b/src/lib.rs": "pub fn b() {}\n",
  })

const createRsAd03MultiCycleWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad03-multi-cycle-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/a", "crates/b", "crates/c", "crates/d"]',
      'resolver = "2"',
      "",
    ].join("\n"),
    "crates/a/Cargo.toml": [
      "[package]",
      'name = "a"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'b = { path = "../b", optional = true }',
      "",
    ].join("\n"),
    "crates/a/src/lib.rs": "pub fn a() {}\n",
    "crates/b/Cargo.toml": [
      "[package]",
      'name = "b"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dev-dependencies]",
      'a = { path = "../a" }',
      "",
    ].join("\n"),
    "crates/b/src/lib.rs": "pub fn b() {}\n",
    "crates/c/Cargo.toml": [
      "[package]",
      'name = "c"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'd = { path = "../d", optional = true }',
      "",
    ].join("\n"),
    "crates/c/src/lib.rs": "pub fn c() {}\n",
    "crates/d/Cargo.toml": [
      "[package]",
      'name = "d"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dev-dependencies]",
      'c = { path = "../c" }',
      "",
    ].join("\n"),
    "crates/d/src/lib.rs": "pub fn d() {}\n",
  })

const createRsAd03LargeCycleWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad03-large-cycle-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/a", "crates/b", "crates/c"]',
      'resolver = "2"',
      "",
    ].join("\n"),
    "crates/a/Cargo.toml": [
      "[package]",
      'name = "a"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'b = { path = "../b", optional = true }',
      "",
    ].join("\n"),
    "crates/a/src/lib.rs": "pub fn a() {}\n",
    "crates/b/Cargo.toml": [
      "[package]",
      'name = "b"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'c = { path = "../c", optional = true }',
      "",
    ].join("\n"),
    "crates/b/src/lib.rs": "pub fn b() {}\n",
    "crates/c/Cargo.toml": [
      "[package]",
      'name = "c"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dev-dependencies]",
      'a = { path = "../a" }',
      "",
    ].join("\n"),
    "crates/c/src/lib.rs": "pub fn c() {}\n",
  })

const createRsAd03CleanWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad03-clean-", {
    "Cargo.toml": [
      "[workspace]",
      'members = ["crates/a", "crates/b", "crates/c"]',
      'resolver = "2"',
      "",
    ].join("\n"),
    "crates/a/Cargo.toml": [
      "[package]",
      'name = "a"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'b = { path = "../b" }',
      "",
    ].join("\n"),
    "crates/a/src/lib.rs": "pub fn a() {}\n",
    "crates/b/Cargo.toml": [
      "[package]",
      'name = "b"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
      "[dependencies]",
      'c = { path = "../c" }',
      "",
    ].join("\n"),
    "crates/b/src/lib.rs": "pub fn b() {}\n",
    "crates/c/Cargo.toml": [
      "[package]",
      'name = "c"',
      'version = "0.1.0"',
      'edition = "2021"',
      "",
    ].join("\n"),
    "crates/c/src/lib.rs": "pub fn c() {}\n",
  })

const createRsAd03EmptyWorkspace = () =>
  createRustWorkspace("pulsar-rs-ad03-empty-", {
    "Cargo.toml": [
      "[workspace]",
      "members = []",
      'resolver = "2"',
      "",
    ].join("\n"),
  })

const rsAd01WorkspaceFiles = (): Readonly<Record<string, string>> => ({
  "Cargo.toml": [
    "[package]",
    'name = "ad-visibility-fixture"',
    'version = "0.1.0"',
    'edition = "2021"',
    "",
  ].join("\n"),
  "src/lib.rs": [
    "pub mod api {",
    "    pub struct PublicThing;",
    "    pub(crate) struct SharedThing;",
    "    pub (crate) struct SpacedSharedThing;",
    "    pub(super) fn parent_visible() {}",
    "    pub (super) fn spaced_parent_visible() {}",
    "    pub(in crate::api) type Scoped = u8;",
    "    pub (in crate::api) type SpacedScoped = u8;",
    "    fn hidden() {}",
    "}",
    "",
    "mod internal {",
    "    pub struct InternalPub;",
    "    fn hidden() {}",
    "}",
    "",
  ].join("\n"),
})

describe("RS-AD-* signals", () => {
  test("RS-AD-01 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const registered = registry.byId.get("RS-AD-01")
    const decoded = Schema.decodeUnknownSync(RsAd01.configSchema)(RsAd01.defaultConfig)
    const factorLedger = registered?.factorLedger?.({} as RsAd01Output)

    expect(RsAd01).toMatchObject({
      id: "RS-AD-01-visibility-surface",
      aliases: ["RS-AD-01"],
      title: "Visibility surface",
      tier: 1,
      category: "architectural-drift",
      kind: "structural",
      cacheVersion: "visibility-surface-config-thresholds-spaced-visibility-v2",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      warn_pub_ratio: 0.35,
      top_n_diagnostics: 5,
    })
    expect(registered?.id).toBe(RsAd01.id)
    expect(registered?.cacheVersion).toBe(RsAd01.cacheVersion)
    expect(registry.byId.get("RS-AD-01")?.id).toBe(RsAd01.id)
    expect(factorLedger?.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "config.exclude_globs", source: "signal-default" }),
        expect.objectContaining({ path: "config.warn_pub_ratio", source: "signal-default" }),
        expect.objectContaining({ path: "config.top_n_diagnostics", source: "signal-default" }),
      ]),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.warn_pub_ratio",
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

  test("RS-AD-01 summarizes visibility categories per module from real Rust source", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ad01-", rsAd01WorkspaceFiles())

    try {
      const out = await runSignalCompute(RsAd01, repo, RsAd01.defaultConfig)
      const api = out.modules.find((module) => module.module === "ad-visibility-fixture::crate::api")
      const root = out.modules.find((module) => module.module === "ad-visibility-fixture::crate")
      const internal = out.modules.find((module) =>
        module.module === "ad-visibility-fixture::crate::internal"
      )

      expect(out.totalItems).toBe(12)
      expect(out.overallPubRatio).toBeCloseTo(0.25)
      expect(out.averagePubRatio).toBeCloseTo(0.375)
      expect(out.warnPubRatio).toBe(0.35)
      expect(out.topDiagnostics).toBe(5)
      expect(root).toMatchObject({ pub: 1, private: 1, total: 2, pubRatio: 0.5 })
      expect(internal).toMatchObject({ pub: 1, private: 1, total: 2, pubRatio: 0.5 })
      expect(api).toMatchObject({
        pub: 1,
        pubCrate: 2,
        pubSuper: 2,
        pubInPath: 2,
        private: 1,
        total: 8,
        pubRatio: 0.125,
      })
      expect(out.byModule.get("ad-visibility-fixture::crate::api")?.avg).toBeCloseTo(0.125)
      expect(RsAd01.outputMetadata?.(out)).toBeUndefined()
      expect(RsAd01.score(out)).toBeCloseTo(1 - (0.375 - 0.35) / 0.65)

      const diagnostics = RsAd01.diagnose(out)
      expect(diagnostics.map((diagnostic) => diagnostic.data?.module)).toEqual([
        "ad-visibility-fixture::crate",
        "ad-visibility-fixture::crate::internal",
        "ad-visibility-fixture::crate::api",
      ])
      expect(diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Module ad-visibility-fixture::crate exposes 50% of its items as pub",
        data: {
          pubRatio: 0.5,
          warnPubRatio: 0.35,
          counts: { pub: 1, pubCrate: 0, pubSuper: 0, pubInPath: 0, private: 1 },
        },
      })
      expect(diagnostics[2]).toMatchObject({ severity: "info" })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-01 config changes score threshold and diagnostic cap deterministically", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ad01-config-", rsAd01WorkspaceFiles())

    try {
      const strict = await runSignalCompute(RsAd01, repo, {
        ...RsAd01.defaultConfig,
        warn_pub_ratio: 0.1,
        top_n_diagnostics: 1.9,
      })
      const lenient = await runSignalCompute(RsAd01, repo, {
        ...RsAd01.defaultConfig,
        warn_pub_ratio: 0.9,
        top_n_diagnostics: 10,
      })
      const normalized = await runSignalCompute(RsAd01, repo, {
        ...RsAd01.defaultConfig,
        warn_pub_ratio: Number.POSITIVE_INFINITY,
        top_n_diagnostics: Number.NaN,
      })

      expect(strict.warnPubRatio).toBe(0.1)
      expect(strict.topDiagnostics).toBe(1)
      expect(RsAd01.score(strict)).toBeLessThan(RsAd01.score(lenient))
      expect(RsAd01.diagnose(strict)).toHaveLength(1)
      expect(RsAd01.diagnose(strict)[0]?.severity).toBe("warn")
      expect(lenient.warnPubRatio).toBe(0.9)
      expect(RsAd01.score(lenient)).toBe(1)
      expect(RsAd01.diagnose(lenient).every((diagnostic) => diagnostic.severity === "info")).toBe(true)
      expect(normalized.warnPubRatio).toBe(0.35)
      expect(normalized.topDiagnostics).toBe(0)
      expect(RsAd01.diagnose(normalized)).toEqual([])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-01 stays neutral and insufficient when no Rust visibility surface is measured", async () => {
    const nonRustRepo = await createRustWorkspace("pulsar-rs-ad01-empty-", {
      "README.md": "# no rust here\n",
    })
    const excludedRepo = await createRustWorkspace("pulsar-rs-ad01-excluded-", {
      "Cargo.toml": [
        "[package]",
        'name = "ad-visibility-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn visible() {}",
        "fn hidden() {}",
      ].join("\n"),
    })

    try {
      const nonRust = await runSignalCompute(RsAd01, nonRustRepo, RsAd01.defaultConfig)
      const excluded = await runSignalCompute(RsAd01, excludedRepo, {
        ...RsAd01.defaultConfig,
        exclude_globs: ["**/src/**"],
      })

      for (const out of [nonRust, excluded]) {
        expect(out.modules).toEqual([])
        expect(out.totalItems).toBe(0)
        expect(out.overallPubRatio).toBe(0)
        expect(RsAd01.score(out)).toBe(1)
        expect(RsAd01.diagnose(out)).toEqual([])
        expect(RsAd01.outputMetadata?.(out)).toEqual({
          applicability: "insufficient_evidence",
        })
      }
    } finally {
      await cleanupWorkspace(nonRustRepo)
      await cleanupWorkspace(excludedRepo)
    }
  })

  test("RS-AD-02 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(buildRegistry([
      ...SHARED_SIGNALS,
      ...RS_PACK_SIGNALS.map((signal) =>
        signal.id === RsAd02.id
          ? { ...RsAd02, cacheVersion: `${RsAd02.cacheVersion}-changed` }
          : signal,
      ),
    ]))
    const registered = registry.byId.get("RS-AD-02")
    const decoded = Schema.decodeUnknownSync(RsAd02.configSchema)(RsAd02.defaultConfig)
    const factorLedger = registered?.factorLedger?.({} as RsAd02Output)
    const baseCacheHash = computeConfigHash(RsAd02.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsAd02.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsAd02.id, registry, {
      id: "rs-ad-02-contract",
      domain: "test",
      signal_overrides: {
        [RsAd02.id]: {
          config: {
            ...RsAd02.defaultConfig,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsAd02).toMatchObject({
      id: "RS-AD-02-crate-boundaries",
      aliases: ["RS-AD-02"],
      title: "Crate boundary violations",
      tier: 2,
      category: "architectural-drift",
      kind: "structural",
      cacheVersion: "crate-boundary-reference-data-config-aliases-use-segments-v3",
      inputs: [],
    })
    expect(decoded).toEqual({
      exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
      top_n_diagnostics: 10,
    })
    expect(registered?.id).toBe(RsAd02.id)
    expect(registered?.cacheVersion).toBe(RsAd02.cacheVersion)
    expect(registry.byId.get("RS-AD-02")?.id).toBe(RsAd02.id)
    expect(versionedCacheHash).not.toBe(baseCacheHash)
    expect(configuredCacheHash).not.toBe(baseCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        source: "signal-default",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-AD-02 flags dependent, private target, and public-module boundary violations", async () => {
    const repo = await createRsAd02Workspace()

    try {
      const out = await runSignalCompute(RsAd02, repo, RsAd02.defaultConfig, {
        "schema-conventions": {
          rust_crate_boundaries: {
            core: {
              visibility: "public-api",
              allowed_dependents: ["app"],
              public_modules: ["crate", "crate::api"],
            },
          },
        },
      })

      expect(out.referenceDataStatus).toBe("loaded")
      expect(out.checkedImports).toBe(4)
      expect(out.diagnosticLimit).toBe(10)
      expect(out.violations).toHaveLength(3)
      expect(out.violations.map((violation) => violation.kind).sort()).toEqual([
        "boundary-rule",
        "dependent-not-allowed",
        "non-public-target",
      ])
      expect(out.violations.map((violation) => violation.importPath)).toEqual([
        "core::internal::Hidden",
        "core::internal_pub::Exposed",
        "core::api::Thing",
      ])
      expect(RsAd02.score(out)).toBe(0)
      expect(RsAd02.outputMetadata?.(out)).toBeUndefined()

      const diagnostics = RsAd02.diagnose(out)
      expect(diagnostics).toHaveLength(3)
      expect(diagnostics.every((diagnostic) => diagnostic.severity === "block")).toBe(true)
      expect(diagnostics.every((diagnostic) => typeof diagnostic.data?.hash === "string")).toBe(true)
      expect(new Set(diagnostics.map((diagnostic) => diagnostic.data?.hash)).size).toBe(3)
      expect(diagnostics[0]).toMatchObject({
        message: expect.stringContaining("core::internal::Hidden"),
        data: {
          fromCrate: "app",
          toCrate: "core",
          kind: "non-public-target",
        },
      })
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-02 resolves hyphenated crate names and dependency rename aliases", async () => {
    const repo = await createRsAd02AliasWorkspace()
    const entries = {
      "schema-conventions": {
        rust_crate_boundaries: {
          "core-lib": {
            visibility: "public-api",
            allowed_dependents: ["app", "hyphen-user"],
            public_modules: ["crate::api"],
          },
        },
      },
    }

    try {
      const out = await runSignalCompute(RsAd02, repo, RsAd02.defaultConfig, entries)
      const project = await Effect.runPromise(makeRustProject(repo))
      const noCargoMetadata = await runSignalComputeWithProject(
        RsAd02,
        { ...project, cargoMetadata: undefined },
        RsAd02.defaultConfig,
        entries,
      )

      expect(out.referenceDataStatus).toBe("loaded")
      expect(out.checkedImports).toBe(3)
      expect(out.violations.map((violation) => violation.importPath)).toEqual([
        "core_alias::internal_pub::Exposed",
        "core_alias::internal_pub::Exposed",
        "core_lib::internal_pub::Exposed",
      ])
      expect(out.violations.every((violation) => violation.kind === "boundary-rule")).toBe(true)
      expect(out.violations.map((violation) => violation.toCrate)).toEqual([
        "core-lib",
        "core-lib",
        "core-lib",
      ])
      const diagnostics = RsAd02.diagnose(out)
      const hashes = diagnostics.map((diagnostic) => diagnostic.data?.hash)
      expect(diagnostics).toHaveLength(3)
      expect(new Set(hashes).size).toBe(3)
      expect(noCargoMetadata.referenceDataStatus).toBe("loaded")
      expect(noCargoMetadata.checkedImports).toBe(3)
      expect(noCargoMetadata.violations.map((violation) => violation.importPath)).toEqual(
        out.violations.map((violation) => violation.importPath),
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-02 keeps clean allowed imports neutral and applicable", async () => {
    const repo = await createRsAd02CleanWorkspace()

    try {
      const out = await runSignalCompute(RsAd02, repo, RsAd02.defaultConfig, {
        "schema-conventions": {
          rust_crate_boundaries: {
            core: {
              visibility: "public-api",
              allowed_dependents: ["app"],
              public_modules: ["crate::api"],
            },
          },
        },
      })

      expect(out.referenceDataStatus).toBe("loaded")
      expect(out.checkedImports).toBe(1)
      expect(out.violations).toEqual([])
      expect(RsAd02.score(out)).toBe(1)
      expect(RsAd02.diagnose(out)).toEqual([])
      expect(RsAd02.outputMetadata?.(out)).toBeUndefined()
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-02 distinguishes missing reference data, no import evidence, and exclusions", async () => {
    const violatingRepo = await createRsAd02Workspace()
    const nonRustRepo = await createRustWorkspace("pulsar-rs-ad02-empty-", {
      "README.md": "# no rust here\n",
    })

    try {
      const missing = await runSignalCompute(RsAd02, violatingRepo, RsAd02.defaultConfig)
      const loadedWithoutRustRules = await runSignalCompute(RsAd02, violatingRepo, RsAd02.defaultConfig, {
        "schema-conventions": {
          boundaries: {
            core: {
              visibility: "public-api",
              allowed_imports: [],
            },
          },
          rust_crate_boundaries: {},
        },
      })
      const noRust = await runSignalCompute(RsAd02, nonRustRepo, RsAd02.defaultConfig)
      const noRustWithConventions = await runSignalCompute(RsAd02, nonRustRepo, RsAd02.defaultConfig, {
        "schema-conventions": {
          rust_crate_boundaries: {},
        },
      })
      const excluded = await runSignalCompute(RsAd02, violatingRepo, {
        ...RsAd02.defaultConfig,
        exclude_globs: ["**/crates/app/src/**", "**/crates/rogue/src/**"],
      }, {
        "schema-conventions": {
          rust_crate_boundaries: {
            core: {
              visibility: "public-api",
              allowed_dependents: ["app"],
              public_modules: ["crate::api"],
            },
          },
        },
      })

      expect(missing.referenceDataStatus).toBe("missing")
      expect(missing.checkedImports).toBe(4)
      expect(RsAd02.score(missing)).toBe(1)
      expect(RsAd02.outputMetadata?.(missing)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAd02.diagnose(missing)[0]).toMatchObject({
        severity: "warn",
        data: {
          checkedImports: 4,
          referenceDataStatus: "missing",
        },
      })

      expect(loadedWithoutRustRules.referenceDataStatus).toBe("missing")
      expect(loadedWithoutRustRules.checkedImports).toBe(4)
      expect(RsAd02.score(loadedWithoutRustRules)).toBe(1)
      expect(RsAd02.outputMetadata?.(loadedWithoutRustRules)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAd02.diagnose(loadedWithoutRustRules)[0]).toMatchObject({
        severity: "warn",
        data: {
          checkedImports: 4,
          referenceDataStatus: "missing",
        },
      })

      expect(noRust.referenceDataStatus).toBe("missing")
      expect(noRust.checkedImports).toBe(0)
      expect(RsAd02.outputMetadata?.(noRust)).toEqual({
        applicability: "insufficient_evidence",
      })

      expect(noRustWithConventions.referenceDataStatus).toBe("loaded")
      expect(noRustWithConventions.checkedImports).toBe(0)
      expect(RsAd02.score(noRustWithConventions)).toBe(1)
      expect(RsAd02.diagnose(noRustWithConventions)).toEqual([])
      expect(RsAd02.outputMetadata?.(noRustWithConventions)).toEqual({
        applicability: "not_applicable",
      })

      expect(excluded.referenceDataStatus).toBe("loaded")
      expect(excluded.checkedImports).toBe(0)
      expect(excluded.violations).toEqual([])
      expect(RsAd02.score(excluded)).toBe(1)
      expect(RsAd02.diagnose(excluded)).toEqual([])
      expect(RsAd02.outputMetadata?.(excluded)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanupWorkspace(violatingRepo)
      await cleanupWorkspace(nonRustRepo)
    }
  })

  test("RS-AD-02 normalizes diagnostic limits and caps diagnostics", async () => {
    const repo = await createRsAd02Workspace()
    const entries = {
      "schema-conventions": {
        rust_crate_boundaries: {
          core: {
            visibility: "public-api",
            allowed_dependents: ["app"],
            public_modules: ["crate", "crate::api"],
          },
        },
      },
    }

    try {
      const capped = await runSignalCompute(RsAd02, repo, {
        ...RsAd02.defaultConfig,
        top_n_diagnostics: 1.9,
      }, entries)
      const hiddenNegative = await runSignalCompute(RsAd02, repo, {
        ...RsAd02.defaultConfig,
        top_n_diagnostics: -1,
      }, entries)
      const hiddenNaN = await runSignalCompute(RsAd02, repo, {
        ...RsAd02.defaultConfig,
        top_n_diagnostics: Number.NaN,
      }, entries)

      expect(capped.diagnosticLimit).toBe(1)
      expect(RsAd02.diagnose(capped)).toHaveLength(1)
      expect(hiddenNegative.diagnosticLimit).toBe(0)
      expect(hiddenNaN.diagnosticLimit).toBe(0)
      expect(RsAd02.diagnose(hiddenNegative)).toEqual([])
      expect(RsAd02.diagnose(hiddenNaN)).toEqual([])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-02 consumes Rust boundary rules from canonical loaded schema conventions", async () => {
    const repo = await createRsAd02Workspace()

    try {
      await mkdir(join(repo, ".pulsar"), { recursive: true })
      await writeFile(
        join(repo, ".pulsar", "conventions.json"),
        `${JSON.stringify(
          {
            schema_version: 1,
            extracted_at_sha: "HEAD",
            boundaries: {},
            rust_crate_boundaries: {
              core: {
                visibility: "public-api",
                allowed_dependents: ["app"],
                public_modules: ["crate", "crate::api"],
              },
            },
            naming_conventions: {
              function: "camelCase",
              class: "PascalCase",
              interface: "PascalCase",
              type: "PascalCase",
              const: "camelCase | UPPER_SNAKE_CASE",
              enum: "PascalCase",
            },
            architectural_rules: [],
          },
          null,
          2,
        )}\n`,
        "utf8",
      )

      const loadedEntries = await Effect.runPromise(loadCanonicalReferenceDataEntries(repo))
      const loadedConventions = loadedEntries.get("schema-conventions") as {
        rust_crate_boundaries?: Record<string, { public_modules?: ReadonlyArray<string> }>
      } | undefined
      expect(loadedConventions?.rust_crate_boundaries?.core?.public_modules).toEqual([
        "crate",
        "crate::api",
      ])
      const out = await Effect.runPromise(
        RsAd02.compute(RsAd02.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.mergeAll(
              RustProjectLayer(repo),
              Layer.succeed(ReferenceDataTag, makeReferenceData(loadedEntries)),
              InMemoryCacheLayer,
            ),
          ),
        ) as Effect.Effect<RsAd02Output, unknown, never>,
      )

      expect(out.referenceDataStatus).toBe("loaded")
      expect(out.violations.map((violation) => violation.kind).sort()).toEqual([
        "boundary-rule",
        "dependent-not-allowed",
        "non-public-target",
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-03 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(buildRegistry([
      ...SHARED_SIGNALS,
      ...RS_PACK_SIGNALS.map((signal) =>
        signal.id === RsAd03.id
          ? { ...RsAd03, cacheVersion: `${RsAd03.cacheVersion}-changed` }
          : signal,
      ),
    ]))
    const registered = registry.byId.get("RS-AD-03")
    const decoded = Schema.decodeUnknownSync(RsAd03.configSchema)(RsAd03.defaultConfig)
    const factorLedger = registered?.factorLedger?.({ cycles: [] })
    const baseCacheHash = computeConfigHash(RsAd03.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsAd03.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsAd03.id, registry, {
      id: "rs-ad-03-contract",
      domain: "test",
      signal_overrides: {
        [RsAd03.id]: {
          config: {
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsAd03).toMatchObject({
      id: "RS-AD-03-circular-crate-dependencies",
      aliases: ["RS-AD-03"],
      title: "Circular crate dependencies",
      tier: 1,
      category: "architectural-drift",
      kind: "structural",
      cacheVersion: "cargo-metadata-cycles-config-v1",
      inputs: [],
    })
    expect(decoded).toEqual({ top_n_diagnostics: 10 })
    expect(registered?.id).toBe(RsAd03.id)
    expect(registry.byId.get("RS-AD-03")?.id).toBe(RsAd03.id)
    expect(versionedCacheHash).not.toBe(baseCacheHash)
    expect(configuredCacheHash).not.toBe(baseCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        source: "signal-default",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
  })

  test("RS-AD-03 detects feature-induced workspace crate cycles from real cargo metadata", async () => {
    const repo = await createRsAd03CycleWorkspace()

    try {
      const out = await runSignalCompute(RsAd03, repo, RsAd03.defaultConfig)

      expect(out.metadataStatus).toBe("loaded")
      expect(out.packageCount).toBe(2)
      expect(out.cycleCount).toBe(1)
      expect(out.largestCycleSize).toBe(2)
      expect(out.diagnosticLimit).toBe(10)
      expect(out.cycles[0]?.crates).toEqual(["a", "b"])
      expect(out.cycles[0]?.featureInduced).toBe(true)
      expect(out.cycles[0]?.edges.map((edge) => edge.kind).sort()).toEqual(["dev", "normal"])
      expect(out.cycles[0]?.edges.some((edge) => edge.optional)).toBe(true)
      expect(RsAd03.score(out)).toBe(0.85)
      expect(RsAd03.outputMetadata?.(out)).toBeUndefined()

      const diagnostics = RsAd03.diagnose(out)
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        severity: "block",
        message: expect.stringContaining("a→b→a"),
        data: {
          crates: ["a", "b"],
          architecturalSpan: "a→b→a",
          featureInduced: true,
        },
      })
      expect(diagnostics[0]?.location?.file).toEndWith("/crates/a/Cargo.toml")
      expect(typeof diagnostics[0]?.data?.hash).toBe("string")
      expect(diagnostics[0]?.data?.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ from: "a", to: "b", optional: true, featureDriven: true }),
          expect.objectContaining({ from: "b", to: "a", kind: "dev" }),
        ]),
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-03 keeps renamed dependency cycles and hashes canonical", async () => {
    const repo = await createRsAd03RenamedCycleWorkspace()

    try {
      const out = await runSignalCompute(RsAd03, repo, RsAd03.defaultConfig)
      const project = await Effect.runPromise(makeRustProject(repo))
      const metadata = project.cargoMetadata
      expect(metadata).toBeDefined()
      if (metadata === undefined) {
        throw new Error("expected cargo metadata for renamed dependency fixture")
      }

      const aliasedDependency = metadata.packages
        .find((pkg) => pkg.name === "a")
        ?.dependencies.find((dep) => dep.rename === "b_alias")
      expect(aliasedDependency).toMatchObject({
        name: "b",
        rename: "b_alias",
        optional: true,
      })

      const reversedOrder = await runSignalComputeWithProject(
        RsAd03,
        {
          ...project,
          cargoMetadata: {
            ...metadata,
            workspaceMembers: [...metadata.workspaceMembers].reverse(),
            packages: [...metadata.packages]
              .reverse()
              .map((pkg) => ({
                ...pkg,
                dependencies: [...pkg.dependencies].reverse(),
              })),
          },
        },
        RsAd03.defaultConfig,
      )

      expect(out.cycles[0]?.crates).toEqual(["a", "b"])
      expect(out.cycles[0]?.edges).toEqual([
        {
          from: "a",
          to: "b",
          kind: "normal",
          optional: true,
          featureDriven: true,
        },
        {
          from: "b",
          to: "a",
          kind: "dev",
          optional: false,
          featureDriven: false,
        },
      ])
      expect(reversedOrder.cycles[0]?.edges).toEqual(out.cycles[0]?.edges)
      expect(RsAd03.diagnose(reversedOrder)[0]?.data?.hash).toBe(
        RsAd03.diagnose(out)[0]?.data?.hash,
      )
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-03 keeps clean, missing, and empty workspace cases neutral with honest applicability", async () => {
    const cleanRepo = await createRsAd03CleanWorkspace()
    const missingRepo = await createRustWorkspace("pulsar-rs-ad03-missing-", {
      "README.md": "# no cargo here\n",
    })
    const emptyWorkspace = await createRsAd03EmptyWorkspace()

    try {
      const clean = await runSignalCompute(RsAd03, cleanRepo, RsAd03.defaultConfig)
      const missing = await runSignalCompute(RsAd03, missingRepo, RsAd03.defaultConfig)
      const empty = await runSignalCompute(RsAd03, emptyWorkspace, RsAd03.defaultConfig)

      expect(clean.metadataStatus).toBe("loaded")
      expect(clean.packageCount).toBe(3)
      expect(clean.cycleCount).toBe(0)
      expect(clean.cycles).toEqual([])
      expect(RsAd03.score(clean)).toBe(1)
      expect(RsAd03.diagnose(clean)).toEqual([])
      expect(RsAd03.outputMetadata?.(clean)).toBeUndefined()

      expect(missing.metadataStatus).toBe("missing")
      expect(missing.packageCount).toBe(0)
      expect(RsAd03.score(missing)).toBe(1)
      expect(RsAd03.outputMetadata?.(missing)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsAd03.diagnose(missing)[0]).toMatchObject({
        severity: "warn",
        data: {
          metadataStatus: "missing",
          packageCount: 0,
        },
      })

      expect(empty.metadataStatus).toBe("loaded")
      expect(empty.packageCount).toBe(0)
      expect(RsAd03.score(empty)).toBe(1)
      expect(RsAd03.diagnose(empty)).toEqual([])
      expect(RsAd03.outputMetadata?.(empty)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanupWorkspace(cleanRepo)
      await cleanupWorkspace(missingRepo)
      await cleanupWorkspace(emptyWorkspace)
    }
  })

  test("RS-AD-03 normalizes diagnostic limits and cycle score pressure", async () => {
    const singleCycleRepo = await createRsAd03CycleWorkspace()
    const multiCycleRepo = await createRsAd03MultiCycleWorkspace()
    const largeCycleRepo = await createRsAd03LargeCycleWorkspace()

    try {
      const singleCycle = await runSignalCompute(RsAd03, singleCycleRepo, RsAd03.defaultConfig)
      const multiCycle = await runSignalCompute(RsAd03, multiCycleRepo, RsAd03.defaultConfig)
      const largeCycle = await runSignalCompute(RsAd03, largeCycleRepo, RsAd03.defaultConfig)
      const capped = await runSignalCompute(RsAd03, multiCycleRepo, {
        top_n_diagnostics: 1.9,
      })
      const hiddenNegative = await runSignalCompute(RsAd03, multiCycleRepo, {
        top_n_diagnostics: -1,
      })
      const hiddenNaN = await runSignalCompute(RsAd03, multiCycleRepo, {
        top_n_diagnostics: Number.NaN,
      })

      expect(capped.cycleCount).toBe(2)
      expect(capped.diagnosticLimit).toBe(1)
      expect(multiCycle.cycles.map((cycle) => cycle.crates)).toEqual([
        ["a", "b"],
        ["c", "d"],
      ])
      expect(largeCycle.cycleCount).toBe(1)
      expect(largeCycle.largestCycleSize).toBe(3)
      expect(RsAd03.diagnose(capped)).toHaveLength(1)
      expect(RsAd03.diagnose(capped)[0]?.data?.crates).toEqual(["a", "b"])
      expect(hiddenNegative.diagnosticLimit).toBe(0)
      expect(hiddenNaN.diagnosticLimit).toBe(0)
      expect(RsAd03.diagnose(hiddenNegative)).toEqual([])
      expect(RsAd03.diagnose(hiddenNaN)).toEqual([])
      expect(RsAd03.score(multiCycle)).toBeLessThan(RsAd03.score(singleCycle))
      expect(RsAd03.score(largeCycle)).toBeLessThan(RsAd03.score(singleCycle))
    } finally {
      await cleanupWorkspace(singleCycleRepo)
      await cleanupWorkspace(multiCycleRepo)
      await cleanupWorkspace(largeCycleRepo)
    }
  })
})
