import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  TsLd06,
  TsLd06Config,
  type TsLd06Output,
} from "../signals/ts-ld-06-annotation-coverage.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsLd06.defaultConfig): Promise<TsLd06Output> => {
  const program = TsLd06.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsLd06Output, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "taste-codec-ts-ld-06-"))
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

describe("TS-LD-06 (type annotation coverage)", () => {
  test("fully annotated boundary functions score 1", async () => {
    await writeTs(
      "src/api.ts",
      [
        "export function annotated(value: string): number {",
        "  return value.length",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.totalParams).toBe(1)
    expect(out.boundaryCoverage.annotatedParams).toBe(1)
    expect(out.boundaryCoverage.annotatedReturns).toBe(1)
    expect(out.boundaryCoverage.coverage).toBe(1)
    expect(out.uncoveredBoundary).toEqual([])
    expect(TsLd06.score(out)).toBe(1)
  })

  test("fully inferred boundary functions are flagged as missing both", async () => {
    const file = await writeTs(
      "src/inferred.ts",
      [
        "export function inferred(value) {",
        "  return value",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.coverage).toBe(0)
    expect(out.uncoveredBoundary).toEqual([
      {
        file,
        name: "inferred",
        line: 1,
        missingKind: "both",
      },
    ])
  })

  test("boundary coverage excludes internal functions from the score", async () => {
    await writeTs(
      "src/mixed.ts",
      [
        "export const boundary = (value: string) => value.length",
        "const internal = (value) => value",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.boundaryCoverage.totalParams).toBe(1)
    expect(out.boundaryCoverage.annotatedParams).toBe(1)
    expect(out.boundaryCoverage.annotatedReturns).toBe(0)
    expect(out.boundaryCoverage.coverage).toBe(0.5)
    expect(out.internalCoverage.coverage).toBe(0)
    expect(TsLd06.score(out)).toBe(0.5)
  })

  test("named exports count as boundaries and callback arrows are excluded", async () => {
    const file = await writeTs(
      "src/named.ts",
      [
        "const publicFn = (value) => value",
        "export { publicFn }",
        "const values = [1].map((value) => value + 1)",
        "export const total = values.length",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toEqual(["publicFn"])
    const fileCoverage = out.byFile.get(file)
    expect(fileCoverage?.boundary.totalParams).toBe(1)
    expect(fileCoverage?.internal.totalParams ?? 0).toBe(0)
  })

  test("exported class public methods count as boundary functions", async () => {
    await writeTs(
      "src/service.ts",
      [
        "export class Service {",
        "  run(value): number {",
        "    return value",
        "  }",
        "",
        "  private hidden(value) {",
        "    return value",
        "  }",
        "}",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(out.uncoveredBoundary.map((fn) => fn.name)).toContain("Service.run")
    expect(out.uncoveredBoundary.map((fn) => fn.name)).not.toContain("Service.hidden")
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsLd06Config)(TsLd06.defaultConfig)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
  })
})
