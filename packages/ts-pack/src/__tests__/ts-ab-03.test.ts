import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { TS_PACK_SIGNALS } from "../pack.js"
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
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const packRegistered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-AB-03"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("TS-AB-03")
    const out = await runCompute()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsAb03).toMatchObject({
      id: "TS-AB-03-type-indirection-depth",
      title: "Type indirection depth",
      aliases: ["TS-AB-03"],
      tier: 1,
      category: "abstraction-bloat",
      kind: "legibility",
      cacheVersion: "type-indirection-depth-v2-diagnostic-limit-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsAb03.id)
    expect(registered?.title).toBe(TsAb03.title)
    expect(registered?.cacheVersion).toContain(TsAb03.cacheVersion)
    expect(registry.byId.get("TS-AB-03")?.id).toBe(TsAb03.id)
    expect(factorLedger?.signalId).toBe(TsAb03.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_depth",
        value: 4,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.max_traversal_steps",
        value: 16,
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

  test("no tracked declarations: empty output, score 1, and no diagnostics", async () => {
    await writeTs("src/value.ts", "export const value = 1\n")

    const out = await runCompute()

    expect(out.declarations).toEqual([])
    expect(out.byFile.size).toBe(0)
    expect(out.repoDistribution).toEqual({ max: 0, p95: 0, avg: 0, sum: 0, count: 0 })
    expect(out.overThreshold).toEqual([])
    expect(out.maxDepth).toBe(4)
    expect(out.traversalCap).toBe(16)
    expect(out.diagnosticLimit).toBe(10)
    expect(TsAb03.score(out)).toBe(1)
    expect(TsAb03.diagnose(out)).toEqual([])
  })

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

  test("indexed, import, typeof, and utility type layers are explicit", async () => {
    await writeTs(
      "src/type-syntax.ts",
      [
        "const runtime = { value: 'ok' }",
        "type Local = { readonly value: string }",
        "export type Indexed = Local['value']",
        "export type Imported = import('node:fs').PathLike",
        "export type RuntimeShape = typeof runtime",
        "export type Utility = Partial<Local>",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byName = new Map(out.declarations.map((entry) => [entry.name, entry]))

    expect(byName.get("Indexed")?.chain).toContain("<indexed-access>")
    expect(byName.get("Imported")?.chain).toEqual(["Imported", "<import-type>"])
    expect(byName.get("RuntimeShape")?.chain).toEqual(["RuntimeShape", "<typeof runtime>"])
    expect(byName.get("Utility")?.chain).toContain("Partial")
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

  test("exported interface heritage contributes alias indirection", async () => {
    await writeTs(
      "src/heritage.ts",
      [
        "type Entity = { readonly id: string }",
        "type Resource = Entity",
        "export interface PublicResource extends Resource { readonly name: string }",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byName = new Map(out.declarations.map((entry) => [entry.name, entry]))

    expect(byName.get("PublicResource")?.exported).toBe(true)
    expect(byName.get("PublicResource")?.depth).toBe(2)
    expect(byName.get("PublicResource")?.chain).toEqual(["Resource", "Entity"])
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

  test("alias cache does not reuse truncated inner traversals for later declarations", async () => {
    await writeTs(
      "src/cache-context.ts",
      [
        "type A = B",
        "type B = C",
        "type C = D",
        "type D = E",
        "type E = string",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsAb03.defaultConfig,
      max_traversal_steps: 8,
    })
    const byName = new Map(out.declarations.map((entry) => [entry.name, entry]))

    expect(byName.get("A")?.truncated).toBe(true)
    expect(byName.get("B")?.truncated).toBe(false)
    expect(byName.get("B")?.depth).toBe(4)
    expect(byName.get("B")?.chain).toEqual(["B", "C", "D", "E"])
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

  test("score uses over-threshold share across tracked declarations", async () => {
    await writeTs(
      "src/score.ts",
      [
        "type A = string",
        "export type B = A",
        "export type C = B",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
    })

    expect(out.declarations.map((entry) => entry.name).sort()).toEqual(["A", "B", "C"])
    expect(out.overThreshold.map((entry) => entry.name).sort()).toEqual(["B", "C"])
    expect(TsAb03.score(out)).toBeCloseTo(1 - 2 / 3)
  })

  test("diagnostics are ordered by depth and include payload data", async () => {
    const file = await writeTs(
      "src/diagnostic-payload.ts",
      [
        "type A = string",
        "export type B = A",
        "export type C = B",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
    })
    const diagnostics = TsAb03.diagnose(out)

    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("C"),
      location: { file, line: 3 },
      data: {
        file,
        name: "C",
        line: 3,
        depth: 3,
        exported: true,
        chain: ["C", "B", "A"],
        cycle: false,
        truncated: false,
        maxDepth: 1,
        traversalCap: 16,
      },
    })
    expect(diagnostics[1]?.data?.name).toBe("B")
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

  test("excluded generated and test declarations are not analyzed", async () => {
    await writeTs("src/production.ts", "export type Production = string\n")
    await writeTs("src/generated/client.ts", "export type Generated = Production\n")
    await writeTs("src/api.test.ts", "export type TestOnly = Production\n")

    const out = await runCompute()
    const names = out.declarations.map((entry) => entry.name)

    expect(names).toContain("Production")
    expect(names).not.toContain("Generated")
    expect(names).not.toContain("TestOnly")
  })

  test("deterministic: same project, same output, diagnostics, and score", async () => {
    await writeTs(
      "src/deterministic.ts",
      [
        "type A = string",
        "export type B = A",
        "export type C = B",
        "",
      ].join("\n"),
    )

    const out1 = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
    })
    const out2 = await runCompute({
      ...TsAb03.defaultConfig,
      max_depth: 1,
    })

    expect(projectOutput(out2)).toEqual(projectOutput(out1))
    expect(TsAb03.diagnose(out2)).toEqual(TsAb03.diagnose(out1))
    expect(TsAb03.score(out2)).toBe(TsAb03.score(out1))
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAb03.configSchema)(TsAb03.defaultConfig)
    expect(decoded.exclude_globs).toContain("**/node_modules/**")
    expect(decoded.max_depth).toBe(4)
    expect(decoded.max_traversal_steps).toBe(16)
    expect(decoded.top_n_diagnostics).toBe(10)
  })
})

const projectOutput = (out: TsAb03Result): unknown => ({
  declarations: out.declarations,
  byFile: [...out.byFile.entries()],
  repoDistribution: out.repoDistribution,
  overThreshold: out.overThreshold,
  maxDepth: out.maxDepth,
  traversalCap: out.traversalCap,
  diagnosticLimit: out.diagnosticLimit,
})
