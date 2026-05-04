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
    expect(TsRp01.diagnose(b)).toHaveLength(3)
  })

  test("soft threshold pressure creates multiple score levels near small-repo cutoffs", async () => {
    const thresholdComplexity: TsLd01Output = {
      functions: [],
      byFile: new Map([
        ["/repo/a.ts", summarize([4])],
        ["/repo/b.ts", summarize([5])],
        ["/repo/c.ts", summarize([6])],
        ["/repo/d.ts", summarize([7])],
      ]),
      overThresholdCount: 2,
      totalFunctions: 4,
    }

    const variants: ReadonlyArray<SharedChurn01Output> = [
      {
        byFile: new Map([
          ["/repo/a.ts", 1],
          ["/repo/b.ts", 1],
          ["/repo/c.ts", 2],
          ["/repo/d.ts", 2],
        ]),
        windowDays: 90,
        totalCommits: 20,
      },
      {
        byFile: new Map([
          ["/repo/a.ts", 1],
          ["/repo/b.ts", 1],
          ["/repo/c.ts", 2],
          ["/repo/d.ts", 3],
        ]),
        windowDays: 90,
        totalCommits: 21,
      },
      {
        byFile: new Map([
          ["/repo/a.ts", 1],
          ["/repo/b.ts", 2],
          ["/repo/c.ts", 3],
          ["/repo/d.ts", 4],
        ]),
        windowDays: 90,
        totalCommits: 22,
      },
    ]

    const scores = await Promise.all(
      variants.map(async (variant) => {
        const out = await Effect.runPromise(
          TsRp01.compute(
            TsRp01.defaultConfig,
            new Map<string, unknown>([
              ["TS-LD-01", thresholdComplexity],
              ["SHARED-CHURN-01", variant],
            ]),
          ),
        )
        return TsRp01.score(out)
      }),
    )

    expect(new Set(scores.map((score) => score.toFixed(6))).size).toBeGreaterThan(2)
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

  test("diagnostic hotspot labels stay contiguous when info hotspots are interleaved", () => {
    const diagnostics = TsRp01.diagnose({
      hotspots: [
        {
          file: "/repo/first.ts",
          churn: 10,
          complexity: 30,
          hotspotScore: 300,
          quadrant: "top-right",
          rank: 1,
        },
        {
          file: "/repo/info.ts",
          churn: 10,
          complexity: 2,
          hotspotScore: 200,
          quadrant: "top-left",
          rank: 2,
        },
        {
          file: "/repo/second.ts",
          churn: 8,
          complexity: 25,
          hotspotScore: 180,
          quadrant: "top-right",
          rank: 3,
        },
      ],
      diagnosticLimit: 3,
      totalFilesConsidered: 3,
      topRightShare: 2 / 3,
      topRightPressure: 0,
      medianChurn: 10,
      medianComplexity: 25,
      legacyFilesConsidered: 3,
      legacyTopRightShare: 2 / 3,
      softFilesConsidered: 3,
      softTopRightShare: 2 / 3,
      softTopRightPressure: 0,
      stabilizationWeight: 0,
    })

    expect(diagnostics.map((diagnostic) => diagnostic.message.split(":")[0])).toEqual([
      "Hotspot #1",
      "Hotspot #2",
      "Hotspot #3",
    ])
    expect(diagnostics.map((diagnostic) => diagnostic.location?.file)).toEqual([
      "/repo/first.ts",
      "/repo/second.ts",
      "/repo/info.ts",
    ])
    expect(diagnostics[1]?.data?.rank).toBe(3)
    expect(diagnostics[1]?.data?.diagnosticRank).toBe(2)
  })
})
