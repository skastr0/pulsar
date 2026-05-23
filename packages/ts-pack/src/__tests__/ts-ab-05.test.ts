import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAb05 } from "../signals/ts-ab-05-generic-proliferation.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string
type TsAb05Result = Parameters<typeof TsAb05.score>[0]

const stableTsAb05Output = (out: TsAb05Result): unknown => ({
  byDeclaration: out.byDeclaration,
  distribution: out.distribution,
  overThreshold: out.overThreshold,
  genericThreshold: out.genericThreshold,
  diagnosticLimit: out.diagnosticLimit,
})

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsAb05.defaultConfig): Promise<TsAb05Result> => {
  const program = TsAb05.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsAb05Result, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-ab-05-"))
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

describe("TS-AB-05 (generic parameter proliferation)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const packRegistered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-AB-05"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("TS-AB-05")
    const out = await runCompute()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsAb05).toMatchObject({
      id: "TS-AB-05-generic-proliferation",
      title: "Generic proliferation",
      aliases: ["TS-AB-05"],
      tier: 1,
      category: "abstraction-bloat",
      kind: "legibility",
      cacheVersion: "generic-proliferation-v3-signature-declarations-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsAb05.id)
    expect(registered?.title).toBe(TsAb05.title)
    expect(registered?.cacheVersion).toContain(TsAb05.cacheVersion)
    expect(registry.byId.get("TS-AB-05")?.id).toBe(TsAb05.id)
    expect(factorLedger?.signalId).toBe(TsAb05.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_generic_parameters",
        value: 3,
        source: "signal-default",
        scoreRole: "threshold",
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
  })

  test("no tracked declarations: neutral output, score 1, and no diagnostics", async () => {
    await writeTs("src/value.ts", "export const value = 1\n")

    const out = await runCompute()

    expect(out.byDeclaration).toEqual([])
    expect(out.distribution).toEqual({ max: 0, p95: 0, avg: 0, sum: 0, count: 0 })
    expect(out.overThreshold).toEqual([])
    expect(out.genericThreshold).toBe(3)
    expect(out.diagnosticLimit).toBe(10)
    expect(TsAb05.score(out)).toBe(1)
    expect(TsAb05.diagnose(out)).toEqual([])
  })

  test("tracks 0, 1, 3, and 5 generic parameters across declarations", async () => {
    await writeTs(
      "src/index.ts",
      [
        "export function plain(value: string): string { return value }",
        "export function single<T>(value: T): T { return value }",
        "export type Triple<T, U, V> = [T, U, V]",
        "export class Five<A, B, C, D, E> {}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byName = new Map(out.byDeclaration.map((entry) => [entry.declarationName, entry]))

    expect(byName.get("plain")?.paramCount).toBe(0)
    expect(byName.get("single")?.paramCount).toBe(1)
    expect(byName.get("Triple")?.paramCount).toBe(3)
    expect(byName.get("Five")?.paramCount).toBe(5)
    expect(out.distribution.count).toBe(4)
    expect(out.overThreshold.map((entry) => entry.declarationName)).toEqual(["Five"])
    expect(TsAb05.score(out)).toBeLessThan(1)
  })

  test("tracks function expressions, arrows, interfaces, methods, and anonymous declarations", async () => {
    await writeTs(
      "src/declarations.ts",
      [
        "export interface Box<T> {",
        "  readonly value: T",
        "}",
        "export class Mapper {",
        "  map<U>(value: unknown): U {",
        "    return value as U",
        "  }",
        "}",
        "export const arrow = <T, U>(value: T): U => value as unknown as U",
        "export const fn = function <T, U, V>(value: T): [T, U, V] {",
        "  return [value, undefined as U, undefined as V]",
        "}",
        "export default <T>(value: T): T => value",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byName = new Map(out.byDeclaration.map((entry) => [entry.declarationName, entry]))

    expect(byName.get("Box")?.paramCount).toBe(1)
    expect(byName.get("map")?.paramCount).toBe(1)
    expect(byName.get("arrow")?.paramCount).toBe(2)
    expect(byName.get("fn")?.paramCount).toBe(3)
    expect(byName.get("<default export>")?.paramCount).toBe(1)
  })

  test("tracks interface signatures and direct type-alias function shapes", async () => {
    await writeTs(
      "src/signatures.ts",
      [
        "export interface Api {",
        "  method<A, B, C, D>(value: A): D",
        "  <T, U, V, W>(value: T): W",
        "  new <I, O>(input: I): O",
        "}",
        "export type FnAlias = <T, U, V, W>(value: T) => W",
        "export type NewAlias = new <A, B, C>(value: A) => B",
        "export type Parenthesized = (<P, Q, R, S>(value: P) => S)",
        "export type Nested = { handler: <X, Y, Z, W>(value: X) => W }",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byName = new Map(out.byDeclaration.map((entry) => [entry.declarationName, entry]))

    expect(byName.get("method")?.paramCount).toBe(4)
    expect(byName.get("method")?.returnOnlyParams).toEqual(["D"])
    expect(byName.get("Api.<call>")?.paramCount).toBe(4)
    expect(byName.get("Api.<call>")?.returnOnlyParams).toEqual(["W"])
    expect(byName.get("Api.<new>")?.paramCount).toBe(2)
    expect(byName.get("Api.<new>")?.returnOnlyParams).toEqual(["O"])
    expect(byName.get("FnAlias.<call>")?.paramCount).toBe(4)
    expect(byName.get("FnAlias.<call>")?.returnOnlyParams).toEqual(["W"])
    expect(byName.get("NewAlias.<new>")?.paramCount).toBe(3)
    expect(byName.get("Parenthesized.<call>")?.paramCount).toBe(4)
    expect(byName.has("Nested.<call>")).toBe(false)
    expect(byName.get("Nested")?.paramCount).toBe(0)
    expect(out.overThreshold.map((entry) => entry.declarationName)).toEqual(
      expect.arrayContaining(["method", "Api.<call>", "FnAlias.<call>", "Parenthesized.<call>"]),
    )
  })

  test("computes nested constraint depth per type parameter", async () => {
    await writeTs(
      "src/constraints.ts",
      [
        "export function constrained<",
        "  T extends string,",
        "  U extends Readonly<Array<T>>",
        ">(value: U): U {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const constrained = out.byDeclaration.find((entry) => entry.declarationName === "constrained")
    expect(constrained?.maxConstraintDepth).toBe(3)
  })

  test("detects generics used only in explicit return position", async () => {
    await writeTs(
      "src/returns.ts",
      [
        "export function makeValue<T, U>(value: U): T {",
        "  return value as unknown as T",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const makeValue = out.byDeclaration.find((entry) => entry.declarationName === "makeValue")
    expect(makeValue?.returnOnlyParams).toEqual(["T"])
  })

  test("constraints and defaults prevent false return-only generic classification", async () => {
    await writeTs(
      "src/constraint-return.ts",
      [
        "export function constrained<T, U extends T>(value: U): T {",
        "  return value",
        "}",
        "export function defaulted<T, U = T>(value: U): T {",
        "  return value as unknown as T",
        "}",
        "export function returnOnly<T, U>(value: U): T {",
        "  return value as unknown as T",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byName = new Map(out.byDeclaration.map((entry) => [entry.declarationName, entry]))

    expect(byName.get("constrained")?.returnOnlyParams).toEqual([])
    expect(byName.get("defaulted")?.returnOnlyParams).toEqual([])
    expect(byName.get("returnOnly")?.returnOnlyParams).toEqual(["T"])
  })

  test("diagnostics list over-threshold declarations", async () => {
    const file = await writeTs(
      "src/diagnostics.ts",
      [
        "export type TooMany<A, B, C, D> = [A, B, C, D]",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsAb05.defaultConfig,
      max_generic_parameters: 2,
    })

    const diagnostics = TsAb05.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toEqual(
      expect.objectContaining({
        severity: "warn",
        message:
          "Generic proliferation in `TooMany`: 4 type parameters (max constraint depth 0)",
        location: expect.objectContaining({
          file,
          line: 1,
        }),
        data: expect.objectContaining({
          file,
          declarationName: "TooMany",
          line: 1,
          paramCount: 4,
          maxConstraintDepth: 0,
          returnOnlyParams: [],
          genericThreshold: 2,
        }),
      }),
    )
  })

  test("diagnostics honor sanitized top_n_diagnostics", async () => {
    await writeTs(
      "src/many.ts",
      [
        "export type TooManyA<A, B, C, D> = [A, B, C, D]",
        "export type TooManyB<A, B, C, D> = [A, B, C, D]",
        "",
      ].join("\n"),
    )

    const fractional = await runCompute({
      ...TsAb05.defaultConfig,
      max_generic_parameters: 2,
      top_n_diagnostics: 1.8,
    })
    const negative = await runCompute({
      ...TsAb05.defaultConfig,
      max_generic_parameters: 2,
      top_n_diagnostics: -1,
    })
    const nan = await runCompute({
      ...TsAb05.defaultConfig,
      max_generic_parameters: 2,
      top_n_diagnostics: Number.NaN,
    })
    const infinite = await runCompute({
      ...TsAb05.defaultConfig,
      max_generic_parameters: 2,
      top_n_diagnostics: Number.POSITIVE_INFINITY,
    })

    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsAb05.diagnose(fractional)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(nan.diagnosticLimit).toBe(0)
    expect(infinite.diagnosticLimit).toBe(0)
    expect(TsAb05.diagnose(negative)).toEqual([])
    expect(TsAb05.diagnose(nan)).toEqual([])
    expect(TsAb05.diagnose(infinite)).toEqual([])
  })

  test("score uses over-threshold declarations over total tracked declarations", async () => {
    await writeTs(
      "src/score.ts",
      [
        "export type A<T> = T",
        "export type B<T> = T",
        "export type TooManyA<A, B, C, D> = [A, B, C, D]",
        "export type TooManyB<A, B, C, D> = [A, B, C, D]",
        "",
      ].join("\n"),
    )

    const out = await runCompute()

    expect(out.byDeclaration).toHaveLength(4)
    expect(out.overThreshold).toHaveLength(2)
    expect(TsAb05.score(out)).toBe(0.5)
  })

  test("excluded test, declaration, and generated files are not analyzed", async () => {
    await writeTs("src/live.ts", "export type Live<T> = T\n")
    await writeTs("src/live.test.ts", "export type TestOnly<A, B, C, D> = [A, B, C, D]\n")
    await writeTs("src/generated.gen.ts", "export type Generated<A, B, C, D> = [A, B, C, D]\n")
    await writeTs("src/types.d.ts", "export type Ambient<A, B, C, D> = [A, B, C, D]\n")

    const out = await runCompute()

    expect(out.byDeclaration.map((entry) => entry.declarationName)).toEqual(["Live"])
    expect(out.overThreshold).toEqual([])
    expect(TsAb05.score(out)).toBe(1)
  })

  test("deterministic: same project, same output, diagnostics, and score", async () => {
    await writeTs(
      "src/order.ts",
      [
        "export type TooManyB<A, B, C, D> = [A, B, C, D]",
        "export type TooManyA<A, B, C, D> = [A, B, C, D]",
        "export type Small<T> = T",
        "",
      ].join("\n"),
    )

    const first = await runCompute({ ...TsAb05.defaultConfig, max_generic_parameters: 2 })
    const second = await runCompute({ ...TsAb05.defaultConfig, max_generic_parameters: 2 })

    expect(stableTsAb05Output(second)).toEqual(stableTsAb05Output(first))
    expect(TsAb05.diagnose(second)).toEqual(TsAb05.diagnose(first))
    expect(TsAb05.score(second)).toBe(TsAb05.score(first))
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAb05.configSchema)(TsAb05.defaultConfig)
    expect(decoded.exclude_globs).toContain("**/node_modules/**")
    expect(decoded.exclude_globs).toContain("**/*.test.ts")
    expect(decoded.max_generic_parameters).toBe(3)
    expect(decoded.top_n_diagnostics).toBe(10)
  })
})
