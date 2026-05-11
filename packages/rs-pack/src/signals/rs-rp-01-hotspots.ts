import {
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import type { SharedChurn01Output } from "@skastr0/pulsar-shared-signals"
import { Effect, Schema } from "effect"

const RsRp01Config = Schema.Struct({
  top_n: Schema.Number,
  min_churn: Schema.Number,
  min_complexity: Schema.Number,
})
type RsRp01Config = typeof RsRp01Config.Type

type RustQuadrant = "top-right" | "top-left" | "bottom-right" | "bottom-left"

interface RustHotspot {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly hotspotScore: number
  readonly quadrant: RustQuadrant
  readonly rank: number
}

type RsRp01Output = {
  readonly hotspots: ReadonlyArray<RustHotspot>
  readonly totalFilesConsidered: number
  readonly topRightShare: number
  readonly medianChurn: number
  readonly medianComplexity: number
}

interface ComplexityByFileInput {
  readonly byFile: ReadonlyMap<string, { readonly max: number }>
}

export const RsRp01: Signal<RsRp01Config, RsRp01Output, never> = {
  id: "RS-RP-01-hotspots",
  title: "Hotspots",
  aliases: ["RS-RP-01"],
  tier: 1.5,
  category: "review-pain",
  kind: "compound",
  configSchema: RsRp01Config,
  defaultConfig: {
    top_n: 10,
    min_churn: 2,
    min_complexity: 5,
  },
  inputs: [
    { id: "RS-LD-05-cyclomatic-complexity" },
    { id: "SHARED-CHURN-01-recent-churn" },
  ],
  compute: (config, inputs) =>
    Effect.sync(() => {
      const complexity = (inputs.get("RS-LD-05-cyclomatic-complexity") ??
        inputs.get("RS-LD-05")) as ComplexityByFileInput | undefined
      const churn = (inputs.get("SHARED-CHURN-01-recent-churn") ??
        inputs.get("SHARED-CHURN-01")) as SharedChurn01Output | undefined
      if (complexity === undefined || churn === undefined) {
        return {
          hotspots: [],
          totalFilesConsidered: 0,
          topRightShare: 0,
          medianChurn: 0,
          medianComplexity: 0,
        }
      }

      const files = new Map<string, { churn: number; complexity: number }>()
      for (const [file, summary] of complexity.byFile) {
        const cplx = summary.max
        const fileChurn = churn.byFile.get(file) ?? 0
        if (fileChurn < config.min_churn || cplx < config.min_complexity) continue
        files.set(file, { churn: fileChurn, complexity: cplx })
      }

      const churnValues = [...files.values()].map((entry) => entry.churn)
      const complexityValues = [...files.values()].map((entry) => entry.complexity)
      const medChurn = median(churnValues)
      const medComplexity = median(complexityValues)

      const hotspots = [...files.entries()]
        .map(([file, entry]) => ({
          file,
          churn: entry.churn,
          complexity: entry.complexity,
          hotspotScore: entry.churn * entry.complexity,
          quadrant: classifyQuadrant(entry.churn, entry.complexity, medChurn, medComplexity),
          rank: 0,
        }))
        .sort((left, right) => right.hotspotScore - left.hotspotScore)
        .map((entry, index) => ({ ...entry, rank: index + 1 }))

      const topRightShare =
        hotspots.length === 0
          ? 0
          : hotspots.filter((entry) => entry.quadrant === "top-right").length / hotspots.length

      return {
        hotspots,
        totalFilesConsidered: hotspots.length,
        topRightShare,
        medianChurn: medChurn,
        medianComplexity: medComplexity,
      }
    }),
  score: (out) => {
    if (out.totalFilesConsidered === 0) return 1
    return Math.max(0, 1 - out.topRightShare * 1.5)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.hotspots.slice(0, 10).map((entry) => ({
      severity: entry.quadrant === "top-right" ? ("warn" as const) : ("info" as const),
      message: `Hotspot #${entry.rank}: ${entry.file} (churn=${entry.churn}, complexity=${entry.complexity.toFixed(1)})`,
      location: { file: entry.file },
      data: {
        churn: entry.churn,
        complexity: entry.complexity,
        hotspotScore: entry.hotspotScore,
        quadrant: entry.quadrant,
        rank: entry.rank,
      },
    })),
}

const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

const classifyQuadrant = (
  churn: number,
  complexity: number,
  medianChurn: number,
  medianComplexity: number,
): RustQuadrant => {
  const highChurn = churn > medianChurn
  const highComplexity = complexity > medianComplexity
  if (highChurn && highComplexity) return "top-right"
  if (highChurn) return "top-left"
  if (highComplexity) return "bottom-right"
  return "bottom-left"
}
