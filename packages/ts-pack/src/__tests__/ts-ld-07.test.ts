import { describe, expect, test } from "bun:test"
import {
  appendCalibrationDecision,
  CalibrationContextTag,
  defineCalibrationProcessor,
  makeResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { ReferenceDataTag, SignalContextTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import { Effect, Layer, Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
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

  const stableOutput = (out: TsLd07Output): unknown => ({
    byFile: [...out.byFile.entries()].sort(([left], [right]) => left.localeCompare(right)),
    occurrences: out.occurrences,
    topOccurrences: out.topOccurrences,
    totalOccurrences: out.totalOccurrences,
    boundaryOccurrences: out.boundaryOccurrences,
    weightedUnsafe: out.weightedUnsafe,
    boundaryWeightedUnsafe: out.boundaryWeightedUnsafe,
    analyzedFiles: out.analyzedFiles,
    analyzedLines: out.analyzedLines,
    densityPerKloc: out.densityPerKloc,
    densityPressure: out.densityPressure,
    boundaryPressure: out.boundaryPressure,
    densityThreshold: out.densityThreshold,
    boundaryThreshold: out.boundaryThreshold,
    diagnosticLimit: out.diagnosticLimit,
  })

  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    await setup()
    try {
      await repo.write("src/value.ts", "export const value: string = 'typed'\n")

      const packRegistered = TS_PACK_SIGNALS.find((signal) =>
        signal.aliases?.includes("TS-LD-07"),
      )
      expect(packRegistered).toBeDefined()
      const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
      const registered = registry.byId.get("TS-LD-07")
      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      const factorLedger = registered?.factorLedger?.(out)

      expect(TsLd07).toMatchObject({
        id: "TS-LD-07-unsafe-type-erosion",
        title: "Unsafe type erosion",
        aliases: ["TS-LD-07"],
        tier: 1,
        category: "legibility-decay",
        kind: "legibility",
        cacheVersion: "unsafe-type-erosion-v7-boundary-assertions-v1",
        inputs: [],
      })
      expect(registered?.id).toBe(TsLd07.id)
      expect(registered?.title).toBe(TsLd07.title)
      expect(registered?.cacheVersion).toContain(TsLd07.cacheVersion)
      expect(registry.byId.get("TS-LD-07")?.id).toBe(TsLd07.id)
      expect(factorLedger?.signalId).toBe(TsLd07.id)
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.exclude_globs",
          source: "signal-default",
          scoreRole: "metadata",
        }),
      )
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.max_weighted_unsafe_per_kloc",
          value: 10,
          source: "signal-default",
          scoreRole: "weight",
        }),
      )
      expect(factorLedger?.entries).toContainEqual(
        expect.objectContaining({
          path: "config.max_boundary_weighted_unsafe",
          value: 48,
          source: "signal-default",
          scoreRole: "weight",
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
    } finally {
      await cleanup()
    }
  })

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
      expect(out.weightedUnsafe).toBe(19)
      expect(out.boundaryWeightedUnsafe).toBe(17)
      expect(out.densityPerKloc).toBe(19)
      expect(out.densityPressure).toBe(1.9)
      expect(out.boundaryPressure).toBeCloseTo(17 / 48)
      expect(out.boundaryWeightedUnsafe).toBeGreaterThan(out.weightedUnsafe / 2)
      expect(TsLd07.score(out)).toBeCloseTo(1 / (1 + 1.9))
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

  test("diagnostics include deterministic order, location, and payload data", async () => {
    await setup()
    try {
      const first = await repo.write(
        "src/a.ts",
        [
          "export function alpha(",
          "  value: any,",
          "): any {",
          "  const local: any = value",
          "  return value",
          "}",
          "",
        ].join("\n"),
      )
      const second = await repo.write(
        "src/z.ts",
        [
          "export interface Payload {",
          "  readonly raw: any",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, {
        ...TsLd07.defaultConfig,
        top_n_diagnostics: 3,
      })
      const diagnostics = TsLd07.diagnose(out)

      expect(out.topOccurrences.map((occurrence) => occurrence.target)).toEqual([
        "value",
        "alpha",
        "raw",
      ])
      expect(diagnostics).toMatchObject([
        {
          severity: "warn",
          message: "Unsafe `any` in boundary parameter `value`",
          location: { file: first, line: 2 },
          data: {
            file: first,
            line: 2,
            kind: "parameter",
            target: "value",
            boundary: true,
            severity: "warn",
            baseWeight: 6,
            weight: 6,
            densityPerKloc: out.densityPerKloc,
            densityThreshold: 10,
            boundaryThreshold: 48,
          },
        },
        {
          severity: "warn",
          message: "Unsafe `any` in boundary return `alpha`",
          location: { file: first, line: 3 },
          data: {
            file: first,
            line: 3,
            kind: "return",
            target: "alpha",
            boundary: true,
            baseWeight: 6,
            weight: 6,
          },
        },
        {
          severity: "warn",
          message: "Unsafe `any` in boundary property `raw`",
          location: { file: second, line: 2 },
          data: {
            file: second,
            line: 2,
            kind: "property",
            target: "raw",
            boundary: true,
            baseWeight: 5,
            weight: 5,
          },
        },
      ])
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

  test("exported function inline parameter type literals count unsafe types as boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/consume.ts",
        [
          "export function consume(arg: {",
          "  readonly raw: any",
          "  parse(value: any): any",
          "}): void {",
          "  void arg",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(3)
      expect(out.boundaryOccurrences).toBe(3)
      expect(out.occurrences.map((occurrence) => occurrence.target).sort()).toEqual([
        "parse",
        "raw",
        "value",
      ])
      expect(out.occurrences.every((occurrence) => occurrence.severity === "warn")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("exported function inline return type literals count unsafe types as boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/make-api.ts",
        [
          "export function makeApi(): {",
          "  readonly raw: any",
          "  parse(value: any): any",
          "} {",
          "  return { raw: {}, parse: (value) => value }",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(3)
      expect(out.boundaryOccurrences).toBe(3)
      expect(out.occurrences.map((occurrence) => occurrence.target).sort()).toEqual([
        "parse",
        "raw",
        "value",
      ])
    } finally {
      await cleanup()
    }
  })

  test("callback types nested in exported function contracts count unsafe types as boundaries", async () => {
    await setup()
    try {
      await repo.write(
        "src/callback.ts",
        [
          "export function subscribe(callback: (value: any) => any): void {",
          "  void callback",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(2)
      expect(out.boundaryOccurrences).toBe(2)
      expect(out.occurrences.map((occurrence) => occurrence.target).sort()).toEqual([
        "callback",
        "value",
      ])
    } finally {
      await cleanup()
    }
  })

  test("exported inferred assertions count as boundary unsafe contracts", async () => {
    await setup()
    try {
      await repo.write(
        "src/assertions.ts",
        [
          "declare const external: unknown",
          "export const boundaryValue = external as any",
          "export function parse(input: unknown) {",
          "  return input as any",
          "}",
          "export const api = {",
          "  raw: external as any,",
          "  parse(input: unknown) {",
          "    return input as any",
          "  },",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(4)
      expect(out.boundaryOccurrences).toBe(4)
      expect(out.occurrences.every((occurrence) => occurrence.kind === "assertion")).toBe(true)
      expect(out.occurrences.every((occurrence) => occurrence.severity === "warn")).toBe(true)
    } finally {
      await cleanup()
    }
  })

  test("internal and explicitly typed assertions remain internal unsafe facts", async () => {
    await setup()
    try {
      await repo.write(
        "src/internal-assertions.ts",
        [
          "declare const external: unknown",
          "const local = external as any",
          "export const safeValue: unknown = external as any",
          "export function parse(input: unknown): unknown {",
          "  return input as any",
          "}",
          "export const typedApi: { readonly raw: unknown } = {",
          "  raw: external as any,",
          "}",
          "",
        ].join("\n"),
      )

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.totalOccurrences).toBe(4)
      expect(out.boundaryOccurrences).toBe(0)
      expect(out.occurrences.every((occurrence) => occurrence.kind === "assertion")).toBe(true)
      expect(out.occurrences.every((occurrence) => occurrence.severity === "info")).toBe(true)
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

  test("representative default exclusion globs suppress helper and build output unsafe types", async () => {
    await setup()
    try {
      await repo.write("src/example.spec.ts", "export const raw: any = {}\n")
      await repo.write("src/story.stories.ts", "export const raw: any = {}\n")
      await repo.write("src/__tests__/helper.ts", "export const raw: any = {}\n")
      await repo.write("src/test/helper.ts", "export const raw: any = {}\n")
      await repo.write("src/tests/helper.ts", "export const raw: any = {}\n")
      await repo.write("src/generated/client.ts", "export const raw: any = {}\n")
      await repo.write("src/client.gen.ts", "export const raw: any = {}\n")
      await repo.write("dist/out.ts", "export const raw: any = {}\n")
      await repo.write("build/out.ts", "export const raw: any = {}\n")
      await repo.write("coverage/out.ts", "export const raw: any = {}\n")
      await repo.write("src/real.ts", "export const ok: string = 'typed'\n")

      const out = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(out.analyzedFiles).toBe(1)
      expect(out.totalOccurrences).toBe(0)
      expect(TsLd07.outputMetadata?.(out)).toBeUndefined()
      expect(TsLd07.score(out)).toBe(1)
    } finally {
      await cleanup()
    }
  })

  test("custom exclusions remove matching unsafe sources without hiding other files", async () => {
    await setup()
    try {
      await repo.write("src/ignored.ts", "export const ignored: any = {}\n")
      const real = await repo.write("src/real.ts", "export const real: any = {}\n")

      const out = await runSignal(repo.root, TsLd07, {
        ...TsLd07.defaultConfig,
        exclude_globs: ["**/ignored.ts"],
      })

      expect(out.analyzedFiles).toBe(1)
      expect(out.totalOccurrences).toBe(1)
      expect(out.occurrences[0]).toMatchObject({
        file: real,
        kind: "variable",
        target: "real",
        boundary: true,
      })
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

  test("compute output is deterministic for stable source facts", async () => {
    await setup()
    try {
      await repo.write(
        "src/deterministic.ts",
        [
          "export interface Payload {",
          "  readonly raw: any",
          "}",
          "export function handle(value: any): any {",
          "  return value",
          "}",
          "",
        ].join("\n"),
      )

      const first = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)
      const second = await runSignal(repo.root, TsLd07, TsLd07.defaultConfig)

      expect(stableOutput(second)).toEqual(stableOutput(first))
      expect(TsLd07.diagnose(second)).toEqual(TsLd07.diagnose(first))
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
