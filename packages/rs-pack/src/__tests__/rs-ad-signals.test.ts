import {
  loadCanonicalReferenceDataEntries,
  makeReferenceData,
  ReferenceDataTag,
} from "@skastr0/pulsar-core/reference-data"
import { InMemoryCacheLayer } from "@skastr0/pulsar-core/signal"
import { describe, expect, test } from "bun:test"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer } from "effect"
import { parseCargoMetadata } from "../cargo-metadata.js"
import {
  RustProjectLayer,
  type RustProject,
} from "../project.js"
import { RsAd01 } from "../signals/rs-ad-01-visibility-surface.js"
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

describe("RS-AD-* signals", () => {
  test("RS-AD-01 summarizes pub ratios per module", async () => {
    const repo = await createRustWorkspace("pulsar-rs-ad01-", {
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

    try {
      const out = await runSignalCompute(RsAd01, repo, RsAd01.defaultConfig)
      const api = out.modules.find((module) => module.module === "ad-visibility-fixture::crate::api")
      const root = out.modules.find((module) => module.module === "ad-visibility-fixture::crate")

      expect(api).toBeDefined()
      expect(api?.pubRatio).toBeCloseTo(1 / 3)
      expect(root?.pubRatio).toBeCloseTo(1 / 2)
      expect(out.byModule.get("ad-visibility-fixture::crate::api")?.avg).toBeCloseTo(1 / 3)
    } finally {
      await cleanupWorkspace(repo)
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
    const metadata = parseCargoMetadata({
      version: 1,
      workspace_root: "/repo",
      target_directory: "/repo/target",
      workspace_members: [
        "a 0.1.0 (path+file:///repo/crates/a)",
        "b 0.1.0 (path+file:///repo/crates/b)",
      ],
      packages: [
        {
          id: "a 0.1.0 (path+file:///repo/crates/a)",
          name: "a",
          version: "0.1.0",
          edition: "2021",
          manifest_path: "/repo/crates/a/Cargo.toml",
          dependencies: [
            {
              name: "b",
              kind: null,
              rename: null,
              optional: true,
              uses_default_features: true,
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
          manifest_path: "/repo/crates/b/Cargo.toml",
          dependencies: [
            {
              name: "a",
              kind: "dev",
              rename: null,
              optional: false,
              uses_default_features: true,
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
      resolve: null,
    })

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
