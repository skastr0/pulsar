import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import { summarize } from "@taste-codec/core"
import { Effect } from "effect"
import { TsRp01 } from "../signals/ts-rp-01-hotspots.js"
import type { SharedChurn01Output } from "../signals/shared-churn-01.js"
import type { TsLd01Output } from "../signals/ts-ld-01-complexity.js"

/**
 * Regression against the old suffix-match alignment. With duplicated
 * filenames across sub-packages (`packages/a/src/index.ts` and
 * `packages/b/src/index.ts`), the suffix match cross-attributed churn.
 * Churn now emits absolute paths at produce time; TS-RP-01 reads
 * directly without matching, so each file keeps its own churn number.
 */
describe("TS-RP-01 path alignment", () => {
  test("monorepo duplicated filenames do not cross-attribute churn", async () => {
    const worktree = "/repo"
    const aIndex = join(worktree, "packages/a/src/index.ts")
    const bIndex = join(worktree, "packages/b/src/index.ts")

    const complexity: TsLd01Output = {
      functions: [],
      byFile: new Map([
        [aIndex, summarize([5])],
        [bIndex, summarize([30])],
      ]),
      overThresholdCount: 1,
      totalFunctions: 2,
      maxComplexity: 30,
      ratioPressure: 1,
      maxComplexityPressure: 1 / 3,
    }

    const churn: SharedChurn01Output = {
      byFile: new Map([
        [aIndex, 2],
        [bIndex, 25],
      ]),
      windowDays: 90,
      totalCommits: 27,
    }

    const inputs = new Map<string, unknown>([
      ["TS-LD-01", complexity],
      ["SHARED-CHURN-01", churn],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))

    const a = out.hotspots.find((h) => h.file === aIndex)
    const b = out.hotspots.find((h) => h.file === bIndex)
    expect(a?.churn).toBe(2)
    expect(b?.churn).toBe(25)
  })

  test("TS-RP-01 uses per-file max complexity, not avg", async () => {
    const worktree = "/repo"
    const peakFile = join(worktree, "peak.ts")
    const flatFile = join(worktree, "flat.ts")

    // peak.ts: 20 small helpers (avg ~1) AND one complexity-119 function.
    // flat.ts: 20 medium-complexity functions (avg ~5).
    // avg-based would put flat ahead. max-based puts peak ahead.
    const complexity: TsLd01Output = {
      functions: [],
      byFile: new Map([
        [peakFile, summarize([...new Array(20).fill(1), 119])],
        [flatFile, summarize(new Array(20).fill(5))],
      ]),
      overThresholdCount: 1,
      totalFunctions: 41,
      maxComplexity: 119,
      ratioPressure: 2 / 41,
      maxComplexityPressure: 99 / 119,
    }

    const churn: SharedChurn01Output = {
      byFile: new Map([
        [peakFile, 10],
        [flatFile, 10],
      ]),
      windowDays: 90,
      totalCommits: 20,
    }

    const inputs = new Map<string, unknown>([
      ["TS-LD-01", complexity],
      ["SHARED-CHURN-01", churn],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))

    const peak = out.hotspots.find((h) => h.file === peakFile)
    const flat = out.hotspots.find((h) => h.file === flatFile)
    expect(peak?.complexity).toBe(119)
    expect(flat?.complexity).toBe(5)
    expect(peak?.hotspotScore).toBeGreaterThan(flat?.hotspotScore ?? 0)
  })
})
