import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { CalibrationContextTag, appendCalibrationDecision, defineCalibrationProcessor, makeResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import { Effect, Layer } from "effect"
import { TsLd03 } from "../signals/ts-ld-03-nesting-depth.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"
import { TsProjectLayer } from "../ts-project.js"
import { makePulsarSelfCalibrationContext } from "./pulsar-self-calibration.js"

let repo: TempRepo

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ld-03-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-LD-03 (nesting depth)", () => {
  test("top-level branch counts as depth 1", async () => {
    await repo.write(
      "src/flat.ts",
      [
        "export function flat(flag: boolean) {",
        "  if (flag) {",
        "    return 1",
        "  }",
        "  return 0",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    expect(out.byFunction[0]?.maxNesting).toBe(1)
    expect([...out.byFile.values()][0]?.max).toBe(1)
  })

  test("deeply nested control flow reaches depth 5", async () => {
    await repo.write(
      "src/deep.ts",
      [
        "export function process(items: Array<{ status: string; type: string; children: string[] }>) {",
        "  for (const item of items) {",
        "    if (item.status === 'x') {",
        "      try {",
        "        if (item.type === 'a') {",
        "          for (const child of item.children) {",
        "            console.log(child)",
        "          }",
        "        }",
        "      } catch {",
        "        return 0",
        "      }",
        "    }",
        "  }",
        "  return 1",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    expect(out.byFunction[0]?.maxNesting).toBe(5)
    expect(out.overThreshold).toHaveLength(1)
  })

  test("nested callbacks reset depth at function boundaries", async () => {
    await repo.write(
      "src/callback.ts",
      [
        "export function outer(items: number[]) {",
        "  if (items.length > 0) {",
        "    return items.map((item) => {",
        "      if (item > 0) {",
        "        return item + 1",
        "      }",
        "      return item",
        "    })",
        "  }",
        "  return []",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    const outer = out.byFunction.find((entry) => entry.name === "outer")
    const callback = out.byFunction.find((entry) => entry.name === "<anonymous>")
    expect(outer?.maxNesting).toBe(1)
    expect(callback?.maxNesting).toBe(1)
  })

  test("switch statements count as control-flow depth", async () => {
    await repo.write(
      "src/switch.ts",
      [
        "export function chooser(value: string) {",
        "  switch (value) {",
        "    case 'a':",
        "      return 1",
        "    default:",
        "      return 0",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    expect(out.byFunction[0]?.maxNesting).toBe(1)
  })

  test("threshold is configurable", async () => {
    await repo.write(
      "src/threshold.ts",
      [
        "export function nested(flag: boolean) {",
        "  if (flag) {",
        "    while (flag) {",
        "      return 1",
        "    }",
        "  }",
        "  return 0",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, {
      ...TsLd03.defaultConfig,
      max_nesting: 1,
    })
    expect(out.overThreshold).toHaveLength(1)
  })

  test("nesting policy calibration can relax integration control flow", async () => {
    await repo.write(
      "src/orchestrate.ts",
      [
        "export function orchestrate(items: string[]) {",
        "  for (const item of items) {",
        "    if (item.length > 0) {",
        "      try {",
        "        if (item.startsWith('a')) {",
        "          return item",
        "        }",
        "      } catch {",
        "        return ''",
        "      }",
        "    }",
        "  }",
        "  return ''",
        "}",
      ].join("\n"),
    )
    const processor = defineCalibrationProcessor({
      id: "integration-nesting",
      moduleId: "acme.project",
      moduleVersion: "1.0.0",
      slot: "typescript.nesting-policy",
      role: "factor-policy",
      priority: 10,
      fingerprint: "integration-nesting-v1",
      process: (current) =>
        Effect.sync(() => {
          if (!current.value.file.endsWith("orchestrate.ts")) return current
          return appendCalibrationDecision(
            current,
            {
              moduleId: "acme.project",
              processorId: "integration-nesting",
              slot: "typescript.nesting-policy",
              action: "tune-nesting-policy",
              confidence: "high",
              reason: "Integration orchestration keeps protocol branches local",
              ruleId: "acme.integration-nesting.v1",
              factorPaths: [
                `${current.value.factorPathPrefix}.threshold`,
                `${current.value.factorPathPrefix}.penalty_weight`,
              ],
              before: current.value,
              after: {
                ...current.value,
                threshold: 8,
                penaltyWeight: 0,
                severity: "info",
              },
              evidence: [{ kind: "path", value: current.value.file }],
            },
            {
              ...current.value,
              threshold: 8,
              penaltyWeight: 0,
              severity: "info",
            },
          )
        }),
    })
    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo.root,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      processors: [processor],
    })

    const out = await Effect.runPromise(
      TsLd03.compute({
        ...TsLd03.defaultConfig,
        max_nesting: 2,
      }, new Map()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibrationContext),
          ),
        ),
      ) as Effect.Effect<any, unknown, never>,
    )

    expect(out.overThreshold).toEqual([])
    expect(out.calibrationDecisions[0]).toMatchObject({
      moduleId: "acme.project",
      processorId: "integration-nesting",
      ruleId: "acme.integration-nesting.v1",
    })
  })

  test("nesting policy penalty weight partially deweights score pressure", async () => {
    await repo.write(
      "src/weighted.ts",
      [
        "export function weighted(items: string[]) {",
        "  for (const item of items) {",
        "    if (item.length > 0) {",
        "      try {",
        "        if (item.startsWith('a')) {",
        "          return item",
        "        }",
        "      } catch {",
        "        return ''",
        "      }",
        "    }",
        "  }",
        "  return ''",
        "}",
      ].join("\n"),
    )
    const processor = defineCalibrationProcessor({
      id: "weighted-nesting",
      moduleId: "acme.project",
      moduleVersion: "1.0.0",
      slot: "typescript.nesting-policy",
      role: "factor-policy",
      priority: 10,
      fingerprint: "weighted-nesting-v1",
      process: (current) =>
        Effect.sync(() =>
          appendCalibrationDecision(
            current,
            {
              moduleId: "acme.project",
              processorId: "weighted-nesting",
              slot: "typescript.nesting-policy",
              action: "tune-nesting-policy",
              confidence: "high",
              reason: "This remains visible but contributes reduced pressure",
              ruleId: "acme.weighted-nesting.v1",
              factorPaths: [`${current.value.factorPathPrefix}.penalty_weight`],
              before: current.value,
              after: {
                ...current.value,
                penaltyWeight: 0.25,
              },
              evidence: [{ kind: "path", value: current.value.file }],
            },
            {
              ...current.value,
              penaltyWeight: 0.25,
            },
          ),
        ),
    })
    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts: {
        repoRoot: repo.root,
        fingerprint: "repo-facts-v1",
        detectedTechnologies: ["typescript"],
        sourceExtensions: [".ts"],
      },
      processors: [processor],
    })

    const out = await Effect.runPromise(
      TsLd03.compute({
        ...TsLd03.defaultConfig,
        max_nesting: 2,
      }, new Map()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibrationContext),
          ),
        ),
      ) as Effect.Effect<any, unknown, never>,
    )

    expect(out.overThreshold).toHaveLength(1)
    expect(out.overThreshold[0]?.policy?.penaltyWeight).toBe(0.25)
    expect(TsLd03.score(out)).toBe(0.75)
  })

  test("pulsar-self tier classifier drives integration nesting policy", async () => {
    const file = await repo.write(
      "packages/ts-pack/src/signals/ts-ld-02-orchestration.ts",
      [
        "export function orchestrate(items: string[]) {",
        "  for (const item of items) {",
        "    if (item.length > 0) {",
        "      try {",
        "        if (item.startsWith('a')) {",
        "          return item",
        "        }",
        "      } catch {",
        "        return ''",
        "      }",
        "    }",
        "  }",
        "  return ''",
        "}",
      ].join("\n"),
    )
    const calibrationContext = await makePulsarSelfCalibrationContext(repo.root)

    const classification = await Effect.runPromise(
      calibrationContext.runSlot("taxonomy.file-classifier", {
        path: file,
        categories: [],
      }),
    )
    const out = await Effect.runPromise(
      TsLd03.compute({
        ...TsLd03.defaultConfig,
        max_nesting: 2,
      }, new Map()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibrationContext),
          ),
        ),
      ) as Effect.Effect<any, unknown, never>,
    )

    expect(classification.value.metadata?.architectural_tier).toBe("integration")
    expect(out.overThreshold).toEqual([])
    expect(out.calibrationDecisions).toContainEqual(
      expect.objectContaining({
        moduleId: "pulsar-self",
        processorId: "integration-nesting-policy",
        ruleId: "pulsar.integration-nesting-policy.v1",
      }),
    )
  })

  test("generated, vendored, and test helper files are excluded by default", async () => {
    await repo.write("src/index.ts", "export function real() { return 1 }\n")
    await repo.write(
      "src/generated.generated.ts",
      [
        "export function generated(flag: boolean) {",
        "  if (flag) {",
        "    while (flag) {",
        "      return 1",
        "    }",
        "  }",
        "  return 0",
        "}",
      ].join("\n"),
    )
    await repo.write(
      "src/monitor.test-helpers.ts",
      [
        "export function helper(flag: boolean) {",
        "  if (flag) {",
        "    return 1",
        "  }",
        "  return 0",
        "}",
      ].join("\n"),
    )
    await repo.write(
      "vendor/copied.ts",
      [
        "export function vendored(flag: boolean) {",
        "  if (flag) {",
        "    return 1",
        "  }",
        "  return 0",
        "}",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd03, TsLd03.defaultConfig)
    expect(out.byFunction.map((entry) => entry.name)).toEqual(["real"])
  })
})
