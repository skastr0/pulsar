import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Schema } from "effect"
import {
  TsAd02,
  TsAd02Config,
  type TsAd02Output,
} from "../signals/ts-ad-02-circular-deps.js"
import { TsProjectLayer } from "../ts-project.js"

let repo: string

const writeTs = async (relPath: string, content: string): Promise<string> => {
  const full = join(repo, relPath)
  await mkdir(join(full, ".."), { recursive: true })
  await writeFile(full, content)
  return full
}

const runCompute = async (config = TsAd02.defaultConfig): Promise<TsAd02Output> => {
  const program = TsAd02.compute(config, new Map()).pipe(
    Effect.provide(TsProjectLayer(repo)),
  )
  return Effect.runPromise(program as Effect.Effect<TsAd02Output, unknown, never>)
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "taste-codec-ts-ad-02-"))
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

describe("TS-AD-02 (circular dependencies)", () => {
  test("no cycles: score is neutral 1", async () => {
    await writeTs("a.ts", "export const a = 1\n")
    await writeTs("b.ts", "import { a } from './a'\nexport const b = a + 1\n")
    const out = await runCompute()
    expect(out.cycleCount).toBe(0)
    expect(out.cycles).toHaveLength(0)
    expect(TsAd02.score(out)).toBe(1)
  })

  test("self-import: flagged as a size-1 cycle", async () => {
    // Self-imports are degenerate but valid — the graph has a self-loop.
    await writeTs(
      "self.ts",
      "import * as me from './self'\nexport const x = (me as any)?.y ?? 1\n",
    )
    const out = await runCompute()
    expect(out.cycleCount).toBe(1)
    expect(out.cycles[0]?.modules).toHaveLength(1)
    expect(TsAd02.score(out)).toBeLessThan(1)
  })

  test("two-node cycle: detected with break edge and architectural span", async () => {
    const aPath = await writeTs("a.ts", "import { b } from './b'\nexport const a = b + 1\n")
    const bPath = await writeTs("b.ts", "import { a } from './a'\nexport const b = a + 1\n")
    const out = await runCompute()
    expect(out.cycleCount).toBe(1)
    expect(out.cycles[0]?.modules).toHaveLength(2)
    expect(out.cycles[0]?.architecturalSpan).toBe(`${aPath}→${bPath}→${aPath}`)
    expect(out.cycles[0]?.minBreakEdge).toBeDefined()
    // Score penalized but not zero for a single small cycle.
    const s = TsAd02.score(out)
    expect(s).toBeLessThan(1)
    expect(s).toBeGreaterThan(0.5)
  })

  test("larger SCC (4 nodes): largestCycleSize reflects it", async () => {
    await writeTs("a.ts", "import { b } from './b'\nexport const a = b + 1\n")
    await writeTs("b.ts", "import { c } from './c'\nexport const b = c + 1\n")
    await writeTs("c.ts", "import { d } from './d'\nexport const c = d + 1\n")
    await writeTs("d.ts", "import { a } from './a'\nexport const d = a + 1\n")
    const out = await runCompute()
    expect(out.cycleCount).toBe(1)
    expect(out.largestCycleSize).toBe(4)
    expect(out.cycles[0]?.modules).toHaveLength(4)
    // Larger cycle should score worse than a 2-node cycle.
    expect(TsAd02.score(out)).toBeLessThan(0.7)
  })

  test("deterministic: same input, same output shape", async () => {
    await writeTs("a.ts", "import { b } from './b'\nexport const a = b + 1\n")
    await writeTs("b.ts", "import { a } from './a'\nexport const b = a + 1\n")
    const outA = await runCompute()
    const outB = await runCompute()
    expect(TsAd02.score(outA)).toBe(TsAd02.score(outB))
    expect(outA.cycleCount).toBe(outB.cycleCount)
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAd02Config)(TsAd02.defaultConfig)
    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.exclude_globs.length).toBeGreaterThan(0)
  })

  test("diagnose lists largest cycles first", async () => {
    // Two independent SCCs of different sizes.
    await writeTs("a.ts", "import { b } from './b'\nexport const a = b + 1\n")
    await writeTs("b.ts", "import { a } from './a'\nexport const b = a + 1\n")
    await writeTs("x.ts", "import { y } from './y'\nexport const x = y + 1\n")
    await writeTs("y.ts", "import { z } from './z'\nexport const y = z + 1\n")
    await writeTs("z.ts", "import { x } from './x'\nexport const z = x + 1\n")
    const out = await runCompute()
    const diags = TsAd02.diagnose(out)
    expect(diags.length).toBeGreaterThan(0)
    // Largest cycle listed first (via output.cycles ordering).
    expect(out.cycles[0]!.modules.length).toBeGreaterThanOrEqual(
      out.cycles[out.cycles.length - 1]!.modules.length,
    )
  })

  test("active taste-allow bypass silences the cycle diagnostic", async () => {
    await writeTs(
      "a.ts",
      [
        "// taste-allow ENG-123 until:2099-01-01 legacy cycle during migration",
        "import { b } from './b'",
        "export const a = b + 1",
        "",
      ].join("\n"),
    )
    await writeTs("b.ts", "import { a } from './a'\nexport const b = a + 1\n")

    const out = await runCompute()
    expect(out.cycleCount).toBe(1)
    expect(TsAd02.diagnose(out)).toEqual([])
  })

  test("expired taste-allow bypass becomes the blocking diagnostic", async () => {
    const aPath = await writeTs(
      "a.ts",
      [
        "// taste-allow ENG-123 until:2000-01-01 remove after refactor",
        "import { b } from './b'",
        "export const a = b + 1",
        "",
      ].join("\n"),
    )
    await writeTs("b.ts", "import { a } from './a'\nexport const b = a + 1\n")

    const out = await runCompute()
    const diagnostics = TsAd02.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.severity).toBe("block")
    expect(diagnostics[0]?.message).toContain("Expired taste-allow ENG-123")
    expect(diagnostics[0]?.location).toEqual({ file: aPath, line: 1 })
  })
})
