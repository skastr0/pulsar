import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAb01 } from "../signals/ts-ab-01-public-export-surface.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string
type TsAb01Result = Parameters<typeof TsAb01.score>[0]

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsAb01.defaultConfig): Promise<TsAb01Result> => {
  const program = TsAb01.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsAb01Result, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-ab-01-"))
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
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-AB-01"),
    )
    const registry = await Effect.runPromise(buildRegistry([TsAb01]))
    const out = await runCompute()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsAb01).toMatchObject({
      id: "TS-AB-01-public-export-surface",
      title: "Public export surface",
      aliases: ["TS-AB-01"],
      tier: 1,
      category: "abstraction-bloat",
      kind: "legibility",
      cacheVersion: "diagnostic-limit-weighted-surface-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsAb01.id)
    expect(registered?.title).toBe(TsAb01.title)
    expect(registered?.cacheVersion).toContain(TsAb01.cacheVersion)
    expect(registry.byId.get("TS-AB-01")?.id).toBe(TsAb01.id)
    expect(factorLedger?.signalId).toBe(TsAb01.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.public_export_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.surface_threshold",
        value: 50,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 5,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("no barrel files: empty output, score 1", async () => {
    await writeTs("src/helper.ts", "export const h = 1\n")
    const out = await runCompute()
    expect(out.byFile.size).toBe(0)
    expect(out.totalPublicExports).toBe(0)
    expect(out.largestSurface).toBeUndefined()
    expect(out.diagnosticLimit).toBe(5)
    expect(TsAb01.inputs).toEqual([])
    expect(TsAb01.score(out)).toBe(1)
    expect(TsAb01.diagnose(out)).toEqual([])
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
    expect(surface!.weightedTotal).toBe(3.5)
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

  test("type-only exports carry less score pressure than runtime exports", async () => {
    const lines = [
      ...Array.from({ length: 80 }, (_, i) => `export interface Type${i} { value: ${i} }`),
      ...Array.from({ length: 10 }, (_, i) => `export const runtime${i} = ${i}`),
    ]
    const idx = await writeTs("src/index.ts", lines.join("\n") + "\n")

    const out = await runCompute()
    const surface = out.byFile.get(idx)

    expect(surface?.total).toBe(90)
    expect(surface?.weightedTotal).toBe(30)
    expect(TsAb01.score(out)).toBe(1)
  })

  test("score and diagnostics use the worst weighted surface, not the largest raw count", async () => {
    await writeTs(
      "packages/types/src/index.ts",
      Array.from({ length: 120 }, (_, i) => `export interface Type${i} { value: ${i} }`).join("\n") +
        "\n",
    )
    const runtimeFile = await writeTs(
      "packages/runtime/src/index.ts",
      Array.from({ length: 80 }, (_, i) => `export const runtime${i} = ${i}`).join("\n") +
        "\n",
    )

    const out = await runCompute()
    const diagnostics = TsAb01.diagnose(out)

    expect(out.totalPublicExports).toBe(200)
    expect(out.largestSurface?.total).toBe(120)
    expect(out.byFile.get(runtimeFile)?.weightedTotal).toBe(80)
    expect(TsAb01.score(out)).toBeLessThan(1)
    expect(diagnostics[0]?.location?.file).toBe(runtimeFile)
    expect(diagnostics[0]?.severity).toBe("warn")
    expect(diagnostics[0]?.data).toMatchObject({
      file: runtimeFile,
      total: 80,
      weightedTotal: 80,
      byKind: { const: 80 },
    })
  })

  test("diagnostics use raw count as a tie-break after weighted pressure", async () => {
    const runtimeFile = await writeTs(
      "packages/runtime/src/index.ts",
      Array.from({ length: 4 }, (_, i) => `export const runtime${i} = ${i}`).join("\n") +
        "\n",
    )
    const mixedFile = await writeTs(
      "packages/mixed/src/index.ts",
      [
        ...Array.from({ length: 2 }, (_, i) => `export const mixed${i} = ${i}`),
        ...Array.from({ length: 8 }, (_, i) => `export interface MixedType${i} { value: ${i} }`),
      ].join("\n") + "\n",
    )

    const out = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 1,
    })
    const diagnostics = TsAb01.diagnose(out)

    expect(out.byFile.get(runtimeFile)?.weightedTotal).toBe(4)
    expect(out.byFile.get(mixedFile)?.weightedTotal).toBe(4)
    expect(out.byFile.get(mixedFile)?.total).toBeGreaterThan(out.byFile.get(runtimeFile)?.total ?? 0)
    expect(diagnostics[0]?.location?.file).toBe(mixedFile)
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
    expect(surface?.sourceFileCount).toBe(1)
    expect(surface?.topSources[0]?.file).toContain("src/lib.ts")
    expect(surface?.topSources[0]?.count).toBe(2)
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

  test("default public export globs include package root index files", async () => {
    const idx = await writeTs(
      "packages/runtime/index.ts",
      "export const publicRoot = true\n",
    )

    const out = await runCompute()

    expect(out.byFile.get(idx)?.total).toBe(1)
    expect(out.totalPublicExports).toBe(1)
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

  test("excludes docs and prototype barrels from production public surface", async () => {
    await writeTs("docs/explorations/prototypes/example/src/index.ts", "export const prototype = true\n")
    const out = await runCompute()
    expect(out.byFile.size).toBe(0)
    expect(TsAb01.score(out)).toBe(1)
  })

  test("diagnostics explain runtime, type-only, weighted, and module surface", async () => {
    await writeTs("src/runtime.ts", "export const runtime = true\n")
    await writeTs("src/types.ts", "export interface Shape { value: string }\n")
    await writeTs("src/index.ts", "export * from './runtime'\nexport * from './types'\n")

    const out = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 1,
    })
    const diagnostic = TsAb01.diagnose(out)[0]

    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.message).toContain("2 symbols")
    expect(diagnostic?.message).toContain("weighted 1.3")
    expect(diagnostic?.message).toContain("1 runtime")
    expect(diagnostic?.message).toContain("1 type-only")
    expect(diagnostic?.message).toContain("2 source modules")
  })

  test("diagnostics honor sanitized top_n_diagnostics", async () => {
    for (const name of ["alpha", "beta", "gamma"]) {
      await writeTs(
        `packages/${name}/src/index.ts`,
        Array.from({ length: 4 }, (_, i) => `export const ${name}${i} = ${i}`).join("\n") +
          "\n",
      )
    }

    const capped = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 1,
      top_n_diagnostics: 1.8,
    })
    expect(capped.diagnosticLimit).toBe(1)
    expect(TsAb01.diagnose(capped)).toHaveLength(1)

    const negative = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 1,
      top_n_diagnostics: -1,
    })
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsAb01.diagnose(negative)).toEqual([])

    const nan = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 1,
      top_n_diagnostics: Number.NaN,
    })
    expect(nan.diagnosticLimit).toBe(0)
    expect(TsAb01.diagnose(nan)).toEqual([])

    const infinite = await runCompute({
      ...TsAb01.defaultConfig,
      surface_threshold: 1,
      top_n_diagnostics: Number.POSITIVE_INFINITY,
    })
    expect(infinite.diagnosticLimit).toBe(0)
    expect(TsAb01.diagnose(infinite)).toEqual([])
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAb01.configSchema)(TsAb01.defaultConfig)
    expect(decoded.public_export_globs).toContain("**/src/index.ts")
    expect(decoded.exclude_globs).toContain("**/node_modules/**")
    expect(decoded.surface_threshold).toBe(50)
    expect(decoded.top_n_diagnostics).toBe(5)
  })
})
