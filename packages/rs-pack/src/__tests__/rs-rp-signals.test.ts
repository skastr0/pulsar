import { summarize } from "@skastr0/pulsar-core/signal"
import { buildRegistry, computeConfigHash } from "@skastr0/pulsar-core/scoring"
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { mkdir, writeFile } from "node:fs/promises"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  SHARED_SIGNALS,
  SharedChurn01,
  type SharedChurn01Output,
} from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS } from "@skastr0/pulsar-ts-pack"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RsRp01 } from "../signals/rs-rp-01-hotspots.js"
import { RsRp02 } from "../signals/rs-rp-02-compile-time.js"
import { RsRp03 } from "../signals/rs-rp-03-pr-size.js"
import {
  cleanupWorkspace,
  createRustWorkspace,
  runSignalCompute,
  runSignalComputeWithContext,
} from "./helpers.js"

const execFileAsync = promisify(execFile)

type ComplexityByFileFixture = Readonly<Record<string, unknown>> & {
  readonly byFile: ReadonlyMap<string, { readonly max: number }>
}

describe("RS-RP-* signals", () => {
  test("RS-RP-01 declares identity, config, cache, compound inputs, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsRp01.id),
        { ...RsRp01, cacheVersion: `${RsRp01.cacheVersion}-next` },
      ]),
    )
    const inputPolicyRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsRp01.id),
        {
          ...RsRp01,
          inputs: [
            { ...RsRp01.inputs[0]!, cacheFingerprint: "rs-rp-01-complexity-input-next" },
            RsRp01.inputs[1]!,
          ],
        },
      ]),
    )
    const registered = registry.byId.get("RS-RP-01")
    const decoded = Schema.decodeUnknownSync(RsRp01.configSchema)(RsRp01.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsRp01.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsRp01.id, versionedRegistry, undefined)
    const inputPolicyCacheHash = computeConfigHash(RsRp01.id, inputPolicyRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsRp01.id, registry, {
      id: "rs-rp-01-contract",
      domain: "test",
      signal_overrides: {
        [RsRp01.id]: {
          config: {
            ...RsRp01.defaultConfig,
            min_churn: 4,
          },
        },
      },
    })

    expect(RsRp01).toMatchObject({
      id: "RS-RP-01-hotspots",
      aliases: ["RS-RP-01"],
      title: "Hotspots",
      tier: 1.5,
      category: "review-pain",
      kind: "compound",
      cacheVersion: "rust-hotspot-config-compound-applicability-ranking-v2",
    })
    expect(decoded).toEqual({
      top_n: 10,
      min_churn: 2,
      min_complexity: 5,
    })
    expect(RsRp01.inputs.map((input) => input.id)).toEqual([
      "RS-LD-05-cyclomatic-complexity",
      "SHARED-CHURN-01-recent-churn",
    ])
    expect(RsRp01.inputs.every((input) => typeof input.cacheFingerprint === "string")).toBe(true)
    expect(registered?.id).toBe(RsRp01.id)
    expect(registry.byId.get("RS-RP-01")?.id).toBe(RsRp01.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(inputPolicyCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.min_churn",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.min_complexity",
        affectsScore: true,
        scoreRole: "threshold",
      }),
    )
  })

  test("RS-RP-01 combines churn and complexity into hotspots", async () => {
    const inputs = new Map<string, unknown>([
      [
        "RS-LD-05-cyclomatic-complexity",
        {
          functions: [],
          byFile: new Map([
            ["/repo/a.rs", summarize([5])],
            ["/repo/b.rs", summarize([20])],
            ["/repo/c.rs", summarize([15])],
          ]),
          overThresholdCount: 2,
          totalFunctions: 3,
          analysisMode: "standard-cyclomatic",
        } satisfies ComplexityByFileFixture,
      ],
      [
        "SHARED-CHURN-01-recent-churn",
        {
          byFile: new Map([
            ["/repo/a.rs", 2],
            ["/repo/b.rs", 9],
            ["/repo/c.rs", 12],
          ]),
          windowDays: 90,
          totalCommits: 42,
        } satisfies SharedChurn01Output,
      ],
    ])
    const out = await Effect.runPromise(RsRp01.compute(RsRp01.defaultConfig, inputs))
    expect(out.totalFilesConsidered).toBe(3)
    expect(out.hotspotFileCount).toBe(3)
    expect(out.hotspots.map((hotspot) => hotspot.file)).toEqual([
      "/repo/b.rs",
      "/repo/c.rs",
      "/repo/a.rs",
    ])
    expect(out.hotspots[0]).toMatchObject({
      churn: 9,
      complexity: 20,
      hotspotScore: 180,
      quadrant: "top-right",
      rank: 1,
    })
    expect(out.topRightShare).toBeCloseTo(2 / 3)
    expect(out.explanation.primitiveInputs.map((input) => input.state)).toEqual([
      "present",
      "present",
    ])
    expect(RsRp01.score(out)).toBeLessThan(1)
    expect(RsRp01.outputMetadata?.(out)).toBeUndefined()
    expect(RsRp01.diagnose(out)[0]).toMatchObject({
      severity: "warn",
      message: "Hotspot #1: /repo/b.rs (churn=9, complexity=20.0)",
      data: expect.objectContaining({
        analysisMode: "rust-churn-complexity-hotspots",
        scoreMode: "bounded-hotspot-pressure",
        scoreDenominator: "aligned-churn-complexity-files",
      }),
    })
  })

  test("RS-RP-01 normalizes config, applicability, and diagnostic caps", async () => {
    const complexity = {
      functions: [],
      byFile: new Map([
        ["/repo/a.rs", summarize([8])],
        ["/repo/b.rs", summarize([12])],
        ["/repo/churn-only.rs", summarize([1])],
      ]),
      overThresholdCount: 2,
      totalFunctions: 3,
      analysisMode: "standard-cyclomatic",
    } satisfies ComplexityByFileFixture
    const churn = {
      byFile: new Map([
        ["/repo/a.rs", 3],
        ["/repo/b.rs", 7],
        ["/repo/other.rs", 10],
      ]),
      windowDays: 90,
      totalCommits: 20,
    } satisfies SharedChurn01Output
    const out = await Effect.runPromise(
      RsRp01.compute(
        {
          ...RsRp01.defaultConfig,
          top_n: 1.9,
          min_churn: 3.8,
          min_complexity: 8.2,
        },
        new Map<string, unknown>([
          ["RS-LD-05", complexity],
          ["SHARED-CHURN-01", churn],
        ]),
      ),
    )
    const hiddenOut = await Effect.runPromise(
      RsRp01.compute(
        {
          ...RsRp01.defaultConfig,
          top_n: Number.NaN,
        },
        new Map<string, unknown>([
          ["RS-LD-05", complexity],
          ["SHARED-CHURN-01", churn],
        ]),
      ),
    )
    const missingOut = await Effect.runPromise(
      RsRp01.compute(
        RsRp01.defaultConfig,
        new Map<string, unknown>([["RS-LD-05", complexity]]),
      ),
    )
    const noOverlapOut = await Effect.runPromise(
      RsRp01.compute(
        RsRp01.defaultConfig,
        new Map<string, unknown>([
          ["RS-LD-05", complexity],
          [
            "SHARED-CHURN-01",
            {
              byFile: new Map([["/repo/other.rs", 10]]),
              windowDays: 90,
              totalCommits: 10,
            } satisfies SharedChurn01Output,
          ],
        ]),
      ),
    )
    const cleanOut = await Effect.runPromise(
      RsRp01.compute(
        RsRp01.defaultConfig,
        new Map<string, unknown>([
          ["RS-LD-05", complexity],
          [
            "SHARED-CHURN-01",
            {
              byFile: new Map([["/repo/churn-only.rs", 1]]),
              windowDays: 90,
              totalCommits: 1,
            } satisfies SharedChurn01Output,
          ],
        ]),
      ),
    )

    expect(out.diagnosticLimit).toBe(1)
    expect(out.minChurn).toBe(3)
    expect(out.minComplexity).toBe(8)
    expect(out.hotspotFileCount).toBe(2)
    expect(RsRp01.diagnose(out)).toHaveLength(1)
    expect(hiddenOut.diagnosticLimit).toBe(0)
    expect(RsRp01.diagnose(hiddenOut)).toEqual([])
    expect(RsRp01.outputMetadata?.(missingOut)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(RsRp01.diagnose(missingOut)[0]).toMatchObject({
      severity: "warn",
      message: "RS-RP-01 missing required compound inputs: SHARED-CHURN-01-recent-churn",
    })
    expect(RsRp01.outputMetadata?.(noOverlapOut)).toEqual({
      applicability: "not_applicable",
    })
    expect(cleanOut.totalFilesConsidered).toBe(1)
    expect(cleanOut.hotspotFileCount).toBe(0)
    expect(RsRp01.score(cleanOut)).toBe(1)
    expect(RsRp01.outputMetadata?.(cleanOut)).toBeUndefined()
  })

  test("RS-RP-01 score pressure is monotonic over aligned hotspot files", async () => {
    const complexity = {
      functions: [],
      byFile: new Map([
        ["/repo/a.rs", summarize([12])],
        ["/repo/b.rs", summarize([12])],
        ["/repo/c.rs", summarize([12])],
      ]),
      overThresholdCount: 3,
      totalFunctions: 3,
      analysisMode: "standard-cyclomatic",
    } satisfies ComplexityByFileFixture
    const run = (churnEntries: ReadonlyArray<readonly [string, number]>) =>
      Effect.runPromise(
        RsRp01.compute(
          RsRp01.defaultConfig,
          new Map<string, unknown>([
            ["RS-LD-05", complexity],
            [
              "SHARED-CHURN-01",
              {
                byFile: new Map(churnEntries),
                windowDays: 90,
                totalCommits: churnEntries.reduce((sum, [, churn]) => sum + churn, 0),
              } satisfies SharedChurn01Output,
            ],
          ]),
        ),
      )

    const clean = await run([["/repo/a.rs", 1]])
    const mild = await run([["/repo/a.rs", 3]])
    const broad = await run([
      ["/repo/a.rs", 3],
      ["/repo/b.rs", 4],
      ["/repo/c.rs", 5],
    ])

    expect(RsRp01.score(clean)).toBe(1)
    expect(RsRp01.score(mild)).toBeLessThan(RsRp01.score(clean))
    expect(RsRp01.score(broad)).toBeLessThanOrEqual(RsRp01.score(mild))
    expect(broad.hotspots.map((hotspot) => hotspot.rank)).toEqual([1, 2, 3])
  })

  test("RS-RP-02 declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    const versionedRegistry = await Effect.runPromise(
      buildRegistry([
        ...SHARED_SIGNALS,
        ...RS_PACK_SIGNALS.filter((signal) => signal.id !== RsRp02.id),
        { ...RsRp02, cacheVersion: `${RsRp02.cacheVersion}-next` },
      ]),
    )
    const registered = registry.byId.get("RS-RP-02")
    const decoded = Schema.decodeUnknownSync(RsRp02.configSchema)(RsRp02.defaultConfig)
    const factorLedger = registered?.factorLedger?.({})
    const baseCacheHash = computeConfigHash(RsRp02.id, registry, undefined)
    const versionedCacheHash = computeConfigHash(RsRp02.id, versionedRegistry, undefined)
    const configuredCacheHash = computeConfigHash(RsRp02.id, registry, {
      id: "rs-rp-02-contract",
      domain: "test",
      signal_overrides: {
        [RsRp02.id]: {
          config: {
            ...RsRp02.defaultConfig,
            top_n_diagnostics: 1,
          },
        },
      },
    })

    expect(RsRp02).toMatchObject({
      id: "RS-RP-02-compile-time",
      aliases: ["RS-RP-02"],
      title: "Compile time",
      tier: 1,
      category: "review-pain",
      kind: "structural",
      cacheVersion: "cargo-timings-config-applicability-diagnostics-v1",
      inputs: [],
    })
    expect(decoded).toEqual({
      top_n_diagnostics: 10,
      measure_live_builds: false,
    })
    expect(registered?.id).toBe(RsRp02.id)
    expect(registry.byId.get("RS-RP-02")?.id).toBe(RsRp02.id)
    expect(baseCacheHash).not.toBe(versionedCacheHash)
    expect(baseCacheHash).not.toBe(configuredCacheHash)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        affectsScore: false,
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.measure_live_builds",
        affectsScore: true,
        scoreRole: "evidence",
      }),
    )
  })

  test("RS-RP-02 parses existing cargo timing output without live builds", async () => {
    const repo = await createRustWorkspace("pulsar-rs-rp02-", {
      "Cargo.toml": [
        "[package]",
        'name = "compile-fixture"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn meaning() -> u32 { 42 }",
        "",
      ].join("\n"),
    })

    try {
      await mkdir(`${repo}/target/cargo-timings`, { recursive: true })
      await writeFile(
        `${repo}/target/cargo-timings/cargo-timing.html`,
        [
          "<script>",
          "const UNIT_DATA = [",
          '{"i":0,"name":"compile-fixture","duration":1.5,"unblocked_units":[1,2],"unblocked_rmeta_units":[3]},',
          '{"i":1,"name":"compile-fixture","duration":0.8,"unblocked_units":[],"unblocked_rmeta_units":[]},',
          '{"i":2,"name":"helper-crate","duration":0.5,"unblocked_units":[],"unblocked_rmeta_units":[]}',
          "];",
          "</script>",
        ].join("\n"),
      )
      const out = await runSignalCompute(RsRp02, repo, RsRp02.defaultConfig)
      expect(out.buildStatus).toBe("measured")
      expect(out.totalUnits).toBe(3)
      expect(out.cacheProbeMode).toBe("unavailable")
      expect(out.measurementMode).toBe("existing-cargo-timings")
      expect(out.crates[0]).toMatchObject({
        crate: "compile-fixture",
        totalDurationMs: 2300,
        unitCount: 2,
        cascadeImpact: 3,
      })
      expect(out.crates[1]).toMatchObject({
        crate: "helper-crate",
        totalDurationMs: 500,
        unitCount: 1,
      })
      expect(RsRp02.score(out)).toBeCloseTo(0.77)
      expect(RsRp02.outputMetadata?.(out)).toBeUndefined()
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("RS-RP-02 normalizes diagnostics and applicability evidence", async () => {
    const measured = await createRustWorkspace("pulsar-rs-rp02-diagnostics-", {
      "Cargo.toml": [
        "[package]",
        'name = "compile-diagnostics"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": "pub fn meaning() -> u32 { 42 }\n",
    })
    const missingTiming = await createRustWorkspace("pulsar-rs-rp02-missing-", {
      "Cargo.toml": [
        "[package]",
        'name = "compile-missing"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": "pub fn meaning() -> u32 { 42 }\n",
    })
    const invalidTiming = await createRustWorkspace("pulsar-rs-rp02-invalid-", {
      "Cargo.toml": [
        "[package]",
        'name = "compile-invalid"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": "pub fn meaning() -> u32 { 42 }\n",
    })
    const noCargo = await createRustWorkspace("pulsar-rs-rp02-no-cargo-", {
      "README.md": "not a Cargo project\n",
    })

    try {
      await mkdir(`${measured}/target/cargo-timings`, { recursive: true })
      await writeFile(
        `${measured}/target/cargo-timings/cargo-timing.html`,
        [
          "<script>",
          "const UNIT_DATA = [",
          '{"i":0,"name":"slow-crate","duration":2.4,"unblocked_units":[],"unblocked_rmeta_units":[]},',
          '{"i":1,"name":"fast-crate","duration":0.2,"unblocked_units":[],"unblocked_rmeta_units":[]}',
          "];",
          "</script>",
        ].join("\n"),
      )
      await mkdir(`${invalidTiming}/target/cargo-timings`, { recursive: true })
      await writeFile(
        `${invalidTiming}/target/cargo-timings/cargo-timing.html`,
        '<script>const UNIT_DATA = [{"i":"bad","name":"compile-invalid","duration":1}];</script>',
      )

      const out = await runSignalCompute(RsRp02, measured, {
        ...RsRp02.defaultConfig,
        top_n_diagnostics: 1.8,
      })
      const hiddenOut = await runSignalCompute(RsRp02, measured, {
        ...RsRp02.defaultConfig,
        top_n_diagnostics: Number.NaN,
      })
      const missingOut = await runSignalCompute(RsRp02, missingTiming, RsRp02.defaultConfig)
      const invalidOut = await runSignalCompute(RsRp02, invalidTiming, RsRp02.defaultConfig)
      const noCargoOut = await runSignalCompute(RsRp02, noCargo, RsRp02.defaultConfig)
      const diagnostics = RsRp02.diagnose(out)

      expect(out.diagnosticLimit).toBe(1)
      expect(diagnostics).toHaveLength(1)
      expect(diagnostics[0]).toMatchObject({
        severity: "warn",
        message: "Compile hotspot slow-crate: 2.40s",
        data: expect.objectContaining({
          crate: "slow-crate",
          totalDurationMs: 2400,
          measurementMode: "existing-cargo-timings",
          scoreMode: "slowest-crate-compile-duration",
          scoreDenominator: "slowest-crate-duration-ms",
        }),
      })
      expect(hiddenOut.diagnosticLimit).toBe(0)
      expect(RsRp02.diagnose(hiddenOut)).toEqual([])
      expect(missingOut.unavailableReason).toBe("missing-timing-data")
      expect(RsRp02.outputMetadata?.(missingOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(RsRp02.diagnose(missingOut)[0]).toMatchObject({
        severity: "warn",
        message: "RS-RP-02 could not collect cargo timing data",
        data: expect.objectContaining({
          unavailableReason: "missing-timing-data",
        }),
      })
      expect(invalidOut.unavailableReason).toBe("invalid-timing-data")
      expect(RsRp02.outputMetadata?.(invalidOut)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(noCargoOut.unavailableReason).toBe("no-cargo-project")
      expect(RsRp02.outputMetadata?.(noCargoOut)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanupWorkspace(measured)
      await cleanupWorkspace(missingTiming)
      await cleanupWorkspace(invalidTiming)
      await cleanupWorkspace(noCargo)
    }
  })

  test("RS-RP-02 scores slower measured compile hotspots monotonically", () => {
    const unavailable = rsRp02Output({
      buildStatus: "unavailable",
      crates: [],
      totalUnits: 0,
      unavailableReason: "missing-timing-data",
    })
    const emptyMeasured = rsRp02Output({
      buildStatus: "measured",
      crates: [],
      totalUnits: 0,
    })
    const fast = rsRp02Output({
      buildStatus: "measured",
      crates: [
        {
          crate: "fast",
          totalDurationMs: 500,
          unitCount: 1,
          cascadeImpact: 0,
          incrementalCacheHitRate: undefined,
        },
      ],
      totalUnits: 1,
    })
    const slow = rsRp02Output({
      buildStatus: "measured",
      crates: [
        {
          crate: "slow",
          totalDurationMs: 5_000,
          unitCount: 1,
          cascadeImpact: 0,
          incrementalCacheHitRate: undefined,
        },
      ],
      totalUnits: 1,
    })

    expect(RsRp02.score(unavailable)).toBe(1)
    expect(RsRp02.score(emptyMeasured)).toBe(1)
    expect(RsRp02.score(fast)).toBeGreaterThan(RsRp02.score(slow))
    expect(RsRp02.score(slow)).toBeCloseTo(0.5)
  })

  test("RS-RP-03 counts diff size and new cross-crate import edges", async () => {
    const repo = await createRustWorkspace("pulsar-rs-rp03-", {
      "Cargo.toml": [
        "[workspace]",
        'members = ["crates/core", "crates/app"]',
        'resolver = "2"',
        "",
      ].join("\n"),
      "crates/core/Cargo.toml": [
        "[package]",
        'name = "pulsar_core"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "crates/core/src/lib.rs": [
        "pub mod api { pub struct Thing; }",
        "",
      ].join("\n"),
      "crates/app/Cargo.toml": [
        "[package]",
        'name = "pulsar_app"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
        "[dependencies]",
        'pulsar_core = { path = "../core" }',
        "",
      ].join("\n"),
      "crates/app/src/lib.rs": [
        "pub fn untouched() {}",
        "",
      ].join("\n"),
    })

    try {
      await initGitRepo(repo)
      await writeFile(
        `${repo}/crates/app/src/lib.rs`,
        [
          "use pulsar_core::api::Thing;",
          "pub fn changed(_thing: Thing) {}",
          "",
        ].join("\n"),
      )

      const out = await runSignalComputeWithContext(
        RsRp03,
        repo,
        RsRp03.defaultConfig,
        {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [
            {
              file: "crates/app/src/lib.rs",
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 2,
            },
          ],
        },
      )

      expect(out.linesAdded).toBeGreaterThanOrEqual(2)
      expect(out.newCrossCrateEdges.some((edge) => edge.toCrate === "pulsar_core")).toBe(true)
      expect(out.cratesTouched).toContain("pulsar_app")
    } finally {
      await cleanupWorkspace(repo)
    }
  })

  test("rust-only registry builds with RS pack signals", async () => {
    const registry = await Effect.runPromise(buildRegistry([...SHARED_SIGNALS, ...RS_PACK_SIGNALS]))
    expect(registry.has("SHARED-CHURN-01")).toBe(true)
    expect(registry.has("SHARED-02")).toBe(true)
    expect(registry.has("SHARED-03")).toBe(true)
    expect(registry.has("RS-RP-01")).toBe(true)
  })

  test("mixed TS+Rust registry builds and shared churn feeds Rust hotspots", async () => {
    const repo = await createRustWorkspace("pulsar-rs-rp01-mixed-", {
      "Cargo.toml": [
        "[package]",
        'name = "mixed-hotspot"',
        'version = "0.1.0"',
        'edition = "2021"',
        "",
      ].join("\n"),
      "src/lib.rs": [
        "pub fn hotspot(value: u32) -> u32 {",
        "    if value == 0 {",
        "        0",
        "    } else if value == 1 {",
        "        1",
        "    } else if value == 2 {",
        "        2",
        "    } else if value == 3 {",
        "        3",
        "    } else if value == 4 {",
        "        4",
        "    } else {",
        "        5",
        "    }",
        "}",
        "",
      ].join("\n"),
      "web.ts": "export const unused = 1\n",
    })

    try {
      await initGitRepo(repo)
      await amendTrackedFile(repo, "src/lib.rs", "2024-01-10T00:00:00Z")
      await amendTrackedFile(repo, "src/lib.rs", "2024-01-20T00:00:00Z")
      await amendTrackedFile(repo, "src/lib.rs", "2024-01-25T00:00:00Z")

      const registry = await Effect.runPromise(
        buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS, ...RS_PACK_SIGNALS]),
      )
      expect(registry.has("SHARED-CHURN-01")).toBe(true)
      expect(registry.has("SHARED-02")).toBe(true)
      expect(registry.has("SHARED-03")).toBe(true)

      const churn = await runSignalComputeWithContext(
        SharedChurn01,
        repo,
        SharedChurn01.defaultConfig,
        {
          gitSha: "HEAD",
          worktreePath: repo,
          changedHunks: [],
        },
      )
      const rustFile = `${repo}/src/lib.rs`
      expect(churn.byFile.get(rustFile)).toBeGreaterThanOrEqual(3)

      const hotspotOut = await Effect.runPromise(
        RsRp01.compute(
          RsRp01.defaultConfig,
          new Map<string, unknown>([
            [
              "RS-LD-05",
              {
                functions: [],
                byFile: new Map([[rustFile, summarize([6])]]),
                overThresholdCount: 0,
                totalFunctions: 1,
                analysisMode: "standard-cyclomatic",
              } satisfies ComplexityByFileFixture,
            ],
            ["SHARED-CHURN-01", churn],
          ]),
        ),
      )

      expect(hotspotOut.hotspots.some((entry) => entry.file === rustFile)).toBe(true)
    } finally {
      await cleanupWorkspace(repo)
    }
  }, 120_000)
})

const initGitRepo = async (repo: string): Promise<void> => {
  await execFileAsync("git", ["init"], { cwd: repo })
  await execFileAsync("git", ["add", "."], { cwd: repo })
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Pulsar",
      "-c",
      "user.email=pulsar@example.com",
      "commit",
      "-m",
      "fixture",
    ],
    { cwd: repo },
  )
}

const amendTrackedFile = async (repo: string, relativePath: string, dateIso: string): Promise<void> => {
  const fullPath = `${repo}/${relativePath}`
  const current = await Bun.file(fullPath).text()
  await writeFile(fullPath, `${current}// ${dateIso}\n`)
  await execFileAsync("git", ["add", relativePath], { cwd: repo })
  await execFileAsync(
    "git",
    [
      "-c",
      "user.name=Pulsar",
      "-c",
      "user.email=pulsar@example.com",
      "commit",
      "-m",
      `touch ${relativePath}`,
    ],
    {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: dateIso,
        GIT_COMMITTER_DATE: dateIso,
      },
    },
  )
}

const rsRp02Output = ({
  buildStatus,
  crates,
  totalUnits,
  unavailableReason,
}: {
  readonly buildStatus: Parameters<typeof RsRp02.score>[0]["buildStatus"]
  readonly crates: ReadonlyArray<Parameters<typeof RsRp02.score>[0]["crates"][number]>
  readonly totalUnits: number
  readonly unavailableReason?: Parameters<typeof RsRp02.score>[0]["unavailableReason"]
}): Parameters<typeof RsRp02.score>[0] => ({
  crates,
  totalUnits,
  buildStatus,
  ...(unavailableReason !== undefined ? { unavailableReason } : {}),
  timingSource: "cargo-timings-html",
  cacheProbeMode: "unavailable",
  measurementMode: "existing-cargo-timings",
  manifestCount: 1,
  diagnosticLimit: 10,
  scoreMode: "slowest-crate-compile-duration",
  scoreDenominator: "slowest-crate-duration-ms",
})
