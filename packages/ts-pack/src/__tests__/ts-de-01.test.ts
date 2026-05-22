import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import {
  appendCalibrationDecision,
  CalibrationContextTag,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
  type ResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsDe01 } from "../signals/ts-de-01-type-level-coupling.js"
import type { TsDe01Output } from "../signals/ts-de-01-coupling-output.js"
import { TsProjectLayer } from "../ts-project.js"
import { makePulsarSelfCalibrationContext } from "./pulsar-self-calibration.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (
  config = TsDe01.defaultConfig,
  calibration?: ResolvedCalibrationContext,
): Promise<TsDe01Output> => {
  const base = TsDe01.compute(config, new Map()).pipe(Effect.provide(TsProjectLayer(repo)))
  const program =
    calibration === undefined
      ? base
      : base.pipe(Effect.provideService(CalibrationContextTag, calibration))
  return Effect.runPromise(program as Effect.Effect<TsDe01Output, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-de-01-"))
  await writeFile(
    join(repo, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        baseUrl: ".",
        paths: {
          "#/*": ["src/*"],
        },
      },
      include: ["**/*.ts"],
    }),
  )
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe("TS-DE-01 (type-level coupling)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-DE-01"),
    )
    const registry = await Effect.runPromise(buildRegistry([TsDe01]))
    const out = await runCompute()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsDe01).toMatchObject({
      id: "TS-DE-01-type-level-coupling",
      title: "Type-level coupling",
      aliases: ["TS-DE-01"],
      tier: 1,
      category: "dependency-entropy",
      kind: "legibility",
      cacheVersion: "factor-policy-v1-diagnostic-limit-v1-fast-import-type-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsDe01.id)
    expect(registered?.title).toBe(TsDe01.title)
    expect(registered?.cacheVersion).toContain(TsDe01.cacheVersion)
    expect(registry.byId.get("TS-DE-01")?.id).toBe(TsDe01.id)
    expect(factorLedger?.signalId).toBe(TsDe01.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.precise_module_limit",
        value: 1_000,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("empty project: neutral score 1", async () => {
    const out = await runCompute()
    expect(out.totalModules).toBe(0)
    expect(out.modules).toEqual([])
    expect(out.factorLedger).toEqual({
      signalId: TsDe01.id,
      entries: [],
    })
    expect(TsDe01.outputMetadata?.(out)).toBeUndefined()
    expect(TsDe01.score(out)).toBe(1)
  })

  test("counts outgoing and incoming type references per module", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const b = await writeTs(
      "src/b.ts",
      [
        "import type { A } from './a'",
        "export type B = A | A",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byFile = new Map(out.modules.map((module) => [module.file, module]))

    expect(byFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(byFile.get(b)?.typesReferencedExternally).toBe(0)
    expect(byFile.get(a)?.externalTypesReferenced).toBe(0)
    expect(byFile.get(a)?.typesReferencedExternally).toBe(1)
  })

  test("runtime value imports do not count as type-level coupling", async () => {
    const a = await writeTs(
      "src/a.ts",
      [
        "export interface A { value: string }",
        "export const makeA = (): A => ({ value: 'a' })",
        "",
      ].join("\n"),
    )
    const b = await writeTs(
      "src/b.ts",
      [
        "import { makeA } from './a'",
        "export const value = makeA()",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byFile = new Map(out.modules.map((module) => [module.file, module]))

    expect(byFile.get(b)?.externalTypesReferenced).toBe(0)
    expect(byFile.get(a)?.typesReferencedExternally).toBe(0)
    expect(TsDe01.score(out)).toBe(1)
    expect(TsDe01.diagnose(out)).toEqual([])
  })

  test("large-project fast path counts imported type references syntactically", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const b = await writeTs(
      "src/b.ts",
      [
        "import type { A } from './a'",
        "export type B = A",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const byFile = new Map(out.modules.map((module) => [module.file, module]))

    expect(byFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(byFile.get(a)?.typesReferencedExternally).toBe(1)
  })

  test("large-project fast path counts default and namespace type imports", async () => {
    const defaultFile = await writeTs(
      "src/default-contract.ts",
      "export default interface DefaultContract { value: string }\n",
    )
    const namespaceFile = await writeTs(
      "src/namespace-contracts.ts",
      "export interface NamespaceContract { value: string }\n",
    )
    const consumer = await writeTs(
      "src/consumer.ts",
      [
        "import type DefaultContract from './default-contract'",
        "import type * as Contracts from './namespace-contracts'",
        "export type Consumer = DefaultContract | Contracts.NamespaceContract",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const byFile = new Map(out.modules.map((module) => [module.file, module]))

    expect(byFile.get(consumer)?.externalTypesReferenced).toBe(2)
    expect(byFile.get(consumer)?.counterparts).toEqual([
      {
        module: defaultFile,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
      {
        module: namespaceFile,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
    expect(byFile.get(defaultFile)?.typesReferencedExternally).toBe(1)
    expect(byFile.get(namespaceFile)?.typesReferencedExternally).toBe(1)
  })

  test("large-project fast path counts relative import-type references", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const b = await writeTs(
      "src/b.ts",
      [
        "export type B = import('./a').A",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const byFile = new Map(out.modules.map((module) => [module.file, module]))

    expect(byFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(byFile.get(b)?.counterparts).toEqual([
      {
        module: a,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
    expect(byFile.get(a)?.typesReferencedExternally).toBe(1)
  })

  test("large-project fast path resolves tsconfig path alias type imports", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const b = await writeTs(
      "src/b.ts",
      [
        "import type { A } from '#/a'",
        "export type B = A",
        "",
      ].join("\n"),
    )

    const precise = await runCompute()
    const fast = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const preciseByFile = new Map(precise.modules.map((module) => [module.file, module]))
    const fastByFile = new Map(fast.modules.map((module) => [module.file, module]))

    expect(preciseByFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(fastByFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(fastByFile.get(b)?.counterparts).toEqual([
      {
        module: a,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
    expect(fastByFile.get(a)?.typesReferencedExternally).toBe(1)
  })

  test("large-project fast path attributes re-export imports to original type definitions", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    await writeTs("src/index.ts", "export type { A } from './a'\n")
    const consumer = await writeTs(
      "src/consumer.ts",
      [
        "import type { A } from './index'",
        "export type Consumer = A",
        "",
      ].join("\n"),
    )

    const fast = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const consumerEntry = fast.modules.find((module) => module.file === consumer)

    expect(consumerEntry?.counterparts).toEqual([
      {
        module: a,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
  })

  test("large-project fast path resolves multi-hop re-export chains", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    await writeTs("src/index.ts", "export type { A } from './a'\n")
    await writeTs("src/public.ts", "export type { A } from './index'\n")
    const consumer = await writeTs(
      "src/consumer.ts",
      [
        "import type { A } from './public'",
        "export type Consumer = A",
        "",
      ].join("\n"),
    )

    const fast = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const consumerEntry = fast.modules.find((module) => module.file === consumer)

    expect(consumerEntry?.counterparts).toEqual([
      {
        module: a,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
  })

  test("large-project fast path deduplicates mixed references to the same target type", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const b = await writeTs(
      "src/b.ts",
      [
        "import type { A } from './a'",
        "export type B = A | import('./a').A",
        "",
      ].join("\n"),
    )

    const precise = await runCompute()
    const fast = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const preciseByFile = new Map(precise.modules.map((module) => [module.file, module]))
    const fastByFile = new Map(fast.modules.map((module) => [module.file, module]))

    expect(preciseByFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(fastByFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(fastByFile.get(b)?.counterparts).toEqual([
      {
        module: a,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
  })

  test("re-exported imports resolve to the original type-defining module", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    await writeTs("src/index.ts", "export type { A } from './a'\n")
    const consumer = await writeTs(
      "src/consumer.ts",
      [
        "import type { A } from './index'",
        "export type Consumer = A",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const consumerEntry = out.modules.find((module) => module.file === consumer)
    expect(consumerEntry?.counterparts).toEqual([
      {
        module: a,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
  })

  test("diagnostics surface counterpart data for the most coupled module", async () => {
    for (const file of ["a", "b", "c", "d", "e"]) {
      await writeTs(`src/${file}.ts`, `export interface ${file.toUpperCase()} {}\n`)
    }
    for (const file of ["one", "two", "three", "four"]) {
      await writeTs(`src/${file}.ts`, "export const value = 1\n")
    }
    await writeTs(
      "src/hub.ts",
      [
        "import type { A } from './a'",
        "import type { B } from './b'",
        "import type { C } from './c'",
        "import type { D } from './d'",
        "import type { E } from './e'",
        "export type Hub = A & B & C & D & E",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const diagnostics = TsDe01.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(TsDe01.score(out)).toBeCloseTo(0.6)
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("src/hub.ts"),
      location: { file: expect.stringContaining("src/hub.ts") },
      data: {
        file: expect.stringContaining("src/hub.ts"),
        outlierThreshold: out.outlierThreshold,
        counterparts: expect.any(Array),
      },
    })
    expect(diagnostics[0]?.data).toMatchObject({
      externalTypesReferenced: 5,
    })
  })

  test("diagnostics honor top_n_diagnostics as a sanitized total cap", async () => {
    await writeDiagnosticFixture()

    const uncapped = await runCompute()
    const fractional = await runCompute({
      ...TsDe01.defaultConfig,
      top_n_diagnostics: 1.8,
    })
    const negative = await runCompute({
      ...TsDe01.defaultConfig,
      top_n_diagnostics: -1,
    })
    const nanLimit = await runCompute({
      ...TsDe01.defaultConfig,
      top_n_diagnostics: Number.NaN,
    })
    const infiniteLimit = await runCompute({
      ...TsDe01.defaultConfig,
      top_n_diagnostics: Infinity,
    })

    expect(TsDe01.diagnose(uncapped).map((diagnostic) => diagnostic.location?.file)).toEqual([
      expect.stringContaining("src/hub-a.ts"),
      expect.stringContaining("src/hub-b.ts"),
      expect.stringContaining("src/hub-c.ts"),
    ])
    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsDe01.diagnose(fractional)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsDe01.diagnose(negative)).toEqual([])
    expect(nanLimit.diagnosticLimit).toBe(0)
    expect(TsDe01.diagnose(nanLimit)).toEqual([])
    expect(infiniteLimit.diagnosticLimit).toBe(0)
    expect(TsDe01.diagnose(infiniteLimit)).toEqual([])
  })

  test("does not diagnose ordinary coupling when the score remains perfect", async () => {
    await writeTs("src/a.ts", "export interface A { value: string }\n")
    await writeTs(
      "src/b.ts",
      [
        "import type { A } from './a'",
        "export type B = A",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(TsDe01.score(out)).toBe(1)
    expect(TsDe01.diagnose(out)).toEqual([])
  })

  test("exclude_globs remove configured files from the analyzed module set", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const ignored = await writeTs(
      "src/ignored.ts",
      [
        "import type { A } from './a'",
        "export type Ignored = A",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsDe01.defaultConfig,
      exclude_globs: [...TsDe01.defaultConfig.exclude_globs, "**/ignored.ts"],
    })

    expect(out.totalModules).toBe(1)
    expect(out.modules.map((module) => module.file)).toEqual([a])
    expect(out.modules.some((module) => module.file === ignored)).toBe(false)
    expect(TsDe01.score(out)).toBe(1)
  })

  test("project modules can tune a specific module coupling finding with factor provenance", async () => {
    for (const file of ["a", "b", "c", "d", "e"]) {
      await writeTs(`src/${file}.ts`, `export interface ${file.toUpperCase()} {}\n`)
    }
    const hub = await writeTs(
      "src/hub.ts",
      [
        "import type { A } from './a'",
        "import type { B } from './b'",
        "import type { C } from './c'",
        "import type { D } from './d'",
        "import type { E } from './e'",
        "export type Hub = A & B & C & D & E",
        "",
      ].join("\n"),
    )

    const calibration = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      processors: [
        defineCalibrationProcessor({
          id: "contract-type-coupling",
          moduleId: "acme.project",
          moduleVersion: "1.0.0",
          slot: "typescript.type-coupling-policy",
          role: "factor-policy",
          priority: 10,
          fingerprint: "contract-type-coupling-v1",
          process: (current) =>
            Effect.succeed(
              current.value.file === hub
                ? appendCalibrationDecision(
                    current,
                    {
                      moduleId: "acme.project",
                      processorId: "contract-type-coupling",
                      slot: "typescript.type-coupling-policy",
                      action: "tune-type-coupling",
                      confidence: "high",
                      reason: "Fixture treats this hub as an intentional contract surface",
                      ruleId: "acme.contract-type-coupling",
                      factorPaths: [
                        `${current.value.factorPathPrefix}.visible`,
                        `${current.value.factorPathPrefix}.severity`,
                        `${current.value.factorPathPrefix}.penalty_weight`,
                      ],
                      before: current.value,
                      after: { ...current.value, penaltyWeight: 0, severity: "info" as const },
                      evidence: [{ kind: "path", value: current.value.file }],
                    },
                    { ...current.value, penaltyWeight: 0, severity: "info" },
                  )
                : current,
            ),
        }),
      ],
    })

    const out = await runCompute(TsDe01.defaultConfig, calibration)
    const hubEntry = out.modules.find((module) => module.file === hub)

    expect(hubEntry?.penaltyWeight).toBe(0)
    expect(hubEntry?.severity).toBe("info")
    expect(hubEntry?.visible).toBe(true)
    expect(hubEntry?.policyDecisions?.[0]?.ruleId).toBe("acme.contract-type-coupling")
    expect(TsDe01.score(out)).toBe(1)
    expect(TsDe01.diagnose(out)).toEqual([])
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: `${hubEntry?.factorPathPrefix}.visible`,
        value: true,
        source: "module",
      }),
    )
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: `${hubEntry?.factorPathPrefix}.severity`,
        value: "info",
        source: "module",
      }),
    )
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: `${hubEntry?.factorPathPrefix}.penalty_weight`,
        value: 0,
        source: "module",
      }),
    )
  })

  test("calibrated diagnostics include policy decision payloads and ledger attribution", async () => {
    for (const file of ["a", "b", "c", "d", "e"]) {
      await writeTs(`src/${file}.ts`, `export interface ${file.toUpperCase()} {}\n`)
    }
    const hub = await writeTs(
      "src/hub.ts",
      [
        "import type { A } from './a'",
        "import type { B } from './b'",
        "import type { C } from './c'",
        "import type { D } from './d'",
        "import type { E } from './e'",
        "export type Hub = A & B & C & D & E",
        "",
      ].join("\n"),
    )

    const calibration = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      processors: [
        defineCalibrationProcessor({
          id: "escalate-type-coupling",
          moduleId: "acme.project",
          moduleVersion: "1.0.0",
          slot: "typescript.type-coupling-policy",
          role: "factor-policy",
          priority: 10,
          fingerprint: "escalate-type-coupling-v1",
          process: (current) =>
            Effect.succeed(
              current.value.file === hub
                ? appendCalibrationDecision(
                    current,
                    {
                      moduleId: "acme.project",
                      processorId: "escalate-type-coupling",
                      slot: "typescript.type-coupling-policy",
                      action: "tune-type-coupling",
                      confidence: "high",
                      reason: "Fixture escalates this hub to prove diagnostic policy attribution",
                      ruleId: "acme.escalate-type-coupling",
                      factorPaths: [
                        `${current.value.factorPathPrefix}.visible`,
                        `${current.value.factorPathPrefix}.severity`,
                        `${current.value.factorPathPrefix}.penalty_weight`,
                      ],
                      before: current.value,
                      after: { ...current.value, severity: "block" as const, penaltyWeight: 2 },
                      evidence: [{ kind: "path", value: current.value.file }],
                    },
                    { ...current.value, severity: "block", penaltyWeight: 2 },
                  )
                : current,
            ),
        }),
      ],
    })

    const out = await runCompute(TsDe01.defaultConfig, calibration)
    const hubEntry = out.modules.find((module) => module.file === hub)
    const diagnostic = TsDe01.diagnose(out)[0]

    expect(hubEntry?.severity).toBe("block")
    expect(hubEntry?.penaltyWeight).toBe(2)
    expect(diagnostic).toMatchObject({
      severity: "block",
      data: {
        policyDecisions: [
          expect.objectContaining({
            moduleId: "acme.project",
            processorId: "escalate-type-coupling",
            ruleId: "acme.escalate-type-coupling",
          }),
        ],
      },
    })
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: `${hubEntry?.factorPathPrefix}.visible`,
        value: true,
        source: "module",
      }),
    )
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: `${hubEntry?.factorPathPrefix}.severity`,
        value: "block",
        source: "module",
      }),
    )
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: `${hubEntry?.factorPathPrefix}.penalty_weight`,
        value: 2,
        source: "module",
      }),
    )
  })

  test("pulsar-self role classifier drives integration type-coupling policy", async () => {
    for (const file of ["a", "b", "c", "d", "e"]) {
      await writeTs(`packages/ts-pack/src/signals/${file}.ts`, `export interface ${file.toUpperCase()} {}\n`)
    }
    const integrationHub = await writeTs(
      "packages/ts-pack/src/signals/ts-ld-02-orchestration.ts",
      [
        "import type { A } from './a'",
        "import type { B } from './b'",
        "import type { C } from './c'",
        "import type { D } from './d'",
        "import type { E } from './e'",
        "export type IntegrationHub = A & B & C & D & E",
        "",
      ].join("\n"),
    )
    const calibration = await makePulsarSelfCalibrationContext(repo)
    const classification = await Effect.runPromise(
      calibration.runSlot("taxonomy.file-classifier", {
        path: integrationHub,
        categories: [],
      }),
    )

    const out = await runCompute(TsDe01.defaultConfig, calibration)
    const hubEntry = out.modules.find((module) => module.file === integrationHub)

    expect(classification.value.metadata?.architecture_role).toBe("integration")
    expect(classification.value.metadata).toEqual(
      expect.objectContaining({
        repository: "pulsar",
        calibrationScope: "repo-local-self-calibration",
        productDefault: false,
      }),
    )
    expect(hubEntry?.penaltyWeight).toBe(0)
    expect(hubEntry?.policyDecisions).toContainEqual(
      expect.objectContaining({
        moduleId: "pulsar-self",
        processorId: "pulsar-repository-integration-type-coupling-policy",
        ruleId: "pulsar.repository.integration-type-coupling-policy.v1",
        after: expect.objectContaining({
          metadata: expect.objectContaining({
            calibrationScope: "repo-local-self-calibration",
            productDefault: false,
          }),
        }),
      }),
    )
    expect(hubEntry?.policyDecisions?.[0]?.factorPaths?.some((path) =>
      path.endsWith(".penalty_weight"),
    )).toBe(true)
  })

  test("scores outgoing dependencies rather than incoming model fan-in", async () => {
    await writeTs("src/model.ts", "export interface SharedModel { value: string }\n")
    for (const index of [1, 2, 3, 4, 5]) {
      await writeTs(
        `src/consumer-${index}.ts`,
        [
          "import type { SharedModel } from './model'",
          `export type Consumer${index} = SharedModel`,
          "",
        ].join("\n"),
      )
    }

    const out = await runCompute()
    const model = out.modules.find((module) => module.file.endsWith("model.ts"))

    expect(model?.externalTypesReferenced).toBe(0)
    expect(model?.typesReferencedExternally).toBe(1)
    expect(TsDe01.score(out)).toBe(1)
    expect(TsDe01.diagnose(out)).toEqual([])
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsDe01.configSchema)(TsDe01.defaultConfig)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.precise_module_limit).toBe(1_000)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
  })
})

const writeDiagnosticFixture = async (): Promise<void> => {
  for (const index of Array.from({ length: 40 }, (_, item) => item + 1)) {
    await writeTs(`src/filler-${index}.ts`, `export const filler${index} = ${index}\n`)
  }
  for (const file of ["a", "b", "c", "d", "e"]) {
    await writeTs(`src/${file}.ts`, `export interface ${file.toUpperCase()} {}\n`)
  }
  for (const hub of ["hub-a", "hub-b", "hub-c"]) {
    await writeTs(
      `src/${hub}.ts`,
      [
        "import type { A } from './a'",
        "import type { B } from './b'",
        "import type { C } from './c'",
        "import type { D } from './d'",
        "import type { E } from './e'",
        `export type ${hub.replaceAll("-", "_")} = A & B & C & D & E`,
        "",
      ].join("\n"),
    )
  }
}
