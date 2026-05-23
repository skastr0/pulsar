import {
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
  ReferenceDataTag,
} from "@skastr0/pulsar-core/reference-data"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { InMemoryCacheLayer } from "@skastr0/pulsar-core/signal"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { RS_PACK_SIGNALS } from "../pack.js"
import {
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

  test("RS-AD-02 flags private and undeclared crate-boundary imports", async () => {
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
      expect(out.checkedImports).toBe(3)
      expect(out.violations).toHaveLength(2)
      expect(out.violations.map((violation) => violation.kind).sort()).toEqual([
        "boundary-rule",
        "non-public-target",
      ])

      const diagnostics = RsAd02.diagnose(out)
      expect(diagnostics).toHaveLength(2)
      expect(diagnostics.every((diagnostic) => typeof diagnostic.data?.hash === "string")).toBe(true)
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
        "non-public-target",
      ])
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-AD-03 detects feature-induced workspace crate cycles from cargo metadata", async () => {
    const metadata = {
      version: 1,
      workspaceRoot: "/repo",
      targetDirectory: "/repo/target",
      workspaceMembers: [
        "a 0.1.0 (path+file:///repo/crates/a)",
        "b 0.1.0 (path+file:///repo/crates/b)",
      ],
      packages: [
        {
          id: "a 0.1.0 (path+file:///repo/crates/a)",
          name: "a",
          version: "0.1.0",
          edition: "2021",
          manifestPath: "/repo/crates/a/Cargo.toml",
          dependencies: [
            {
              name: "b",
              kind: null,
              rename: null,
              optional: true,
              usesDefaultFeatures: true,
              features: ["bridge"],
              path: "../b",
              target: null,
              req: "*",
            },
          ],
          features: {},
          targets: [],
        },
        {
          id: "b 0.1.0 (path+file:///repo/crates/b)",
          name: "b",
          version: "0.1.0",
          edition: "2021",
          manifestPath: "/repo/crates/b/Cargo.toml",
          dependencies: [
            {
              name: "a",
              kind: "dev",
              rename: null,
              optional: false,
              usesDefaultFeatures: true,
              features: [],
              path: "../a",
              target: null,
              req: "*",
            },
          ],
          features: {},
          targets: [],
        },
      ],
      resolve: undefined,
    } satisfies RustProject["cargoMetadata"]

    const project: RustProject = {
      worktreePath: "/repo",
      manifests: [
        {
          name: "crates/a",
          path: "/repo/crates/a",
          manifestPath: "/repo/crates/a/Cargo.toml",
          packageName: "a",
        },
        {
          name: "crates/b",
          path: "/repo/crates/b",
          manifestPath: "/repo/crates/b/Cargo.toml",
          packageName: "b",
        },
      ],
      sourceFiles: [],
      cargoLockPath: undefined,
      cargoLock: undefined,
      cargoMetadata: metadata,
    }

    const out = await runSignalComputeWithProject(RsAd03, project, RsAd03.defaultConfig)

    expect(out.metadataStatus).toBe("loaded")
    expect(out.cycleCount).toBe(1)
    expect(out.cycles[0]?.crates).toEqual(["a", "b"])
    expect(out.cycles[0]?.featureInduced).toBe(true)

    const diagnostics = RsAd03.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.location?.file).toBe("/repo/crates/a/Cargo.toml")
    expect(typeof diagnostics[0]?.data?.hash).toBe("string")
  })
})
