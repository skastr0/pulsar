import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  TsDe01,
  TsDe01Config,
  type TsDe01Output,
} from "../signals/ts-de-01-type-level-coupling.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsDe01.defaultConfig): Promise<TsDe01Output> => {
  const program = TsDe01.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsDe01Output, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "taste-codec-ts-de-01-"))
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

describe("TS-DE-01 (type-level coupling)", () => {
  test("empty project: neutral score 1", async () => {
    const out = await runCompute()
    expect(out.totalModules).toBe(0)
    expect(out.modules).toEqual([])
    expect(TsDe01.score(out)).toBe(1)
  })

  test("counts outgoing and incoming type references per module", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const b = await writeTs(
      "src/b.ts",
      [
        "import type { A } from './a'",
        "export type B = A | A",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const byFile = new Map(out.modules.map((module) => [module.file, module]))

    expect(byFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(byFile.get(b)?.typesReferencedExternally).toBe(0)
    expect(byFile.get(a)?.externalTypesReferenced).toBe(0)
    expect(byFile.get(a)?.typesReferencedExternally).toBe(1)
  })

  test("large-project fast path counts imported type references syntactically", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    const b = await writeTs(
      "src/b.ts",
      [
        "import type { A } from './a'",
        "export type B = A",
        "",
      ].join("\n"),
    )

    const out = await runCompute({
      ...TsDe01.defaultConfig,
      precise_module_limit: 1,
    })
    const byFile = new Map(out.modules.map((module) => [module.file, module]))

    expect(byFile.get(b)?.externalTypesReferenced).toBe(1)
    expect(byFile.get(a)?.typesReferencedExternally).toBe(1)
  })

  test("re-exported imports resolve to the original type-defining module", async () => {
    const a = await writeTs("src/a.ts", "export interface A { value: string }\n")
    await writeTs("src/index.ts", "export type { A } from './a'\n")
    const consumer = await writeTs(
      "src/consumer.ts",
      [
        "import type { A } from './index'",
        "export type Consumer = A",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const consumerEntry = out.modules.find((module) => module.file === consumer)
    expect(consumerEntry?.counterparts).toEqual([
      {
        module: a,
        outgoingTypes: 1,
        incomingTypes: 0,
        totalTypes: 1,
      },
    ])
  })

  test("diagnostics surface counterpart data for the most coupled module", async () => {
    for (const file of ["a", "b", "c", "d", "e"]) {
      await writeTs(`src/${file}.ts`, `export interface ${file.toUpperCase()} {}\n`)
    }
    for (const file of ["one", "two", "three", "four"]) {
      await writeTs(`src/${file}.ts`, "export const value = 1\n")
    }
    await writeTs(
      "src/hub.ts",
      [
        "import type { A } from './a'",
        "import type { B } from './b'",
        "import type { C } from './c'",
        "import type { D } from './d'",
        "import type { E } from './e'",
        "export type Hub = A & B & C & D & E",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    const diagnostics = TsDe01.diagnose(out)
    expect(diagnostics.length).toBeGreaterThan(0)
    expect(diagnostics[0]?.data).toMatchObject({
      externalTypesReferenced: 5,
    })
  })

  test("does not diagnose ordinary coupling when the score remains perfect", async () => {
    await writeTs("src/a.ts", "export interface A { value: string }\n")
    await writeTs(
      "src/b.ts",
      [
        "import type { A } from './a'",
        "export type B = A",
        "",
      ].join("\n"),
    )

    const out = await runCompute()
    expect(TsDe01.score(out)).toBe(1)
    expect(TsDe01.diagnose(out)).toEqual([])
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsDe01Config)(TsDe01.defaultConfig)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
  })
})
