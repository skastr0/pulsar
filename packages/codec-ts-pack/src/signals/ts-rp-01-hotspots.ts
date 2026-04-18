import type { Diagnostic, Signal } from "@taste-codec/core"
import { Effect, Schema } from "effect"
import type { TsLd01Output } from "./ts-ld-01-complexity.js"
import type { SharedChurn01Output } from "./shared-churn-01.js"

export const TsRp01Config = Schema.Struct({
  top_n: Schema.Number,
  min_churn: Schema.Number,
  min_complexity: Schema.Number,
})
export type TsRp01Config = typeof TsRp01Config.Type

export type Quadrant = "top-right" | "top-left" | "bottom-right" | "bottom-left"

export interface Hotspot {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly hotspotScore: number
  readonly quadrant: Quadrant
  readonly rank: number
}

export interface TsRp01Output {
  readonly hotspots: ReadonlyArray<Hotspot>
  readonly totalFilesConsidered: number
  readonly topRightShare: number
  readonly medianChurn: number
  readonly medianComplexity: number
}

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 0) {
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
  }
  return sorted[mid] ?? 0
}

/**
 * TS-RP-01 — churn × complexity hotspots.
 *
 * The best-validated compound metric in the literature. Combines
 * TS-LD-01 (per-file avg complexity) with SHARED-CHURN-01 (per-file
 * commit count). Top-right quadrant (above-median on both axes) is
 * the danger zone.
 */
export const TsRp01: Signal<TsRp01Config, TsRp01Output, never> = {
  id: "TS-RP-01",
  tier: 1.5,
  category: "review-pain",
  kind: "compound",
  configSchema: TsRp01Config,
  defaultConfig: {
    top_n: 10,
    min_churn: 2,
    min_complexity: 5,
  },
  inputs: [{ id: "TS-LD-01" }, { id: "SHARED-CHURN-01" }],
  compute: (config, inputs) =>
    Effect.sync(() => {
      const complexity = inputs.get("TS-LD-01") as TsLd01Output | undefined
      const churn = inputs.get("SHARED-CHURN-01") as SharedChurn01Output | undefined
      if (complexity === undefined || churn === undefined) {
        return {
          hotspots: [],
          totalFilesConsidered: 0,
          topRightShare: 0,
          medianChurn: 0,
          medianComplexity: 0,
        }
      }

      // churn.byFile and complexity.byFile are both keyed by absolute
      // path — no suffix alignment needed. TS-RP-01 uses the per-file
      // max complexity so that a single high-complexity function inside
      // a file of small helpers still surfaces as a hotspot.
      const files = new Map<string, { churn: number; complexity: number }>()
      for (const [file, summary] of complexity.byFile) {
        const cplx = summary.max
        const c = churn.byFile.get(file) ?? 0
        if (c < config.min_churn || cplx < config.min_complexity) continue
        files.set(file, { churn: c, complexity: cplx })
      }

      const churnValues = Array.from(files.values()).map((v) => v.churn)
      const complexityValues = Array.from(files.values()).map((v) => v.complexity)
      const medChurn = median(churnValues)
      const medComplexity = median(complexityValues)

      const scored: Array<Hotspot> = []
      for (const [file, { churn: fc, complexity: fx }] of files) {
        const hotspotScore = fc * fx
        const quadrant: Quadrant = classifyQuadrant(fc, fx, medChurn, medComplexity)
        scored.push({
          file,
          churn: fc,
          complexity: fx,
          hotspotScore,
          quadrant,
          rank: 0,
        })
      }
      scored.sort((a, b) => b.hotspotScore - a.hotspotScore)
      const ranked = scored.map((h, i) => ({ ...h, rank: i + 1 }))

      const topRight = ranked.filter((h) => h.quadrant === "top-right").length
      const topRightShare = ranked.length === 0 ? 0 : topRight / ranked.length

      return {
        hotspots: ranked,
        totalFilesConsidered: ranked.length,
        topRightShare,
        medianChurn: medChurn,
        medianComplexity: medComplexity,
      }
    }),
  score: (out) => {
    if (out.totalFilesConsidered === 0) return 1
    return Math.max(0, 1 - out.topRightShare * 1.5)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const top = out.hotspots.slice(0, 10)
    return top.map((h) => ({
      severity: h.quadrant === "top-right" ? ("warn" as const) : ("info" as const),
      message: `Hotspot #${h.rank}: ${h.file} (churn=${h.churn}, complexity=${h.complexity.toFixed(1)}, ${h.quadrant})`,
      location: { file: h.file },
      data: {
        churn: h.churn,
        complexity: h.complexity,
        hotspotScore: h.hotspotScore,
        quadrant: h.quadrant,
        rank: h.rank,
      },
    }))
  },
}

const classifyQuadrant = (
  churn: number,
  complexity: number,
  medChurn: number,
  medComplexity: number,
): Quadrant => {
  const highChurn = churn > medChurn
  const highComplexity = complexity > medComplexity
  if (highChurn && highComplexity) return "top-right"
  if (highChurn && !highComplexity) return "top-left"
  if (!highChurn && highComplexity) return "bottom-right"
  return "bottom-left"
}
