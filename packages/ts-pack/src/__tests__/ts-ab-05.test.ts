import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  TsAb05,
  TsAb05Config,
  type TsAb05Output,
} from "../signals/ts-ab-05-generic-proliferation.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsAb05.defaultConfig): Promise<TsAb05Output> => {
  const program = TsAb05.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsAb05Output, unknown, never>)
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

  test("diagnostics list over-threshold declarations", async () => {
    await writeTs(
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
    expect(diagnostics[0]?.message).toContain("TooMany")
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAb05Config)(TsAb05.defaultConfig)
    expect(decoded.max_generic_parameters).toBe(3)
    expect(decoded.top_n_diagnostics).toBe(10)
  })
})
