import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
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
      include: ["**/*.ts"],
    }),
  )
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

describe("TS-DE-02 (fan-in / fan-out)", () => {
  test("empty project: neutral score 1", async () => {
    const out = await runCompute()
    expect(out.totalModules).toBe(0)
    expect(out.hubs).toHaveLength(0)
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

    const out = await runCompute()
    expect(out.byModule.get(types)?.fanIn).toBe(0)
    expect(out.byModule.get(consumer)?.fanOut).toBe(0)
    expect(out.byModule.get(barrel)?.fanOut).toBe(0)
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
    expect(hubEntry?.fanIn).toBeGreaterThanOrEqual(10)
    expect(hubEntry?.fanOut).toBeGreaterThanOrEqual(5)
    expect(out.hubs.some((h) => h.file === hub)).toBe(true)
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
  })
})
