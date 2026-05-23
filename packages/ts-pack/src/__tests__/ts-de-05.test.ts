import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { SignalContextTag } from "@skastr0/pulsar-core/signal"
import {
  CalibrationContextTag,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsDe05 } from "../signals/ts-de-05-duplicate-versions.js"
import { createTempRepo, type TempRepo } from "./test-repo.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-de-05-")
})

afterEach(async () => {
  await repo.cleanup()
})

const runCompute = async (
  calibration?: Parameters<typeof makeResolvedCalibrationContext>[0],
) => runComputeWithConfig(TsDe05.defaultConfig, calibration)

const runComputeWithConfig = async (
  config: typeof TsDe05.defaultConfig,
  calibration?: Parameters<typeof makeResolvedCalibrationContext>[0],
) =>
  Effect.runPromise(
    (calibration === undefined
      ? TsDe05.compute(config, new Map())
      : TsDe05.compute(config, new Map()).pipe(
          Effect.provideService(
            CalibrationContextTag,
            makeResolvedCalibrationContext(calibration),
          ),
        )
    ).pipe(
      Effect.provideService(
        SignalContextTag,
        {
          gitSha: "TEST",
          worktreePath: repo.root,
          changedHunks: [],
        },
      ),
    ) as Effect.Effect<
      Awaited<ReturnType<typeof TsDe05.compute>> extends Effect.Effect<infer A, any, any> ? A : never,
      unknown,
      never
    >,
  )

