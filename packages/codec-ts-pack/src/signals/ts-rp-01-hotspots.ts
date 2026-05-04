import type { Diagnostic, Signal } from "@taste-codec/core"
import { Effect, Schema } from "effect"
import type { TsLd01Output } from "./ts-ld-01-complexity.js"
import type { SharedChurn01Output } from "./shared-churn-01.js"

export const TsRp01Config = Schema.Struct({
  top_n: Schema.Number,
  min_churn: Schema.Number,
  min_complexity: Schema.Number,
  threshold_softness: Schema.Number,
  peer_percentile_floor: Schema.Number,
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
  readonly diagnosticLimit?: number
  readonly totalFilesConsidered: number
  readonly topRightShare: number
  readonly topRightPressure: number
  readonly medianChurn: number
  readonly medianComplexity: number
  readonly legacyFilesConsidered: number
  readonly legacyTopRightShare: number
  readonly softFilesConsidered: number
  readonly softTopRightShare: number
  readonly softTopRightPressure: number
  readonly stabilizationWeight: number
}

interface HotspotCandidate {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly thresholdWeight: number
}

interface HotspotSummary {
  readonly ranked: ReadonlyArray<Hotspot>
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
 * commit count). The score now uses soft threshold weighting plus a
 * continuous top-right pressure measure so small repos do not collapse
 * into a single threshold-crossing step function.
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
    threshold_softness: 0.5,
    peer_percentile_floor: 0.5,
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
          topRightPressure: 0,
          medianChurn: 0,
          medianComplexity: 0,
          legacyFilesConsidered: 0,
          legacyTopRightShare: 0,
          softFilesConsidered: 0,
          softTopRightShare: 0,
          softTopRightPressure: 0,
          stabilizationWeight: 0,
          diagnosticLimit: config.top_n,
        }
      }

      const files: Array<HotspotCandidate> = []

      for (const [file, summary] of complexity.byFile) {
        const cplx = summary.max
        const c = churn.byFile.get(file) ?? 0
        if (c <= 0) continue
        const thresholdWeight =
          softGate(c, config.min_churn, config.threshold_softness) *
          softGate(cplx, config.min_complexity, config.threshold_softness)
        files.push({ file, churn: c, complexity: cplx, thresholdWeight })
      }

      const legacyEntries = files.filter(
        (entry) =>
          entry.churn >= config.min_churn && entry.complexity >= config.min_complexity,
      )
      const softEntries = files.filter((entry) => entry.thresholdWeight > 0)

      const legacy = summarizeHotspots(legacyEntries, (entry) => entry.churn * entry.complexity)
      const soft = summarizeHotspots(
        softEntries,
        (entry) => entry.churn * entry.complexity * entry.thresholdWeight,
      )
      const softTopRightPressure = computeSoftTopRightPressure(
        softEntries,
        config.min_churn,
        config.min_complexity,
        config.threshold_softness,
        config.peer_percentile_floor,
      )
      const legacyFilesConsidered = legacy.ranked.length
      const softFilesConsidered = soft.ranked.length
      const stabilizationWeight = stabilizationBlendWeight(
        legacyFilesConsidered === 0 ? softFilesConsidered : legacyFilesConsidered,
      )
      const useSoftShape = stabilizationWeight >= 0.5
      const chosen = useSoftShape ? soft : legacy

      return {
        hotspots: chosen.ranked,
        diagnosticLimit: config.top_n,
        totalFilesConsidered: chosen.ranked.length,
        topRightShare: chosen.topRightShare,
        topRightPressure: useSoftShape ? softTopRightPressure : 0,
        medianChurn: chosen.medianChurn,
        medianComplexity: chosen.medianComplexity,
        legacyFilesConsidered,
        legacyTopRightShare: legacy.topRightShare,
        softFilesConsidered,
        softTopRightShare: soft.topRightShare,
        softTopRightPressure,
        stabilizationWeight,
      }
    }),
  score: (out) => {
    if (out.legacyFilesConsidered === 0 && out.softFilesConsidered === 0) return 1
    const legacyScore =
      out.legacyFilesConsidered === 0
        ? 1
        : Math.max(0, 1 - out.legacyTopRightShare * 1.5)
    const stabilizedScore =
      out.softFilesConsidered === 0
        ? legacyScore
        : Math.max(0, 1 - Math.min(1, out.softTopRightShare + out.softTopRightPressure * 2))
    return (
      legacyScore * (1 - out.stabilizationWeight) +
      stabilizedScore * out.stabilizationWeight
    )
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const top = out.hotspots
      .slice(0, out.diagnosticLimit ?? 10)
      .sort(compareDiagnosticHotspots)
    return top.map((h, index) => ({
      severity: h.quadrant === "top-right" ? ("warn" as const) : ("info" as const),
      message:
        `Hotspot #${index + 1}: ${formatHotspotPath(h.file)} ` +
        `(churn=${h.churn}, complexity=${h.complexity.toFixed(1)}, ${h.quadrant})`,
      location: { file: h.file },
      data: {
        churn: h.churn,
        complexity: h.complexity,
        hotspotScore: h.hotspotScore,
        quadrant: h.quadrant,
        rank: h.rank,
        diagnosticRank: index + 1,
        displayFile: formatHotspotPath(h.file),
      },
    }))
  },
}

