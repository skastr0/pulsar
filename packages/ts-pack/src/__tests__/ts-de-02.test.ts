import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsDe02 } from "../signals/ts-de-02-fan-in-out.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string
type TsDe02Result = Parameters<typeof TsDe02.score>[0]

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const writeJson = async (relPath: string, value: unknown): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, JSON.stringify(value, null, 2))
  return full
}

const writePackage = async (slug: string, name: string): Promise<void> => {
  await writeJson(`packages/${slug}/package.json`, {
    name,
    version: "0.0.0",
    private: true,
  })
  await writeJson(`packages/${slug}/tsconfig.json`, {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
    },
    include: ["src/**/*.ts"],
  })
}

const runCompute = async (config = TsDe02.defaultConfig): Promise<TsDe02Result> => {
  const program = TsDe02.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsDe02Result, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-de-02-"))
  await writeFile(
    join(repo, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
      },
      include: ["**/*.ts", "**/*.tsx"],
    }),
  )
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe("TS-DE-02 (fan-in / fan-out)", () => {
  test("declares identity, no inputs, pack registration, and config factor ledger", async () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-DE-02"),
    )
    const registry = await Effect.runPromise(buildRegistry([TsDe02]))
    const out = await runCompute()
    const factorLedger = registered?.factorLedger?.(out)

    expect(TsDe02).toMatchObject({
      id: "TS-DE-02-fan-in-fan-out",
      title: "Fan-in/fan-out",
      aliases: ["TS-DE-02"],
      tier: 1,
      category: "dependency-entropy",
      kind: "structural",
      cacheVersion: "module-resolution-and-export-type-only-v1",
      inputs: [],
    })
    expect(registered?.id).toBe(TsDe02.id)
    expect(registered?.title).toBe(TsDe02.title)
    expect(registered?.cacheVersion).toContain(TsDe02.cacheVersion)
    expect(registry.byId.get("TS-DE-02")?.id).toBe(TsDe02.id)
    expect(factorLedger?.signalId).toBe(TsDe02.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.exclude_globs",
        source: "signal-default",
        scoreRole: "metadata",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.hub_fan_in_threshold",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.hub_fan_out_threshold",
        value: 5,
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

  test("empty project: neutral score 1", async () => {
    const out = await runCompute()
    expect(out.totalModules).toBe(0)
    expect(out.hubs).toHaveLength(0)
    expect(out.diagnosticLimit).toBe(10)
    expect(TsDe02.outputMetadata?.(out)).toBeUndefined()
    expect(TsDe02.inputs).toEqual([])
    expect(TsDe02.score(out)).toBe(1)
  })

  test("simple two-file chain: fan counts are symmetric", async () => {
    const a = await writeTs("a.ts", "export const a = 1\n")
    const b = await writeTs("b.ts", "import { a } from './a'\nexport const b = a + 1\n")
    const out = await runCompute()
    expect(out.byModule.get(a)?.fanOut).toBe(0)
    expect(out.byModule.get(a)?.fanIn).toBe(1)
    expect(out.byModule.get(b)?.fanOut).toBe(1)
    expect(out.byModule.get(b)?.fanIn).toBe(0)
    expect(out.hubs).toHaveLength(0)
    expect(TsDe02.score(out)).toBe(1)
  })

  test("type-only imports and exports do not count as fan edges", async () => {
    const types = await writeTs("types.ts", "export interface User { readonly id: string }\n")
    const consumer = await writeTs(
      "consumer.ts",
      "import { User } from './types'\nexport interface View { readonly user: User }\n",
    )
    const barrel = await writeTs(
      "barrel.ts",
      "export type { User } from './types'\nexport const runtime = 1\n",
    )
    const implicitBarrel = await writeTs(
      "implicit-barrel.ts",
      "export { User } from './types'\nexport const runtime = 1\n",
    )

    const out = await runCompute()
    expect(out.byModule.get(types)?.fanIn).toBe(0)
    expect(out.byModule.get(consumer)?.fanOut).toBe(0)
    expect(out.byModule.get(barrel)?.fanOut).toBe(0)
    expect(out.byModule.get(implicitBarrel)?.fanOut).toBe(0)
  })

  test("runtime export declarations count as fan-out and fan-in edges", async () => {
    const target = await writeTs("target.ts", "export const value = 1\n")
    const barrel = await writeTs("barrel.ts", "export { value } from './target'\n")

    const out = await runCompute()

    expect(out.byModule.get(barrel)?.fanOut).toBe(1)
    expect(out.byModule.get(target)?.fanIn).toBe(1)
  })

  test("package-local source aliases count as fan-out and fan-in edges", async () => {
    await writePackage("app", "@repo/app")
    const target = await writeTs("packages/app/src/target.ts", "export const value = 1\n")
    const consumer = await writeTs(
      "packages/app/src/consumer.ts",
      "import { value } from '@/target'\nexport const consumed = value\n",
    )

    const out = await runCompute()

    expect(out.byModule.get(consumer)?.fanOut).toBe(1)
    expect(out.byModule.get(target)?.fanIn).toBe(1)
  })

  test("workspace package-name imports count as fan-out and fan-in edges", async () => {
    await writePackage("app", "@repo/app")
    await writePackage("core", "@repo/core")
    const core = await writeTs("packages/core/src/index.ts", "export const core = 1\n")
    const app = await writeTs(
      "packages/app/src/index.ts",
      "import { core } from '@repo/core'\nexport const app = core\n",
    )

    const out = await runCompute()

    expect(out.byModule.get(app)?.fanOut).toBe(1)
    expect(out.byModule.get(core)?.fanIn).toBe(1)
  })

  test("hub detection: file above both thresholds is flagged", async () => {
    // One hub imported by many, importing several.
    const hub = await writeTs("hub.ts", [
      "import { a } from './a'",
      "import { b } from './b'",
      "import { c } from './c'",
      "import { d } from './d'",
      "import { e } from './e'",
      "export const h = a + b + c + d + e",
      "",
    ].join("\n"))
    await writeTs("a.ts", "export const a = 1\n")
    await writeTs("b.ts", "export const b = 1\n")
    await writeTs("c.ts", "export const c = 1\n")
    await writeTs("d.ts", "export const d = 1\n")
    await writeTs("e.ts", "export const e = 1\n")
    // Many consumers of the hub.
    for (let i = 0; i < 10; i += 1) {
      await writeTs(
        `consumer${i}.ts`,
        `import { h } from './hub'\nexport const k${i} = h + ${i}\n`,
      )
    }

    const out = await runCompute()
    const hubEntry = out.byModule.get(hub)
    expect(hubEntry?.fanIn).toBe(10)
    expect(hubEntry?.fanOut).toBe(5)
    expect(out.hubs.some((h) => h.file === hub)).toBe(true)
    expect(TsDe02.score(out)).toBeCloseTo(0.8125)
  })

  test("configurable thresholds: lowering them flags more", async () => {
    await writeTs("hub.ts", [
      "import { a } from './a'",
      "import { b } from './b'",
      "export const h = a + b",
      "",
    ].join("\n"))
    await writeTs("a.ts", "export const a = 1\n")
    await writeTs("b.ts", "export const b = 1\n")
    await writeTs("c.ts", "import { h } from './hub'\nexport const c = h\n")
    await writeTs("d.ts", "import { h } from './hub'\nexport const d = h\n")

    const defaultOut = await runCompute()
    expect(defaultOut.hubs).toHaveLength(0) // nothing meets defaults

    const permissiveOut = await runCompute({
      ...TsDe02.defaultConfig,
      hub_fan_in_threshold: 2,
      hub_fan_out_threshold: 2,
    })
    expect(permissiveOut.hubs.length).toBeGreaterThan(0)
  })

  test("diagnostics include stable hub ordering and data", async () => {
    const hubs = await writeMultipleHubFixture()

    const out = await runCompute({
      ...TsDe02.defaultConfig,
      hub_fan_in_threshold: 2,
      hub_fan_out_threshold: 2,
    })
    const diagnostics = TsDe02.diagnose(out)

    expect(out.hubs.map((hub) => hub.file)).toEqual(hubs)
    expect(TsDe02.score(out)).toBeCloseTo(1 - (3 / 11) * 3)
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("fanIn=2, fanOut=2"),
      location: { file: hubs[0] },
      data: {
        file: hubs[0],
        fanIn: 2,
        fanOut: 2,
      },
    })
  })

  test("diagnostics rank heavier hubs before lexical tie-breaks", async () => {
    const hubs = await writeRankedHubFixture()

    const out = await runCompute({
      ...TsDe02.defaultConfig,
      hub_fan_in_threshold: 2,
      hub_fan_out_threshold: 2,
      top_n_diagnostics: 2,
    })
    const diagnostics = TsDe02.diagnose(out)

    expect(out.hubs.map((hub) => hub.file)).toEqual(hubs)
    expect(diagnostics.map((diagnostic) => diagnostic.location?.file)).toEqual([
      hubs[0],
      hubs[1],
    ])
    expect(diagnostics[0]?.data).toMatchObject({ fanIn: 3, fanOut: 3 })
    expect(diagnostics[1]?.data).toMatchObject({ fanIn: 2, fanOut: 2 })
  })

  test("diagnostics honor top_n_diagnostics as a sanitized total cap", async () => {
    await writeMultipleHubFixture()
    const baseConfig = {
      ...TsDe02.defaultConfig,
      hub_fan_in_threshold: 2,
      hub_fan_out_threshold: 2,
    }

    const fractional = await runCompute({
      ...baseConfig,
      top_n_diagnostics: 1.8,
    })
    const negative = await runCompute({
      ...baseConfig,
      top_n_diagnostics: -1,
    })
    const nanLimit = await runCompute({
      ...baseConfig,
      top_n_diagnostics: Number.NaN,
    })
    const infiniteLimit = await runCompute({
      ...baseConfig,
      top_n_diagnostics: Infinity,
    })

    expect(fractional.hubs).toHaveLength(3)
    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsDe02.diagnose(fractional)).toHaveLength(1)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsDe02.diagnose(negative)).toEqual([])
    expect(nanLimit.diagnosticLimit).toBe(0)
    expect(TsDe02.diagnose(nanLimit)).toEqual([])
    expect(infiniteLimit.diagnosticLimit).toBe(0)
    expect(TsDe02.diagnose(infiniteLimit)).toEqual([])
  })

  test("default exclusions ignore TS and TSX test files", async () => {
    const helper = await writeTs("helper.ts", "export const helper = 1\n")
    const testFiles = await Promise.all(
      [
        "component.test.ts",
        "component.spec.ts",
        "component.test.tsx",
        "component.spec.tsx",
      ].map((path) =>
        writeTs(
          path,
          "import { helper } from './helper'\nexport const value = helper\n",
        )
      ),
    )

    const out = await runCompute()

    expect(out.totalModules).toBe(1)
    expect(out.byModule.has(helper)).toBe(true)
    for (const testFile of testFiles) {
      expect(out.byModule.has(testFile)).toBe(false)
    }
    expect(out.byModule.get(helper)?.fanIn).toBe(0)
  })

  test("configured exclude_globs remove custom files from the analyzed module set", async () => {
    const helper = await writeTs("helper.ts", "export const helper = 1\n")
    const ignored = await writeTs(
      "ignored.ts",
      "import { helper } from './helper'\nexport const value = helper\n",
    )

    const out = await runCompute({
      ...TsDe02.defaultConfig,
      exclude_globs: [...TsDe02.defaultConfig.exclude_globs, "**/ignored.ts"],
    })

    expect(out.totalModules).toBe(1)
    expect(out.byModule.has(helper)).toBe(true)
    expect(out.byModule.has(ignored)).toBe(false)
    expect(out.byModule.get(helper)?.fanIn).toBe(0)
  })

  test("deterministic: same input, same score", async () => {
    await writeTs("a.ts", "export const a = 1\n")
    await writeTs("b.ts", "import { a } from './a'\nexport const b = a\n")
    const out1 = await runCompute()
    const out2 = await runCompute()
    expect(TsDe02.score(out1)).toBe(TsDe02.score(out2))
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsDe02.configSchema)(TsDe02.defaultConfig)
    expect(decoded.hub_fan_in_threshold).toBe(10)
    expect(decoded.hub_fan_out_threshold).toBe(5)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs).toContain("**/*.test.ts")
    expect(decoded.exclude_globs).toContain("**/*.spec.ts")
    expect(decoded.exclude_globs).toContain("**/*.test.tsx")
    expect(decoded.exclude_globs).toContain("**/*.spec.tsx")
  })
})

