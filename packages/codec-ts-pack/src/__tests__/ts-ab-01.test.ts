import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  TsAb01,
  TsAb01Config,
  type TsAb01Output,
} from "../signals/ts-ab-01-public-export-surface.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsAb01.defaultConfig): Promise<TsAb01Output> => {
  const program = TsAb01.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsAb01Output, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "taste-codec-ts-ab-01-"))
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

describe("TS-AB-01 (public export surface)", () => {
  test("no barrel files: empty output, score 1", async () => {
    await writeTs("src/helper.ts", "export const h = 1\n")
    const out = await runCompute()
    expect(out.byFile.size).toBe(0)
    expect(out.totalPublicExports).toBe(0)
    expect(TsAb01.score(out)).toBe(1)
  })

  test("small barrel: counted with kind breakdown", async () => {
    const idx = await writeTs(
      "src/index.ts",
      [
        "export function a() { return 1 }",
        "export class B {}",
        "export interface C { x: number }",
        "export type D = number",
        "export const e = 1",
        "",
      ].join("\n"),
    )
    const out = await runCompute()
    const surface = out.byFile.get(idx)
    expect(surface).toBeDefined()
    expect(surface!.total).toBe(5)
    expect(surface!.byKind.function).toBe(1)
    expect(surface!.byKind.class).toBe(1)
    expect(surface!.byKind.interface).toBe(1)
    expect(surface!.byKind.type).toBe(1)
    expect(surface!.byKind.const).toBe(1)
    expect(TsAb01.score(out)).toBe(1) // below threshold
  })

  test("oversized barrel: score drops via log-scale penalty", async () => {
    const lines: Array<string> = []
    for (let i = 0; i < 120; i += 1) {
      lines.push(`export const k${i} = ${i}`)
    }
    await writeTs("src/index.ts", lines.join("\n") + "\n")
    const out = await runCompute()
    expect(out.totalPublicExports).toBeGreaterThanOrEqual(120)
    expect(TsAb01.score(out)).toBeLessThan(1)
    expect(TsAb01.score(out)).toBeGreaterThan(0)
  })

  test("score reacts to configured threshold via output capture", async () => {
    const lines = Array.from({ length: 80 }, (_, i) => `export const k${i} = ${i}`)
    await writeTs("src/index.ts", lines.join("\n") + "\n")
    const strictOut = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 20,
    })
    const lenientOut = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 200,
    })
    // Lower threshold -> worst file crosses it, score penalized.
    expect(TsAb01.score(strictOut)).toBeLessThan(TsAb01.score(lenientOut))
    // Lenient threshold is well above the surface, so score stays 1.
    expect(TsAb01.score(lenientOut)).toBe(1)
  })

  test("named re-exports count the resolved exported symbols", async () => {
    await writeTs("src/a.ts", "export const a = 1\n")
    await writeTs("src/b.ts", "export const b = 1\n")
    const idx = await writeTs(
      "src/index.ts",
      ["export { a } from './a'", "export { b } from './b'", ""].join("\n"),
    )
    const out = await runCompute()
    const surface = out.byFile.get(idx)
    expect(surface?.total).toBe(2)
    expect(surface?.byKind.const).toBe(2)
  })

  test("export star resolves and counts the re-exported symbols individually", async () => {
    await writeTs(
      "src/lib.ts",
      [
        "export const a = 1",
        "export interface B { x: number }",
        "",
      ].join("\n"),
    )
    const idx = await writeTs("src/index.ts", "export * from './lib'\n")
    const out = await runCompute()
    const surface = out.byFile.get(idx)
    expect(surface?.total).toBe(2)
    expect(surface?.byKind.const).toBe(1)
    expect(surface?.byKind.interface).toBe(1)
  })

  test("default exports count as one public symbol", async () => {
    const idx = await writeTs(
      "src/index.ts",
      "export default function makeThing() { return 1 }\n",
    )
    const out = await runCompute()
    const surface = out.byFile.get(idx)
    expect(surface?.total).toBe(1)
    expect(surface?.byKind.default).toBe(1)
  })

  test("export equals counts as one public symbol", async () => {
    const idx = await writeTs(
      "src/index.ts",
      ["const legacy = { ok: true }", "export = legacy", ""].join("\n"),
    )
    const out = await runCompute()
    const surface = out.byFile.get(idx)
    expect(surface?.total).toBe(1)
    expect(surface?.byKind["export-equals"]).toBe(1)
  })

  test("deterministic: same project, same score", async () => {
    await writeTs(
      "src/index.ts",
      ["export const a = 1", "export const b = 2", ""].join("\n"),
    )
    const out1 = await runCompute()
    const out2 = await runCompute()
    expect(TsAb01.score(out1)).toBe(TsAb01.score(out2))
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAb01Config)(TsAb01.defaultConfig)
    expect(decoded.surface_threshold).toBe(50)
    expect(decoded.public_export_globs.length).toBeGreaterThan(0)
  })
})
