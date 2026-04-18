import { describe, expect, test } from "bun:test"
import { buildRegistry, runSignal, summarize } from "@taste-codec/core"
import { Effect } from "effect"
import { TsRp01 } from "../signals/ts-rp-01-hotspots.js"
import type { SharedChurn01Output } from "../signals/shared-churn-01.js"
import type { TsLd01Output } from "../signals/ts-ld-01-complexity.js"

const mockComplexityOut: TsLd01Output = {
  functions: [],
  byFile: new Map([
    ["/repo/a.ts", summarize([5])],
    ["/repo/b.ts", summarize([25])],
    ["/repo/c.ts", summarize([15])],
    ["/repo/d.ts", summarize([30])],
  ]),
  overThresholdCount: 2,
  totalFunctions: 4,
}

// Churn now emits absolute paths — aligned with ts-morph at produce time.
const mockChurnOut: SharedChurn01Output = {
  byFile: new Map([
    ["/repo/a.ts", 10],
    ["/repo/b.ts", 3],
    ["/repo/c.ts", 20],
    ["/repo/d.ts", 25],
  ]),
  windowDays: 90,
  totalCommits: 58,
}

describe("TS-RP-01 (compound)", () => {
  test("combines churn and complexity into ranked hotspots", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    expect(out.totalFilesConsidered).toBe(4)
    expect(out.hotspots[0]?.rank).toBe(1)
    expect(out.hotspots[0]?.hotspotScore).toBeGreaterThanOrEqual(
      out.hotspots[1]?.hotspotScore ?? 0,
    )
  })

  test("classifies quadrants around the median", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    const dHotspot = out.hotspots.find((h) => h.file === "/repo/d.ts")
    expect(dHotspot?.quadrant).toBe("top-right")
  })

  test("empty input history: score is neutral (1)", async () => {
    const inputs = new Map<string, unknown>([
      [
        "TS-LD-01",
        {
          functions: [],
          byFile: new Map(),
          overThresholdCount: 0,
          totalFunctions: 0,
        } satisfies TsLd01Output,
      ],
      [
        "SHARED-CHURN-01",
        {
          byFile: new Map(),
          windowDays: 90,
          totalCommits: 0,
        } satisfies SharedChurn01Output,
      ],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    expect(out.totalFilesConsidered).toBe(0)
    expect(TsRp01.score(out)).toBe(1)
  })

  test("score is deterministic given the same output", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const outA = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    const outB = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    expect(TsRp01.score(outA)).toBe(TsRp01.score(outB))
  })

  test("changing top_n threshold does NOT change raw output", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const a = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    const b = await Effect.runPromise(
      TsRp01.compute({ ...TsRp01.defaultConfig, top_n: 3 }, inputs),
    )
    expect(a.hotspots.length).toBe(b.hotspots.length)
  })

  test("composition via registry: compound sees its inputs after topological sort", async () => {
    const fakeLeaf = {
      ...TsRp01,
      id: "TS-LD-01" as const,
      tier: 1 as const,
      kind: "legibility" as const,
      inputs: [],
      compute: () => Effect.succeed(mockComplexityOut as unknown),
      score: () => 1,
      diagnose: () => [],
    }
    const fakeChurn = {
      ...TsRp01,
      id: "SHARED-CHURN-01" as const,
      tier: 1 as const,
      kind: "legibility" as const,
      inputs: [],
      compute: () => Effect.succeed(mockChurnOut as unknown),
      score: () => 1,
      diagnose: () => [],
    }
    const registry = await Effect.runPromise(
      buildRegistry([fakeLeaf as any, fakeChurn as any, TsRp01 as any]),
    )
    const result = await Effect.runPromise(
      runSignal(registry, "TS-RP-01") as Effect.Effect<any, any, never>,
    )
    expect(result.signalId).toBe("TS-RP-01")
    expect((result.output as any).totalFilesConsidered).toBe(4)
  })
})
