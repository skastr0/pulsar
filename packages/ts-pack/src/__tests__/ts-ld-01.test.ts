import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"
import { TsLd01 } from "../signals/ts-ld-01-complexity.js"
import { Effect, Layer, Schema } from "effect"
import { CalibrationContextTag, defineCalibrationProcessor, makeResolvedCalibrationContext, appendCalibrationDecision } from "@skastr0/pulsar-core/calibration"
import type { RepoFacts } from "@skastr0/pulsar-core/calibration"
import { TsProjectLayer } from "../ts-project.js"

describe("TS-LD-01 (cyclomatic complexity)", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("ts-ld-01-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("empty inspected source is not applicable evidence", async () => {
    await repo.write("src/index.ts", "export const ready = true\n")

    const out = await runSignal(repo.root, TsLd01, TsLd01.defaultConfig)

    expect(out.totalFunctions).toBe(0)
    expect(TsLd01.score(out)).toBe(1)
    expect(TsLd01.outputMetadata?.(out)?.applicability).toBe("not_applicable")
  })

  test("nested callbacks do not inflate outer function complexity", async () => {
    await repo.write(
      "src/index.ts",
      `
export function outer(items: Array<number>) {
  items.map((item) => {
    if (item > 0 && item < 10) {
      return item
    }
    return 0
  })
  return items.length
}
`,
    )

    const out = await runSignal(repo.root, TsLd01, TsLd01.defaultConfig)
    const outer = out.functions.find((fn) => fn.name === "outer")
    const callback = out.functions.find((fn) => fn.name === "outer/items.map")

    expect(outer?.complexity).toBe(1)
    expect(callback?.complexity).toBe(3)
  })

  test("calibrates callback context names with attribution", async () => {
    await repo.write(
      "src/index.ts",
      `
const Effect = {
  fn: (_label: string) => (body: unknown) => body,
}

export const create = Effect.fn("Session.create")(function* (_input: unknown) {
  if (ready() && enabled()) return yield* run()
  return yield* fallback()
})
`,
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
      repoRoot: repo.root,
      fingerprint: "repo-facts-v1",
      detectedTechnologies: ["effect", "typescript"],
      sourceExtensions: [".ts"],
    }
    const calibrationContext = makeResolvedCalibrationContext({
      repoFacts,
      processors: [processor],
    })

    const out = await Effect.runPromise(
      TsLd01.compute(TsLd01.defaultConfig, new Map()).pipe(
        Effect.provide(
          Layer.mergeAll(
            TsProjectLayer(repo.root),
            Layer.succeed(CalibrationContextTag, calibrationContext),
          ),
        ),
      ),
    )

    expect(out.functions.find((fn) => fn.name === "Session.create")?.complexity).toBe(3)
    expect(out.calibrationDecisions[0]).toMatchObject({
      moduleId: "acme.effect",
      processorId: "effect-callback-names",
      ruleId: "effect.callback-context-name.v1",
    })
  })

  test("names object-property callbacks with callsite context", async () => {
    await repo.write(
      "src/index.ts",
      `
const Effect = {
  tryPromise: (options: { try: () => unknown; catch: (error: unknown) => unknown }) => options,
}

export const result = Effect.tryPromise({
  try: () => {
    if (enabled() && ready()) {
      return run()
    }
    return fallback()
  },
  catch: (error) => error,
})
`,
    )

    const out = await runSignal(repo.root, TsLd01, TsLd01.defaultConfig)
    const callback = out.functions.find((fn) => fn.name === "result/Effect.tryPromise/try")

    expect(callback?.complexity).toBe(3)
    expect(out.functions.some((fn) => fn.name === "try")).toBe(false)
  })

  test("counts branches and boolean operators in one function", async () => {
    await repo.write(
      "src/index.ts",
      `
export function classify(a: boolean, b: boolean, c: boolean) {
  if (a && b) return "ab"
  if (c || b) return "cb"
  return "none"
}
`,
    )

    const out = await runSignal(repo.root, TsLd01, TsLd01.defaultConfig)
    const classify = out.functions.find((fn) => fn.name === "classify")

    expect(classify?.complexity).toBe(5)
  })

  test("single extreme function creates local max pressure", async () => {
    const branches = Array.from(
      { length: 12 },
      (_, index) => `  if (value === ${index}) return ${index}`,
    )
    await repo.write(
      "src/index.ts",
      [
        ...Array.from(
          { length: 80 },
          (_, index) => `export function tiny${index}() { return ${index} }`,
        ),
        "export function tangled(value: number) {",
        ...branches,
        "  return -1",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd01, {
      ...TsLd01.defaultConfig,
      max_complexity: 4,
    })

    expect(out.overThresholdCount).toBe(1)
    expect(out.maxComplexity).toBeGreaterThan(4)
    expect(out.maxComplexityPressure).toBeGreaterThan(out.ratioPressure)
    expect(TsLd01.score(out)).toBeLessThan(0.4)
  })

  test("diagnostics honor configured top_n_diagnostics", async () => {
    await repo.write(
      "src/index.ts",
      `
export function simple() {
  return 1
}

export function tangled(value: number, enabled: boolean) {
  if (enabled && value > 10) return "large"
  if (enabled || value < 0) return "edge"
  return "small"
}
`,
    )

    const out = await runSignal(repo.root, TsLd01, {
      ...TsLd01.defaultConfig,
      top_n_diagnostics: 1,
    })
    const diagnostics = TsLd01.diagnose(out)

    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.message).toContain("tangled")
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsLd01.configSchema)(TsLd01.defaultConfig)

    expect(decoded.max_complexity).toBe(20)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs).toContain("**/*.test.ts")
  })
})
