import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import {
  TsLd08,
  type TsLd08Output,
} from "../signals/ts-ld-08-exhaustiveness-erosion.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "pulsar-ts-ld-08-"))
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
    "utf8",
  )
})

afterEach(async () => {
  await rm(repo, { recursive: true, force: true })
})

const writeTs = async (path: string, content: string): Promise<void> => {
  const fullPath = join(repo, path)
  await mkdir(join(fullPath, ".."), { recursive: true })
  await writeFile(fullPath, content, "utf8")
}

const runSignal = async (config = TsLd08.defaultConfig): Promise<TsLd08Output> =>
  Effect.runPromise(
    TsLd08.compute(config, new Map()).pipe(
      Effect.provide(TsProjectLayer(repo)),
    ) as Effect.Effect<TsLd08Output, unknown, never>,
  )

describe("TS-LD-08 exhaustiveness erosion", () => {
  test("flags multi-case switches with default catch-alls", async () => {
    await writeTs(
      "src/domain.ts",
      [
        "type Status = 'ready' | 'blocked' | 'done'",
        "export function label(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "    default: return 'Other'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal()
    expect(out.analyzedSwitches).toBe(1)
    expect(out.findings).toHaveLength(1)
    expect(out.findings[0]).toEqual(
      expect.objectContaining({
        expression: "status",
        caseCount: 2,
      }),
    )
    expect(TsLd08.score(out)).toBeLessThan(1)
  })

  test("does not flag complete switches without a default", async () => {
    await writeTs(
      "src/domain.ts",
      [
        "type Status = 'ready' | 'blocked'",
        "export function label(status: Status): string {",
        "  switch (status) {",
        "    case 'ready': return 'Ready'",
        "    case 'blocked': return 'Blocked'",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal()
    expect(out.analyzedSwitches).toBe(1)
    expect(out.findings).toEqual([])
    expect(TsLd08.score(out)).toBe(1)
  })

  test("respects the minimum case threshold", async () => {
    await writeTs(
      "src/small.ts",
      [
        "export function value(input: string): number {",
        "  switch (input) {",
        "    case 'a': return 1",
        "    default: return 0",
        "  }",
        "}",
      ].join("\n"),
    )

    const out = await runSignal()
    expect(out.findings).toEqual([])
  })
})