const HOTSPOT_PATH_MARKERS = [
  "/packages/",
  "/extensions/",
  "/apps/",
  "/src/",
  "/ui/",
  "/server/",
  "/cli/",
] as const

const formatHotspotPath = (file: string): string => {
  for (const marker of HOTSPOT_PATH_MARKERS) {
    const index = file.indexOf(marker)
    if (index !== -1) return file.slice(index + 1)
  }
  return file
}

const compareDiagnosticHotspots = (left: Hotspot, right: Hotspot): number => {
  const severityDelta = hotspotSeverityRank(left) - hotspotSeverityRank(right)
  if (severityDelta !== 0) return severityDelta
  return left.rank - right.rank
}

const hotspotSeverityRank = (hotspot: Hotspot): number =>
  hotspot.quadrant === "top-right" ? 0 : 1

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

const softGate = (value: number, minimum: number, softness: number): number => {
  if (minimum <= 0) return value > 0 ? 1 : 0
  const clampedSoftness = Math.max(0, Math.min(0.99, softness))
  const lower = Math.max(0, minimum * (1 - clampedSoftness))
  const upper = Math.max(lower + Number.EPSILON, minimum * (1 + clampedSoftness))
  if (value <= lower) return 0
  if (value >= upper) return 1
  const t = (value - lower) / (upper - lower)
  return t * t * (3 - 2 * t)
}

const percentileRank = (
  value: number,
  values: ReadonlyArray<number>,
): number => {
  if (values.length <= 1) return 1
  const sorted = [...values].sort((a, b) => a - b)
  let lastIndex = 0
  for (let index = 0; index < sorted.length; index += 1) {
    if ((sorted[index] ?? 0) <= value) {
      lastIndex = index
    }
  }
  return lastIndex / (sorted.length - 1)
}

const aboveFloor = (value: number, floor: number): number => {
  const effectiveFloor = Math.max(0, Math.min(0.95, floor))
  if (effectiveFloor >= 1) return 0
  return Math.max(0, Math.min(1, (value - effectiveFloor) / (1 - effectiveFloor)))
}

const normalizeObservedMagnitude = (
  value: number,
  minimum: number,
  softness: number,
): number => {
  const clampedSoftness = Math.max(0, Math.min(0.99, softness))
  const lower = Math.max(0, minimum * (1 - clampedSoftness))
  const upper = Math.max(lower + 1, minimum * 8)
  if (upper <= lower) return 1
  return Math.max(0, Math.min(1, (value - lower) / (upper - lower)))
}

const summarizeHotspots = (
  entries: ReadonlyArray<HotspotCandidate>,
  hotspotScoreFor: (entry: HotspotCandidate) => number,
): HotspotSummary => {
  if (entries.length === 0) {
    return {
      ranked: [],
      topRightShare: 0,
      medianChurn: 0,
      medianComplexity: 0,
    }
  }

  const churnValues = entries.map((entry) => entry.churn)
  const complexityValues = entries.map((entry) => entry.complexity)
  const medianChurn = median(churnValues)
  const medianComplexity = median(complexityValues)
  const scored = entries.map((entry) => ({
    file: entry.file,
    churn: entry.churn,
    complexity: entry.complexity,
    hotspotScore: hotspotScoreFor(entry),
    quadrant: classifyQuadrant(
      entry.churn,
      entry.complexity,
      medianChurn,
      medianComplexity,
    ),
    rank: 0,
  }))

  scored.sort((left, right) => right.hotspotScore - left.hotspotScore)
  const ranked = scored.map((hotspot, index) => ({ ...hotspot, rank: index + 1 }))
  const topRight = ranked.filter((hotspot) => hotspot.quadrant === "top-right").length

  return {
    ranked,
    topRightShare: ranked.length === 0 ? 0 : topRight / ranked.length,
    medianChurn,
    medianComplexity,
  }
}

const computeSoftTopRightPressure = (
  entries: ReadonlyArray<HotspotCandidate>,
  minChurn: number,
  minComplexity: number,
  thresholdSoftness: number,
  peerPercentileFloor: number,
): number => {
  if (entries.length === 0) return 0

  const churnValues = entries.map((entry) => entry.churn)
  const complexityValues = entries.map((entry) => entry.complexity)

  let total = 0
  for (const entry of entries) {
    const churnPercentile = percentileRank(entry.churn, churnValues)
    const complexityPercentile = percentileRank(entry.complexity, complexityValues)
    const churnIntensity = normalizeObservedMagnitude(
      entry.churn,
      minChurn,
      thresholdSoftness,
    )
    const complexityIntensity = normalizeObservedMagnitude(
      entry.complexity,
      minComplexity,
      thresholdSoftness,
    )
    total +=
      entry.thresholdWeight *
      aboveFloor(churnPercentile, peerPercentileFloor) *
      aboveFloor(complexityPercentile, peerPercentileFloor) *
      Math.sqrt(churnIntensity * complexityIntensity)
  }

  return total / entries.length
}

const stabilizationBlendWeight = (consideredFiles: number): number => {
  const fullyStabilizedAt = 6
  const fullyLegacyAt = 12
  if (consideredFiles <= fullyStabilizedAt) return 1
  if (consideredFiles >= fullyLegacyAt) return 0
  return (fullyLegacyAt - consideredFiles) / (fullyLegacyAt - fullyStabilizedAt)
}