const writeMultipleHubFixture = async (): Promise<Array<string>> => {
  for (const leaf of ["a", "b"]) {
    await writeTs(`${leaf}.ts`, `export const ${leaf} = 1\n`)
  }

  const hubs: Array<string> = []
  for (const hub of ["hub-a", "hub-b", "hub-c"]) {
    hubs.push(await writeTs(
      `${hub}.ts`,
      [
        "import { a } from './a'",
        "import { b } from './b'",
        `export const ${hub.replace("-", "")} = a + b`,
        "",
      ].join("\n"),
    ))
  }

  for (const [index, hub] of ["hub-a", "hub-b", "hub-c"].entries()) {
    await writeTs(
      `consumer-${index}-a.ts`,
      `import { ${hub.replace("-", "")} } from './${hub}'\nexport const value = ${hub.replace("-", "")}\n`,
    )
    await writeTs(
      `consumer-${index}-b.ts`,
      `import { ${hub.replace("-", "")} } from './${hub}'\nexport const value = ${hub.replace("-", "")}\n`,
    )
  }

  return hubs
}

const writeRankedHubFixture = async (): Promise<Array<string>> => {
  for (const leaf of ["a", "b", "c"]) {
    await writeTs(`${leaf}.ts`, `export const ${leaf} = 1\n`)
  }

  const heavier = await writeTs(
    "hub-heavy.ts",
    [
      "import { a } from './a'",
      "import { b } from './b'",
      "import { c } from './c'",
      "export const hubheavy = a + b + c",
      "",
    ].join("\n"),
  )
  const alpha = await writeTs(
    "hub-alpha.ts",
    [
      "import { a } from './a'",
      "import { b } from './b'",
      "export const hubalpha = a + b",
      "",
    ].join("\n"),
  )
  const beta = await writeTs(
    "hub-beta.ts",
    [
      "import { a } from './a'",
      "import { b } from './b'",
      "export const hubbeta = a + b",
      "",
    ].join("\n"),
  )

  for (const [hub, consumers] of [
    ["hub-heavy", 3],
    ["hub-alpha", 2],
    ["hub-beta", 2],
  ] as const) {
    for (let index = 0; index < consumers; index += 1) {
      const binding = hub.replace("-", "")
      await writeTs(
        `${hub}-consumer-${index}.ts`,
        `import { ${binding} } from './${hub}'\nexport const value = ${binding}\n`,
      )
    }
  }

  return [heavier, alpha, beta]
}
