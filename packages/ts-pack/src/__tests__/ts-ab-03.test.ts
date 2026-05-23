import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { TsAb03 } from "../signals/ts-ab-03-type-indirection-depth.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string
type TsAb03Result = Parameters<typeof TsAb03.score>[0]

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsAb03.defaultConfig): Promise<TsAb03Result> => {
  const program = TsAb03.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsAb03Result, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-ab-03-"))
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

describe("TS-AB-03 (type indirection depth)", () => {
  test("simple alias resolves to a single layer", async () => {
    await writeTs("src/simple.ts", "export type Name = string\n")

    const out = await runCompute()
    const name = out.declarations.find((entry) => entry.name === "Name")

    expect(name?.depth).toBe(1)
    expect(name?.chain).toEqual(["Name"])
  })

  test("mapped types contribute explicit indirection layers", async () => {
    await writeTs(
      "src/mapped.ts",
      "export type Box<T> = { [K in keyof T]: T[K] }\n",
    )

    const out = await runCompute()
    const box = out.declarations.find((entry) => entry.name === "Box")
    expect(box?.depth ?? 0).toBeGreaterThanOrEqual(2)
    expect(box?.chain).toContain("<mapped>")
  })

  test("conditional types contribute explicit indirection layers", async () => {
    await writeTs(
      "src/conditional.ts",
      "export type Maybe<T> = T extends string ? T : never\n",
    )

    const out = await runCompute()
    const maybe = out.declarations.find((entry) => entry.name === "Maybe")
    expect(maybe?.depth).toBe(2)
    expect(maybe?.chain).toEqual(["Maybe", "<conditional>"])
  })

  test("deep alias chains accumulate depth", async () => {
    await writeTs(
      "src/deep.ts",
      [
        "type A = string",
        "type B = A",
        "type C = B",
        "export type D = C",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const d = out.declarations.find((entry) => entry.name === "D")
    expect(d?.depth).toBe(4)
    expect(d?.chain).toEqual(["D", "C", "B", "A"])
  })

  test("recursive aliases are cycle-safe", async () => {
    await writeTs(
      "src/recursive.ts",
      "export type Json = string | { nested: Json }\n",
    )

    const out = await runCompute()
    const json = out.declarations.find((entry) => entry.name === "Json")
    expect(json?.cycle).toBe(true)
    expect(json?.chain.some((segment) => segment.includes("cycle"))).toBe(true)
  })

  test("diagnostics include resolution chains for entries above threshold", async () => {
    await writeTs(
      "src/diagnostics.ts",
      [
        "type A = string",
        "type B = A",
        "export type C = B",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
    })

    const diagnostics = TsAb03.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.message).toContain("→")
  })

  test("diagnostics honor sanitized top_n_diagnostics", async () => {
    await writeTs(
      "src/diagnostic-limit.ts",
      [
        "type A = string",
        "export type B = A",
        "export type C = B",
        "export type D = C",
        "",
      ].join("\n"),
    )

    const capped = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
      top_n_diagnostics: 1.8,
    })
    expect(capped.diagnosticLimit).toBe(1)
    expect(TsAb03.diagnose(capped)).toHaveLength(1)

    const negative = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
      top_n_diagnostics: -1,
    })
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsAb03.diagnose(negative)).toEqual([])

    const nan = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
      top_n_diagnostics: Number.NaN,
    })
    expect(nan.diagnosticLimit).toBe(0)
    expect(TsAb03.diagnose(nan)).toEqual([])

    const infinite = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
      top_n_diagnostics: Number.POSITIVE_INFINITY,
    })
    expect(infinite.diagnosticLimit).toBe(0)
    expect(TsAb03.diagnose(infinite)).toEqual([])
  })

  test("shallow local helper aliases are informational, not warning-level boundary findings", async () => {
    await writeTs(
      "src/local-helper.ts",
      [
        "type Source = { readonly value: string }",
        "type LocalInput = NonNullable<Source['value']>",
        "export const useInput = (input: LocalInput) => input",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 3,
    })

    const localInput = out.declarations.find((entry) => entry.name === "LocalInput")
    expect(localInput?.exported).toBe(false)

    const diagnostic = TsAb03.diagnose(out).find((entry) =>
      entry.message.includes("LocalInput"),
    )
    expect(diagnostic?.severity).toBe("info")
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAb03.configSchema)(TsAb03.defaultConfig)
    expect(decoded.max_depth).toBe(4)
    expect(decoded.max_traversal_steps).toBe(16)
  })
})
