import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Layer, Schema } from "effect"
import { CalibrationContextTag, appendCalibrationDecision, defineCalibrationProcessor, makeResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import type { RepoFacts } from "@skastr0/pulsar-core/calibration"
import { TsLd02 } from "../signals/ts-ld-02-size-distribution.js"
import {
  type TsLd02Output,
} from "../signals/ts-ld-02-model.js"
import { TsProjectLayer } from "../ts-project.js"
import { makePulsarSelfCalibrationContext } from "./pulsar-self-calibration.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsLd02.defaultConfig): Promise<TsLd02Output> => {
  const program = TsLd02.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsLd02Output, unknown, never>)
}

const runComputeWithCalibration = async (
  calibration: ReturnType<typeof makeResolvedCalibrationContext>,
  config = TsLd02.defaultConfig,
): Promise<TsLd02Output> => {
  const program = TsLd02.compute(config, new Map()).pipe(
    Effect.provide(
      Layer.mergeAll(
        TsProjectLayer(repo),
        Layer.succeed(CalibrationContextTag, calibration),
      ),
    ),
  )
  return Effect.runPromise(program as Effect.Effect<TsLd02Output, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-ld-02-"))
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

describe("TS-LD-02 (function / file size distribution)", () => {
  test("empty repo: score 1, empty summaries", async () => {
    const out = await runCompute()
    expect(out.totalFiles).toBe(0)
    expect(out.totalFunctions).toBe(0)
    expect(TsLd02.score(out)).toBe(1)
    expect(TsLd02.outputMetadata?.(out)?.applicability).toBe("not_applicable")
  })

  test("small functions and files: score stays 1", async () => {
    await writeTs(
      "a.ts",
      [
        "export function tiny() {",
        "  return 1",
        "}",
        "export function also() {",
        "  return 2",
        "}",
        "",
      ].join("\n"),
    )
    const out = await runCompute()
    expect(out.totalFunctions).toBeGreaterThanOrEqual(2)
    expect(out.outlierFunctionCount).toBe(0)
    expect(out.outlierFileCount).toBe(0)
    expect(TsLd02.score(out)).toBe(1)
  })

  test("true function outliers must clear p95 + threshold", async () => {
    const tinyFns = Array.from(
      { length: 20 },
      (_, i) => `export function tiny${i}() { return ${i} }`,
    )
    const bigBody = Array.from({ length: 6 }, (_, i) => `  const x${i} = ${i}`)
    await writeTs(
      "big.ts",
      [
        ...tinyFns,
        "export function big() {",
        ...bigBody,
        "  return 0",
        "}",
        "",
      ].join("\n"),
    )
    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 2,
      max_file_loc: 2,
    })
    expect(out.functionSizes.p95).toBe(1)
    expect(out.functionOutlierCutoff).toBe(3)
    expect(out.outlierFunctionCount).toBe(1)
    expect(out.outlierFunctions[0]?.name).toBe("big")
    expect(out.outlierFunctions[0]?.loc).toBeGreaterThan(out.functionOutlierCutoff)
    expect(TsLd02.score(out)).toBeLessThan(1)
  })

  test("single extreme file or function creates local max pressure", async () => {
    for (let i = 0; i < 80; i += 1) {
      await writeTs(`small-${i}.ts`, `export function small${i}() { return ${i} }\n`)
    }
    await writeTs(
      "huge.ts",
      [
        "export function huge() {",
        ...Array.from({ length: 40 }, (_, index) => `  const value${index} = ${index}`),
        "  return 1",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 10,
      max_file_loc: 12,
    })

    expect(out.outlierFunctionCount + out.outlierFileCount).toBeGreaterThan(0)
    expect(out.maxFunctionPressure).toBeGreaterThan(out.ratioPressure)
    expect(out.maxFilePressure).toBeGreaterThan(out.ratioPressure)
    expect(TsLd02.score(out)).toBeLessThan(0.4)
  })

  test("size policy calibration can relax integration-size pressure with provenance", async () => {
    for (let i = 0; i < 20; i += 1) {
      await writeTs(`small-${i}.ts`, `export function small${i}() { return ${i} }\n`)
    }
    await writeTs(
      "integration.ts",
      [
        "export function orchestrate() {",
        ...Array.from({ length: 40 }, (_, index) => `  const value${index} = ${index}`),
        "  return 1",
        "}",
        "",
      ].join("\n"),
    )

    const processor = defineCalibrationProcessor({
      id: "integration-size",
      moduleId: "acme.project",
      moduleVersion: "1.0.0",
      slot: "typescript.size-policy",
      role: "factor-policy",
      priority: 10,
      fingerprint: "integration-size-v1",
      process: (current) =>
        Effect.sync(() => {
          if (!current.value.file.endsWith("integration.ts")) return current
          return appendCalibrationDecision(
            current,
            {
              moduleId: "acme.project",
              processorId: "integration-size",
              slot: "typescript.size-policy",
              action: "tune-size-policy",
              confidence: "high",
              reason: "Integration file keeps orchestration local",
              ruleId: "acme.integration-size.v1",
              factorPaths: [
                `${current.value.factorPathPrefix}.penalty_weight`,
                `${current.value.factorPathPrefix}.max_loc`,
              ],
              before: current.value,
              after: {
                ...current.value,
                penaltyWeight: 0,
                maxLoc: 1_000,
                severity: "info",
              },
              evidence: [{ kind: "path", value: current.value.file }],
            },
            {
              ...current.value,
              penaltyWeight: 0,
              maxLoc: 1_000,
              severity: "info",
            },
          )
        }),
    })
    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      processors: [processor],
    })

    const baseline = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 10,
      max_file_loc: 12,
    })
    const calibrated = await runComputeWithCalibration(calibrationContext, {
      ...TsLd02.defaultConfig,
      max_function_loc: 10,
      max_file_loc: 12,
    })

    expect(TsLd02.score(baseline)).toBeLessThan(1)
    expect(TsLd02.score(calibrated)).toBe(1)
    expect(calibrated.calibrationDecisions[0]).toMatchObject({
      moduleId: "acme.project",
      processorId: "integration-size",
      ruleId: "acme.integration-size.v1",
    })
    expect(calibrated.calibrationDecisions[0]?.factorPaths?.some((path) =>
      path.includes(".penalty_weight"),
    )).toBe(true)
  })

  test("pulsar-self role classifier drives integration size policy", async () => {
    for (let i = 0; i < 20; i += 1) {
      await writeTs(`small-${i}.ts`, `export function small${i}() { return ${i} }\n`)
    }
    const integrationFile = await writeTs(
      "packages/ts-pack/src/signals/ts-ld-02-integration-story.ts",
      [
        "export function orchestrateSizeStory() {",
        ...Array.from({ length: 40 }, (_, index) => `  const value${index} = ${index}`),
        "  return 1",
        "}",
        "",
      ].join("\n"),
    )
    const calibrationContext = await makePulsarSelfCalibrationContext(repo)

    const classification = await Effect.runPromise(
      calibrationContext.runSlot("taxonomy.file-classifier", {
        path: integrationFile,
        categories: [],
      }),
    )
    const baseline = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 10,
      max_file_loc: 12,
    })
    const calibrated = await runComputeWithCalibration(calibrationContext, {
      ...TsLd02.defaultConfig,
      max_function_loc: 10,
      max_file_loc: 12,
    })

    expect(classification.value.metadata?.architecture_role).toBe("integration")
    expect(TsLd02.score(baseline)).toBeLessThan(1)
    expect(TsLd02.score(calibrated)).toBe(1)
    expect(calibrated.calibrationDecisions).toContainEqual(
      expect.objectContaining({
        moduleId: "pulsar-self",
        processorId: "integration-size-policy",
        ruleId: "pulsar.integration-size-policy.v1",
      }),
    )
  })

  test("functions above the raw threshold but below p95 + threshold are not outliers", async () => {
    const tinyFns = Array.from(
      { length: 20 },
      (_, i) => `export function tiny${i}() { return ${i} }`,
    )
    await writeTs(
      "almost-big.ts",
      [
        ...tinyFns,
        "export function almostBig() {",
        "  return 1",
        "}",
        "",
      ].join("\n"),
    )
    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 2,
    })
    expect(out.functionSizes.p95).toBe(1)
    expect(out.functionOutlierCutoff).toBe(3)
    expect(out.outlierFunctionCount).toBe(0)
    expect(out.outlierFunctions).toEqual([])
  })

  test("parent function LOC excludes nested function bodies", async () => {
    const tinyFns = Array.from(
      { length: 20 },
      (_, i) => `export function tiny${i}() { return ${i} }`,
    )
    const nestedBody = Array.from({ length: 8 }, (_, i) => `    const x${i} = ${i}`)
    await writeTs(
      "nested.ts",
      [
        ...tinyFns,
        "export function outer() {",
        "  const inner = () => {",
        ...nestedBody,
        "    return 0",
        "  }",
        "  return inner()",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 4,
      max_file_loc: 100,
    })

    expect(out.outlierFunctions.some((fn) => fn.name === "outer")).toBe(false)
    expect(out.outlierFunctions.some((fn) => fn.name === "inner")).toBe(true)
  })

  test("files above the raw threshold but below p95 + threshold are not outliers", async () => {
    for (let i = 0; i < 20; i += 1) {
      await writeTs(`small-${i}.ts`, `export const v${i} = ${i}\n`)
    }
    await writeTs(
      "almost-big-file.ts",
      ["export const a = 1", "export const b = 2", "export const c = 3", ""].join(
        "\n",
      ),
    )
    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_file_loc: 2,
    })
    expect(out.fileSizes.p95).toBe(1)
    expect(out.fileOutlierCutoff).toBe(3)
    expect(out.outlierFileCount).toBe(0)
    expect(out.outlierFiles).toEqual([])
  })

  test("absolute file threshold pressure is diagnostic even without p95 outliers", async () => {
    await writeTs(
      "large-but-common.ts",
      [
        "export const a = 1",
        "export const b = 2",
        "export const c = 3",
        "export const d = 4",
        "export const e = 5",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_file_loc: 3,
    })
    const diagnostics = TsLd02.diagnose(out)

    expect(out.outlierFileCount).toBe(0)
    expect(out.oversizedFileCount).toBe(1)
    expect(TsLd02.score(out)).toBeLessThan(1)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("File exceeds max_file_loc")
    expect(diagnostics[0]?.data).toMatchObject({
      kind: "file-threshold",
      threshold: 3,
    })
  })

  test("comments and blanks are excluded from LOC count", async () => {
    const text = [
      "// comment one",
      "// comment two",
      "",
      "export function small() {",
      "  // inner comment",
      "",
      "  return 42",
      "}",
      "",
    ].join("\n")
    await writeTs("x.ts", text)
    const out = await runCompute()
    // The file has one real line outside the function declaration plus
    // a few inside the body; certainly fewer than raw line count (9).
    expect(out.fileSizes.max).toBeLessThan(9)
    expect(out.totalFunctions).toBe(1)
    // Function body only has one real line (`return 42`) plus braces.
    expect(out.functionSizes.max).toBeLessThanOrEqual(3)
  })

  test("generated, vendored, and test helper files are excluded by default", async () => {
    await writeTs("src/index.ts", "export function real() { return 1 }\n")
    await writeTs(
      "src/schema.generated.ts",
      [
        "export function generated(value) {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )
    await writeTs(
      "vendor/copied.ts",
      [
        "export function vendored(value) {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )
    await writeTs(
      "src/monitor.test-helpers.ts",
      [
        "export function helper(value) {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.totalFiles).toBe(1)
    expect(out.totalFunctions).toBe(1)
  })

  test("distribution summaries are populated", async () => {
    await writeTs("a.ts", "export const a = 1\nexport const a2 = 2\n")
    await writeTs(
      "b.ts",
      [
        "export function b() {",
        "  const x = 1",
        "  return x",
        "}",
        "",
      ].join("\n"),
    )
    const out = await runCompute()
    expect(out.fileSizes.count).toBe(2)
    expect(out.functionSizes.count).toBeGreaterThanOrEqual(1)
    expect(out.fileSizes.max).toBeGreaterThanOrEqual(out.fileSizes.avg)
  })

  test("deterministic: same project, same score", async () => {
    await writeTs(
      "a.ts",
      "export function a() { return 1 }\nexport function b() { return 2 }\n",
    )
    const o1 = await runCompute()
    const o2 = await runCompute()
    expect(TsLd02.score(o1)).toBe(TsLd02.score(o2))
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsLd02.configSchema)(TsLd02.defaultConfig)
    expect(decoded.max_function_loc).toBe(50)
    expect(decoded.max_file_loc).toBe(300)
  })

  test("diagnose emits warnings for true outliers", async () => {
    for (let i = 0; i < 20; i += 1) {
      await writeTs(`tiny-${i}.ts`, `export function tiny${i}() { return ${i} }\n`)
    }
    const bigBody = Array.from({ length: 6 }, (_, i) => `  const x${i} = ${i}`)
    await writeTs(
      "big.ts",
      [
        "export function big() {",
        ...bigBody,
        "  return 0",
        "}",
        "",
      ].join("\n"),
    )
    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 2,
      max_file_loc: 2,
    })
    const diags = TsLd02.diagnose(out)
    expect(diags.length).toBeGreaterThan(0)
    expect(diags.some((d) => d.message.includes("Function outlier"))).toBe(true)
    expect(diags.some((d) => d.message.includes("File outlier"))).toBe(true)
    expect(diags.every((d) => !d.message.includes("Large "))).toBe(true)
  })

  test("large callbacks are named from their owning declaration and callee", async () => {
    const body = Array.from({ length: 8 }, (_, index) => `    const value${index} = ${index}`)
    await writeTs(
      "service.ts",
      [
        "declare const Layer: { effect: (...args: unknown[]) => unknown }",
        "declare const Effect: { gen: (...args: unknown[]) => unknown }",
        "declare const Service: unique symbol",
        ...Array.from({ length: 20 }, (_, index) => `export function tiny${index}() { return ${index} }`),
        "export const SessionRegistryLive = Layer.effect(",
        "  Service,",
        "  Effect.gen(function* () {",
        ...body,
        "    return { ok: true }",
        "  }),",
        ")",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsLd02.defaultConfig,
      max_function_loc: 2,
      max_file_loc: 100,
    })

    expect(out.outlierFunctions[0]?.name).toBe("SessionRegistryLive/Effect.gen")
    expect(TsLd02.diagnose(out)[0]?.message).toContain("SessionRegistryLive/Effect.gen")
  })

  test("calibrates outlier callback names with attribution", async () => {
    const body = Array.from({ length: 8 }, (_, index) => `  const value${index} = ${index}`)
    await writeTs(
      "service.ts",
      [
        "declare const Effect: { fn: (label: string) => (body: unknown) => unknown }",
        ...Array.from({ length: 20 }, (_, index) => `export function tiny${index}() { return ${index} }`),
        "export const create = Effect.fn(\"Session.create\")(function* (_input: unknown) {",
        ...body,
        "  return yield* run()",
        "})",
        "",
      ].join("\n"),
    )

    const processor = defineCalibrationProcessor({
      id: "effect-callback-names",
      moduleId: "acme.effect",
      moduleVersion: "1.0.0",
      slot: "typescript.callback-context-namer",
      role: "enricher",
      priority: 10,
      fingerprint: "effect-callback-names-v1",
      process: (current) =>
        Effect.sync(() => {
          const label = current.value.metadata?.effectFnLabel
          if (label !== "Session.create") return current
          return appendCalibrationDecision(
            current,
            {
              moduleId: "acme.effect",
              processorId: "effect-callback-names",
              slot: "typescript.callback-context-namer",
              action: "name-callback-context",
              confidence: "high",
              reason: "Effect.fn label provides the callback's operation name",
              ruleId: "effect.callback-context-name.v1",
              evidence: [{ kind: "symbol", value: label }],
            },
            {
              ...current.value,
              resolvedName: label,
            },
          )
        }),
    })
    const repoFacts: RepoFacts = {
      repoRoot: repo,
      fingerprint: "repo-facts-v1",
      detectedTechnologies: ["effect", "typescript"],
      sourceExtensions: [".ts"],
    }
    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts,
      processors: [processor],
    })

    const out = await Effect.runPromise(
      TsLd02.compute({
        ...TsLd02.defaultConfig,
        max_function_loc: 2,
        max_file_loc: 100,
      }, new Map()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo),
            Layer.succeed(CalibrationContextTag, calibrationContext),
          ),
        ),
      ) as Effect.Effect<TsLd02Output, unknown, never>,
    )

    expect(out.outlierFunctions[0]?.name).toBe("Session.create")
    expect(out.calibrationDecisions[0]).toMatchObject({
      moduleId: "acme.effect",
      processorId: "effect-callback-names",
      ruleId: "effect.callback-context-name.v1",
    })
  })
})
