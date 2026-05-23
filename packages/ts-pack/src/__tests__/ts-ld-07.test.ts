import { describe, expect, test } from "bun:test"
import {
  appendCalibrationDecision,
  CalibrationContextTag,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import { ReferenceDataTag, SignalContextTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import { Effect, Layer, Schema } from "effect"
import { TsProjectLayer } from "../ts-project.js"
import {
  TsLd07,
  type TsLd07Output,
} from "../signals/ts-ld-07-unsafe-type-erosion.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

describe("TS-LD-07 (unsafe type erosion)", () => {
  let repo: TempRepo

  const setup = async (): Promise<void> => {
    repo = await createTempRepo("pulsar-ts-ld-07-")
  }

  const cleanup = async (): Promise<void> => {
    await repo.cleanup()
  }

  test("fully typed source has no unsafe erosion", async () => {
    await setup()
    try {
      await repo.write(
        "src/api.ts",
        [
          "export interface Payload {",
          "  readonly id: string",
          "}",
          "",
          "export function parse(payload: Payload): string {",
          "  return payload.id",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(0)
      expect(out.boundaryOccurrences).toBe(0)
      expect(TsLd07.outputMetadata?.(out)).toBeUndefined()
      expect(TsLd07.score(out)).toBe(1)
      expect(TsLd07.diagnose(out)).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("exported contract any is weighted harder than internal any", async () => {
    await setup()
    try {
      await repo.write(
        "src/contracts.ts",
        [
          "export interface PublicPayload {",
          "  readonly raw: any",
          "}",
          "",
          "export function handle(payload: any): Promise<any> {",
          "  const scratch: any = payload",
          "  return Promise.resolve(scratch)",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      const boundaryTargets = out.occurrences
        .filter((occurrence) => occurrence.boundary)
        .map((occurrence) => occurrence.target)
        .sort()

      expect(out.totalOccurrences).toBe(4)
      expect(out.boundaryOccurrences).toBe(3)
      expect(boundaryTargets).toEqual(["handle", "payload", "raw"])
      expect(out.boundaryWeightedUnsafe).toBeGreaterThan(out.weightedUnsafe / 2)
      expect(TsLd07.score(out)).toBeLessThan(0.6)
      expect(TsLd07.diagnose(out)[0]?.severity).toBe("warn")
    } finally {
      await cleanup()
    }
  })

  test("same-line unsafe generic arguments receive distinct finding ids", async () => {
    await setup()
    try {
      await repo.write(
        "src/signal.ts",
        [
          "interface Signal<Config, Output, Requirements> {}",
          "export interface AnySignal extends Signal<any, any, any> {}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      const heritageOccurrences = out.occurrences.filter(
        (occurrence) => occurrence.kind === "heritage",
      )
      const findingIds = heritageOccurrences.map((occurrence) => occurrence.findingId)

      expect(heritageOccurrences).toHaveLength(3)
      expect(new Set(findingIds).size).toBe(3)
      expect(findingIds.every((id) => id.startsWith("2:"))).toBe(true)
      expect(heritageOccurrences.every((occurrence) => occurrence.boundary)).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("internal any erosion is visible but lower pressure", async () => {
    await setup()
    try {
      await repo.write(
        "src/internal.ts",
        [
          "function normalize(payload: any): any {",
          "  const scratch: any = payload",
          "  return scratch",
          "}",
          "",
          "export const ready = true",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(3)
      expect(out.boundaryOccurrences).toBe(0)
      expect(TsLd07.score(out)).toBeGreaterThan(0.5)
      expect(TsLd07.diagnose(out)[0]?.severity).toBe("info")
    } finally {
      await cleanup()
    }
  })

  test("diagnostic cap is sanitized before selecting occurrences", async () => {
    await setup()
    try {
      await repo.write(
        "src/contracts.ts",
        [
          "export interface PublicPayload {",
          "  readonly raw: any",
          "}",
          "export function handle(payload: any): any {",
          "  const scratch: any = payload",
          "  return scratch",
          "}",
          "",
        ].join("\n"),
      )

      const fractional = await runSignal(repo.root, TsLd07, {
        ...TsLd07.defaultConfig,
        top_n_diagnostics: 1.9,
      })
      expect(fractional.diagnosticLimit).toBe(1)
      expect(fractional.topOccurrences).toHaveLength(1)
      expect(TsLd07.diagnose(fractional)).toHaveLength(1)

      const negative = await runSignal(repo.root, TsLd07, {
        ...TsLd07.defaultConfig,
        top_n_diagnostics: -1,
      })
      expect(negative.diagnosticLimit).toBe(0)
      expect(negative.topOccurrences).toEqual([])
      expect(TsLd07.diagnose(negative)).toEqual([])

      const nonFinite = await runSignal(repo.root, TsLd07, {
        ...TsLd07.defaultConfig,
        top_n_diagnostics: Number.NaN,
      })
      expect(nonFinite.diagnosticLimit).toBe(0)
      expect(nonFinite.topOccurrences).toEqual([])
      expect(TsLd07.diagnose(nonFinite)).toEqual([])
    } finally {
      await cleanup()
    }
  })

  test("path names do not promote unsafe types to boundary evidence", async () => {
    await setup()
    try {
      await repo.write("src/api/route.ts", "const payload: any = {}\n")
      await repo.write("src/ordinary/worker.ts", "const payload: any = {}\n")

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(2)
      expect(out.boundaryOccurrences).toBe(0)
      expect(new Set(out.occurrences.map((occurrence) => occurrence.kind))).toEqual(
        new Set(["variable"]),
      )
    } finally {
      await cleanup()
    }
  })

  test("default export aliases count unsafe types as boundary evidence", async () => {
    await setup()
    try {
      await repo.write(
        "src/default-alias.ts",
        [
          "const handler = (value: any): any => value",
          "export default handler",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(2)
      expect(out.boundaryOccurrences).toBe(2)
      expect(out.occurrences.map((occurrence) => occurrence.target).sort()).toEqual([
        "handler",
        "value",
      ])
      expect(out.occurrences.every((occurrence) => occurrence.severity === "warn")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("default exported class aliases expose public unsafe members as boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/default-class.ts",
        [
          "class Service {",
          "  readonly raw: any",
          "  run(value: any): any {",
          "    return value",
          "  }",
          "  private hidden(value: any): any {",
          "    return value",
          "  }",
          "}",
          "export default Service",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      const boundaryTargets = out.occurrences
        .filter((occurrence) => occurrence.boundary)
        .map((occurrence) => occurrence.target)
        .sort()
      const internalTargets = out.occurrences
        .filter((occurrence) => !occurrence.boundary)
        .map((occurrence) => occurrence.target)
        .sort()

      expect(boundaryTargets).toEqual(["raw", "run", "value"])
      expect(internalTargets).toEqual(["hidden", "value"])
    } finally {
      await cleanup()
    }
  })

  test("nested same-name variables do not inherit named export boundary status", async () => {
    await setup()
    try {
      await repo.write(
        "src/shadow.ts",
        [
          "const publicValue: string = 'ok'",
          "export { publicValue }",
          "export function wrapper(): void {",
          "  const publicValue: any = {}",
          "  void publicValue",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(1)
      expect(out.boundaryOccurrences).toBe(0)
      expect(out.occurrences[0]).toMatchObject({
        kind: "variable",
        target: "publicValue",
        boundary: false,
        severity: "info",
      })
    } finally {
      await cleanup()
    }
  })

  test("exported object literal API functions count unsafe types as boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/api.ts",
        [
          "export const api = {",
          "  handle(value: any): any {",
          "    return value",
          "  },",
          "  parse: (value: any): any => value,",
          "  nested: {",
          "    run(value: any): any {",
          "      return value",
          "    },",
          "  },",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(6)
      expect(out.boundaryOccurrences).toBe(6)
      expect(new Set(out.occurrences.map((occurrence) => occurrence.target))).toEqual(
        new Set(["handle", "parse", "run", "value"]),
      )
      expect(out.occurrences.every((occurrence) => occurrence.severity === "warn")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("exported variable function type annotations count unsafe types as boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/typed-handler.ts",
        [
          "export const handler: (value: any) => any = (value) => value",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(2)
      expect(out.boundaryOccurrences).toBe(2)
      expect(out.occurrences.map((occurrence) => occurrence.target).sort()).toEqual([
        "handler",
        "value",
      ])
      expect(out.occurrences.every((occurrence) => occurrence.severity === "warn")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("exported object-value type annotations count unsafe types as boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/typed-api.ts",
        [
          "export const api: {",
          "  readonly raw: any",
          "  handle: (value: any) => any",
          "  parse(value: any): any",
          "} = {",
          "  raw: {},",
          "  handle: (value) => value,",
          "  parse(value) { return value },",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      const boundaryTargets = out.occurrences
        .filter((occurrence) => occurrence.boundary)
        .map((occurrence) => occurrence.target)
        .sort()

      expect(out.totalOccurrences).toBe(5)
      expect(out.boundaryOccurrences).toBe(5)
      expect(boundaryTargets).toEqual(["handle", "parse", "raw", "value", "value"])
      expect(out.occurrences.every((occurrence) => occurrence.severity === "warn")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("object literal API functions returned from exported functions stay internal", async () => {
    await setup()
    try {
      await repo.write(
        "src/factory.ts",
        [
          "export function makeApi() {",
          "  return {",
          "    run(value: any): any {",
          "      return value",
          "    },",
          "  }",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(2)
      expect(out.boundaryOccurrences).toBe(0)
      expect(out.occurrences.every((occurrence) => occurrence.severity === "info")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("generated and declaration files are excluded by default", async () => {
    await setup()
    try {
      await repo.write("src/generated/client.ts", "export const raw: any = {}\n")
      await repo.write("src/types.d.ts", "export interface External { raw: any }\n")
      await repo.write("src/real.ts", "export const ok: string = 'typed'\n")

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(out.totalOccurrences).toBe(0)
      expect(TsLd07.score(out)).toBe(1)
    } finally {
      await cleanup()
    }
  })

  test("zero analyzed files are not applicable, not healthy evidence", async () => {
    await setup()
    try {
      const empty = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(empty.analyzedFiles).toBe(0)
      expect(empty.analyzedLines).toBe(0)
      expect(empty.totalOccurrences).toBe(0)
      expect(TsLd07.outputMetadata?.(empty)).toEqual({ applicability: "not_applicable" })
      expect(TsLd07.score(empty)).toBe(1)
      expect(TsLd07.diagnose(empty)).toEqual([])

      await repo.write("src/example.test.ts", "export const raw: any = {}\n")
      await repo.write("dist/generated.ts", "export const raw: any = {}\n")
      const allExcluded = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(allExcluded.analyzedFiles).toBe(0)
      expect(allExcluded.totalOccurrences).toBe(0)
      expect(TsLd07.outputMetadata?.(allExcluded)).toEqual({
        applicability: "not_applicable",
      })
    } finally {
      await cleanup()
    }
  })

  test("project modules can deweight deliberate existential unsafe boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/signal.ts",
        [
          "export interface Signal<Config, Output, Requirements> {",
          "  readonly id: string",
          "}",
          "",
          "export interface AnySignal extends Signal<any, any, any> {}",
          "",
        ].join("\n"),
      )

      const baseline = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      expect(baseline.boundaryOccurrences).toBe(3)
      expect(TsLd07.score(baseline)).toBeLessThan(1)

      const processor = defineCalibrationProcessor({
        id: "existential-signal-wrapper",
        moduleId: "acme.project",
        moduleVersion: "1.0.0",
        slot: "typescript.unsafe-type-policy",
        role: "factor-policy",
        priority: 10,
        fingerprint: "existential-signal-wrapper-v1",
        process: (current) =>
          Effect.sync(() => {
            if (current.value.target !== "AnySignal" || current.value.kind !== "heritage") {
              return current
            }
            return appendCalibrationDecision(
              current,
              {
                moduleId: "acme.project",
                processorId: "existential-signal-wrapper",
                slot: "typescript.unsafe-type-policy",
                action: "deweight-deliberate-existential",
                confidence: "high",
                reason: "AnySignal is an explicit existential wrapper around unknown signal generics",
                ruleId: "acme.existential-signal-wrapper.v1",
                factorPaths: [
                  `${current.value.factorPathPrefix}.boundary`,
                  `${current.value.factorPathPrefix}.severity`,
                  `${current.value.factorPathPrefix}.weight`,
                ],
                before: current.value,
                after: {
                  boundary: false,
                  severity: "info",
                  weight: 0,
                },
                evidence: [{ kind: "symbol", value: current.value.target }],
              },
              {
                ...current.value,
                boundary: false,
                severity: "info",
                weight: 0,
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
        TsLd07.compute(TsLd07.defaultConfig, new Map()).pipe(
          Effect.provide(
            Layer.mergeAll(
              TsProjectLayer(repo.root),
              Layer.succeed(CalibrationContextTag, calibrationContext),
              Layer.succeed(SignalContextTag, {
                gitSha: "TEST",
                worktreePath: repo.root,
                changedHunks: [],
              }),
              Layer.succeed(ReferenceDataTag, makeReferenceData(new Map())),
            ),
          ),
        ) as Effect.Effect<TsLd07Output, unknown, never>,
      )

      expect(out.calibrationDecisions).toHaveLength(3)
      expect(out.boundaryOccurrences).toBe(0)
      expect(out.weightedUnsafe).toBe(0)
      expect(TsLd07.score(out)).toBe(1)
      expect(TsLd07.diagnose(out).every((diagnostic) => diagnostic.severity === "info")).toBe(
        true,
      )
    } finally {
      await cleanup()
    }
  })

  test("default config decodes", () => {
    const decoded = Schema.decodeUnknownSync(TsLd07.configSchema)(TsLd07.defaultConfig)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
    expect(decoded.max_weighted_unsafe_per_kloc).toBeGreaterThan(0)
    expect(decoded.max_boundary_weighted_unsafe).toBeGreaterThan(0)
  })
})