describe("TS-DE-05 (duplicate dependency versions)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-DE-05"),
    )
    const registry = await Effect.runPromise(buildRegistry([TsDe05]))
    const out = await runCompute()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsDe05).toMatchObject({
      id: "TS-DE-05-duplicate-dependency-versions",
      title: "Duplicate dependency versions",
      aliases: ["TS-DE-05"],
      tier: 1,
      category: "dependency-entropy",
      kind: "structural",
      cacheVersion: "factor-policy-v1-diagnostic-limit-v1-pnpm-chain-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsDe05.id)
    expect(registered?.title).toBe(TsDe05.title)
    expect(registered?.cacheVersion).toContain(TsDe05.cacheVersion)
    expect(registry.byId.get("TS-DE-05")?.id).toBe(TsDe05.id)
    expect(factorLedger?.signalId).toBe(TsDe05.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsDe05.configSchema)(TsDe05.defaultConfig)

    expect(decoded.top_n_diagnostics).toBe(10)
  })

  test("reports no duplicates for a flat lockfile", async () => {
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": { "": { "name": "workspace" } },',
        '  "packages": {',
        '    "alpha": ["alpha@1.0.0", "", {}, "hash"],',
        '    "beta": ["beta@2.0.0", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.duplicates).toHaveLength(0)
    expect(out.lockfileStatus).toBe("bun")
    expect(out.totalPackages).toBe(2)
    expect(out.totalDuplicateInstances).toBe(0)
    expect(out.diagnosticLimit).toBe(10)
    expect(TsDe05.inputs).toEqual([])
    expect(TsDe05.score(out)).toBe(1)
    expect(TsDe05.diagnose(out)).toEqual([])
  })

  test("groups duplicate versions and records workspace pull-in chains", async () => {
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": {',
        '    "packages/app": {',
        '      "name": "@repo/app",',
        '      "dependencies": { "alpha": "1.0.0", "wrapper": "1.0.0" }',
        "    }",
        "  },",
        '  "packages": {',
        '    "alpha": ["alpha@1.0.0", "", {}, "hash"],',
        '    "wrapper": ["wrapper@1.0.0", "", { "dependencies": { "alpha": "2.0.0" } }, "hash"],',
        '    "wrapper/alpha": ["alpha@2.0.0", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.name).toBe("alpha")
    expect(out.duplicates[0]?.versions).toEqual(["1.0.0", "2.0.0"])
    expect(out.duplicates[0]?.directVersions).toEqual(["1.0.0"])
    expect(out.duplicates[0]?.evidenceKind).toBe("transitive-lockfile-duplicate")
    expect(out.duplicates[0]?.pullInChains).toContainEqual({
      version: "2.0.0",
      chain: ["@repo/app", "wrapper", "alpha"],
    })
    expect(TsDe05.score(out)).toBeLessThan(1)
    expect(TsDe05.score(out)).toBeGreaterThan(0.85)
    const diagnostics = TsDe05.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("info")
    expect(diagnostics[0]?.message).toContain("Duplicate transitive")
    const diagnosticData = diagnostics[0]?.data as {
      readonly pullInChains: ReadonlyArray<{ readonly version: string; readonly chain: ReadonlyArray<string> }>
    }
    expect(diagnosticData).toMatchObject({
      name: "alpha",
      versions: ["1.0.0", "2.0.0"],
      directVersions: ["1.0.0"],
      instanceCount: 2,
      directInstanceCount: 1,
      evidenceKind: "transitive-lockfile-duplicate",
    })
    expect(diagnosticData.pullInChains).toContainEqual({
      version: "2.0.0",
      chain: ["@repo/app", "wrapper", "alpha"],
    })
  })

  test("warns more strongly for direct workspace duplicate versions", async () => {
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": {',
        '    "packages/app": {',
        '      "name": "@repo/app",',
        '      "dependencies": { "alpha": "1.0.0" }',
        "    },",
        '    "packages/worker": {',
        '      "name": "@repo/worker",',
        '      "dependencies": { "alpha": "2.0.0" }',
        "    }",
        "  },",
        '  "packages": {',
        '    "alpha": ["alpha@1.0.0", "", {}, "hash"],',
        '    "alpha@2": ["alpha@2.0.0", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.name).toBe("alpha")
    expect(out.duplicates[0]?.directVersions).toEqual(["1.0.0", "2.0.0"])
    expect(out.duplicates[0]?.directInstanceCount).toBe(2)
    expect(out.duplicates[0]?.evidenceKind).toBe("direct-workspace-duplicate")
    expect(TsDe05.score(out)).toBeLessThan(0.8)
    const diagnostics = TsDe05.diagnose(out)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.message).toContain("Duplicate direct")
    expect(diagnostics[0]?.data).toMatchObject({
      name: "alpha",
      versions: ["1.0.0", "2.0.0"],
      directVersions: ["1.0.0", "2.0.0"],
      instanceCount: 2,
      directInstanceCount: 2,
      evidenceKind: "direct-workspace-duplicate",
      policyDecisions: [],
    })
  })

  test("diagnostics honor sanitized top_n_diagnostics", async () => {
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": {',
        '    "packages/app": {',
        '      "name": "@repo/app",',
        '      "dependencies": { "alpha": "1.0.0", "beta": "1.0.0" }',
        "    },",
        '    "packages/worker": {',
        '      "name": "@repo/worker",',
        '      "dependencies": { "alpha": "2.0.0", "beta": "2.0.0" }',
        "    }",
        "  },",
        '  "packages": {',
        '    "alpha": ["alpha@1.0.0", "", {}, "hash"],',
        '    "alpha@2": ["alpha@2.0.0", "", {}, "hash"],',
        '    "beta": ["beta@1.0.0", "", {}, "hash"],',
        '    "beta@2": ["beta@2.0.0", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const capped = await runComputeWithConfig({
      ...TsDe05.defaultConfig,
      top_n_diagnostics: 1.8,
    })
    expect(capped.diagnosticLimit).toBe(1)
    expect(TsDe05.diagnose(capped)).toHaveLength(1)

    const negative = await runComputeWithConfig({
      ...TsDe05.defaultConfig,
      top_n_diagnostics: -1,
    })
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsDe05.diagnose(negative)).toEqual([])

    const nan = await runComputeWithConfig({
      ...TsDe05.defaultConfig,
      top_n_diagnostics: Number.NaN,
    })
    expect(nan.diagnosticLimit).toBe(0)
    expect(TsDe05.diagnose(nan)).toEqual([])

    const infinite = await runComputeWithConfig({
      ...TsDe05.defaultConfig,
      top_n_diagnostics: Number.POSITIVE_INFINITY,
    })
    expect(infinite.diagnosticLimit).toBe(0)
    expect(TsDe05.diagnose(infinite)).toEqual([])
  })

  test("project modules can suppress legitimate transitive host SDK duplicates with attribution", async () => {
    await repo.write(
      "bun.lock",
      [
        "{",
        '  "lockfileVersion": 1,',
        '  "workspaces": {',
        '    "apps/plugin": {',
        '      "name": "@repo/plugin",',
        '      "devDependencies": { "@host/sdk": "1.0.0" },',
        '      "dependencies": { "effect": "^3.0.0" }',
        "    }",
        "  },",
        '  "packages": {',
        '    "effect": ["effect@3.0.0", "", {}, "hash"],',
        '    "@host/sdk": ["@host/sdk@1.0.0", "", { "dependencies": { "effect": "4.0.0-beta.1" } }, "hash"],',
        '    "@host/sdk/effect": ["effect@4.0.0-beta.1", "", {}, "hash"]',
        "  }",
        "}",
      ].join("\n"),
    )

    const processor = defineCalibrationProcessor({
      id: "host-sdk-duplicates",
      moduleId: "repo-policy",
      moduleVersion: "0.0.0",
      slot: "typescript.dependency-version-policy",
      role: "factor-policy",
      priority: 10,
      fingerprint: "host-sdk-duplicates-v1",
      process: (current) =>
        Effect.succeed(
          current.value.packageName === "effect" &&
            current.value.pullInChains.some((entry) =>
              entry.chain.some((part) => part.startsWith("@host/sdk")),
            )
            ? {
                value: {
                  ...current.value,
                  visible: false,
                  penaltyWeight: 0,
                },
                decisions: [{
                  moduleId: "repo-policy",
                  processorId: "host-sdk-duplicates",
                  slot: "typescript.dependency-version-policy",
                  action: "suppress-host-sdk-duplicate",
                  confidence: "high",
                  reason: "host SDK owns an isolated incompatible dependency line",
                  ruleId: "repo.host-sdk-duplicate.v1",
                  factorPaths: [
                    `${current.value.factorPathPrefix}.visible`,
                    `${current.value.factorPathPrefix}.penalty_weight`,
                  ],
                  before: current.value,
                  after: { ...current.value, visible: false, penaltyWeight: 0 },
                  evidence: [{ kind: "package", value: current.value.packageName }],
                }],
              }
            : current,
        ),
    })

    const out = await runCompute({
      repoFacts: {
        repoRoot: repo.root,
        fingerprint: "test",
        detectedTechnologies: ["host-sdk"],
        sourceExtensions: [".ts"],
      },
      activeModules: [],
      processors: [processor],
    })
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-DE-05"),
    )
    const registeredLedger = registered?.factorLedger?.(out)

    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.visible).toBe(false)
    expect(out.calibrationDecisions[0]?.ruleId).toBe("repo.host-sdk-duplicate.v1")
    expect(out.factorLedger.entries).toContainEqual(
      expect.objectContaining({
        path: "duplicate_versions.effect.visible",
        value: false,
        source: "module",
        attribution: expect.objectContaining({
          moduleId: "repo-policy",
          processorId: "host-sdk-duplicates",
          ruleId: "repo.host-sdk-duplicate.v1",
        }),
      }),
    )
    expect(out.factorLedger.entries).toContainEqual(
      expect.objectContaining({
        path: "duplicate_versions.effect.penalty_weight",
        value: 0,
        source: "module",
        scoreRole: "penalty",
        attribution: expect.objectContaining({
          ruleId: "repo.host-sdk-duplicate.v1",
        }),
      }),
    )
    expect(registeredLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "duplicate_versions.effect.visible",
        source: "module",
        attribution: expect.objectContaining({
          ruleId: "repo.host-sdk-duplicate.v1",
        }),
      }),
    )
    expect(registeredLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        source: "signal-default",
      }),
    )
    expect(TsDe05.score(out)).toBe(1)
    expect(TsDe05.diagnose(out)).toEqual([])
  })

  test("groups duplicate versions from package-lock.json", async () => {
    await repo.write(
      "package-lock.json",
      JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {
            "": {
              name: "workspace",
              dependencies: {
                alpha: "1.0.0",
                wrapper: "1.0.0",
              },
            },
            "node_modules/alpha": {
              version: "1.0.0",
            },
            "node_modules/wrapper": {
              version: "1.0.0",
              dependencies: {
                alpha: "2.0.0",
              },
            },
            "node_modules/wrapper/node_modules/alpha": {
              version: "2.0.0",
            },
          },
        },
        null,
        2,
      ),
    )

    const out = await runCompute()
    expect(out.lockfileStatus).toBe("npm")
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.name).toBe("alpha")
    expect(out.duplicates[0]?.versions).toEqual(["1.0.0", "2.0.0"])
    expect(out.duplicates[0]?.directVersions).toEqual(["1.0.0"])
    expect(out.duplicates[0]?.evidenceKind).toBe("transitive-lockfile-duplicate")
    expect(TsDe05.score(out)).toBeLessThan(1)
    expect(TsDe05.diagnose(out)[0]?.message).toContain("Duplicate transitive")
  })

  test("preserves scoped package names from package-lock nested chains", async () => {
    await repo.write(
      "package-lock.json",
      JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {
            "": {
              name: "workspace",
              dependencies: {
                "@scope/alpha": "1.0.0",
                wrapper: "1.0.0",
              },
            },
            "node_modules/@scope/alpha": {
              version: "1.0.0",
            },
            "node_modules/wrapper": {
              version: "1.0.0",
              dependencies: {
                "@scope/alpha": "2.0.0",
              },
            },
            "node_modules/wrapper/node_modules/@scope/alpha": {
              version: "2.0.0",
            },
          },
        },
        null,
        2,
      ),
    )

    const out = await runCompute()
    expect(out.lockfileStatus).toBe("npm")
    expect(out.duplicates[0]?.name).toBe("@scope/alpha")
    expect(out.duplicates[0]?.pullInChains).toContainEqual({
      version: "2.0.0",
      chain: ["workspace", "wrapper", "@scope/alpha"],
    })
  })

  test("warns for package-lock direct workspace duplicate versions", async () => {
    await repo.write(
      "package-lock.json",
      JSON.stringify(
        {
          lockfileVersion: 3,
          packages: {
            "": {
              name: "workspace",
            },
            "packages/app": {
              name: "@repo/app",
              dependencies: {
                alpha: "1.0.0",
              },
            },
            "packages/app/node_modules/alpha": {
              version: "1.0.0",
            },
            "packages/worker": {
              name: "@repo/worker",
              dependencies: {
                alpha: "2.0.0",
              },
            },
            "packages/worker/node_modules/alpha": {
              version: "2.0.0",
            },
          },
        },
        null,
        2,
      ),
    )

    const out = await runCompute()
    expect(out.lockfileStatus).toBe("npm")
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.name).toBe("alpha")
    expect(out.duplicates[0]?.directVersions).toEqual(["1.0.0", "2.0.0"])
    expect(out.duplicates[0]?.directInstanceCount).toBe(2)
    expect(out.duplicates[0]?.evidenceKind).toBe("direct-workspace-duplicate")
    expect(TsDe05.score(out)).toBeLessThan(0.8)
    expect(TsDe05.diagnose(out)[0]?.severity).toBe("warn")
    expect(TsDe05.diagnose(out)[0]?.message).toContain("Duplicate direct")
  })

  test("groups duplicate versions from pnpm lockfiles", async () => {
    await repo.write(
      "pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  .:",
        "    dependencies:",
        "      alpha:",
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "      wrapper:",
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "",
        "packages:",
        "",
        "  alpha@1.0.0:",
        "    resolution: {integrity: sha512-root}",
        "",
        "  alpha@2.0.0:",
        "    resolution: {integrity: sha512-nested}",
        "",
        "  wrapper@1.0.0:",
        "    resolution: {integrity: sha512-wrapper}",
        "    dependencies:",
        "      alpha:",
        "        specifier: 2.0.0",
        "        version: 2.0.0",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.lockfileStatus).toBe("pnpm")
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.name).toBe("alpha")
    expect(out.duplicates[0]?.versions).toEqual(["1.0.0", "2.0.0"])
    expect(out.duplicates[0]?.directVersions).toEqual(["1.0.0"])
    expect(out.duplicates[0]?.evidenceKind).toBe("transitive-lockfile-duplicate")
    expect(out.duplicates[0]?.pullInChains).toContainEqual({
      version: "2.0.0",
      chain: ["workspace", "wrapper", "alpha"],
    })
    expect(TsDe05.score(out)).toBeLessThan(1)
  })

  test("warns for pnpm direct workspace duplicate versions", async () => {
    await repo.write(
      "pnpm-lock.yaml",
      [
        "lockfileVersion: '9.0'",
        "",
        "importers:",
        "",
        "  packages/app:",
        "    dependencies:",
        "      alpha:",
        "        specifier: 1.0.0",
        "        version: 1.0.0",
        "",
        "  packages/worker:",
        "    dependencies:",
        "      alpha:",
        "        specifier: 2.0.0",
        "        version: 2.0.0",
        "",
        "packages:",
        "",
        "  alpha@1.0.0:",
        "    resolution: {integrity: sha512-one}",
        "",
        "  alpha@2.0.0:",
        "    resolution: {integrity: sha512-two}",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.lockfileStatus).toBe("pnpm")
    expect(out.duplicates).toHaveLength(1)
    expect(out.duplicates[0]?.name).toBe("alpha")
    expect(out.duplicates[0]?.directVersions).toEqual(["1.0.0", "2.0.0"])
    expect(out.duplicates[0]?.directInstanceCount).toBe(2)
    expect(out.duplicates[0]?.evidenceKind).toBe("direct-workspace-duplicate")
    expect(TsDe05.diagnose(out)[0]?.severity).toBe("warn")
  })

  test("unsupported lockfiles skip duplicate-version analysis without failing", async () => {
    await repo.write("yarn.lock", "")
    const out = await runCompute()
    expect(out.lockfileStatus).toBe("unsupported")
    expect(out.lockfileFiles).toEqual(["yarn.lock"])
    expect(out.duplicates).toEqual([])
    expect(out.diagnosticLimit).toBe(10)
    expect(TsDe05.score(out)).toBe(1)
    expect(TsDe05.diagnose(out)[0]?.severity).toBe("info")
    expect(TsDe05.diagnose(out)[0]?.data).toEqual({
      lockfileStatus: "unsupported",
      files: ["yarn.lock"],
    })

    const capped = await runComputeWithConfig({
      ...TsDe05.defaultConfig,
      top_n_diagnostics: 0,
    })
    expect(capped.diagnosticLimit).toBe(0)
    expect(TsDe05.diagnose(capped)).toEqual([])
  })

  test("missing lockfiles skip duplicate-version analysis without failing", async () => {
    const out = await runCompute()
    expect(out.lockfileStatus).toBe("missing")
    expect(out.lockfileFiles).toEqual([])
    expect(out.duplicates).toEqual([])
    expect(out.diagnosticLimit).toBe(10)
    expect(TsDe05.score(out)).toBe(1)
    expect(TsDe05.diagnose(out)[0]?.data).toEqual({
      lockfileStatus: "missing",
      files: [],
    })

    const capped = await runComputeWithConfig({
      ...TsDe05.defaultConfig,
      top_n_diagnostics: 0,
    })
    expect(capped.diagnosticLimit).toBe(0)
    expect(TsDe05.diagnose(capped)).toEqual([])
  })
})
