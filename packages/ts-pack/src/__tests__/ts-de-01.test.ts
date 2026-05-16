import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  appendCalibrationDecision,
  CalibrationContextTag,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
  type ResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
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
      },
      include: ["**/*.ts"],
    }),
  )
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe("TS-DE-01 (type-level coupling)", () => {
  test("empty project: neutral score 1", async () => {
    const out = await runCompute()
    expect(out.totalModules).toBe(0)
    expect(out.modules).toEqual([])
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
    expect(diagnostics[0]?.data).toMatchObject({
      externalTypesReferenced: 5,
    })
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
                      factorPaths: [`${current.value.factorPathPrefix}.penalty_weight`],
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
    expect(hubEntry?.policyDecisions?.[0]?.ruleId).toBe("acme.contract-type-coupling")
    expect(TsDe01.score(out)).toBe(1)
    expect(TsDe01.diagnose(out)).toEqual([])
    expect(out.factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: `${hubEntry?.factorPathPrefix}.penalty_weight`,
        value: 0,
        source: "module",
      }),
    )
  })

  test("pulsar-self tier classifier drives integration type-coupling policy", async () => {
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

    expect(classification.value.metadata?.architectural_tier).toBe("integration")
    expect(hubEntry?.penaltyWeight).toBe(0)
    expect(hubEntry?.policyDecisions).toContainEqual(
      expect.objectContaining({
        moduleId: "pulsar-self",
        processorId: "integration-type-coupling-policy",
        ruleId: "pulsar.integration-type-coupling-policy.v1",
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
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
  })
})
