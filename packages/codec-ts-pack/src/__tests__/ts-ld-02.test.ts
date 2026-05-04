import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  TsLd02,
  TsLd02Config,
  type TsLd02Output,
} from "../signals/ts-ld-02-size-distribution.js"
import { TsProjectLayer } from "../ts-project.js"

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

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "taste-codec-ts-ld-02-"))
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
    const decoded = Schema.decodeUnknownSync(TsLd02Config)(TsLd02.defaultConfig)
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
})
