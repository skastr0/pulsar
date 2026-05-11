import type { SharedChurn01Output } from "./shared-churn-01.js"
import type { TsLd01Output } from "./ts-ld-01-complexity.js"

export interface HotspotConfig {
  readonly top_n: number
  readonly min_churn: number
  readonly min_complexity: number
  readonly threshold_softness: number
  readonly peer_percentile_floor: number
}

export type Quadrant = "top-right" | "top-left" | "bottom-right" | "bottom-left"

export interface Hotspot {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly hotspotScore: number
  readonly quadrant: Quadrant
  readonly rank: number
}

export interface HotspotOutput {
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

interface HotspotInputs {
  readonly complexity: TsLd01Output | undefined
  readonly churn: SharedChurn01Output | undefined
}

export const computeHotspotOutput = (
  config: HotspotConfig,
  inputs: ReadonlyMap<string, unknown>,
): HotspotOutput => {
  const { complexity, churn } = resolveHotspotInputs(inputs)
  if (complexity === undefined || churn === undefined) {
    return emptyHotspotOutput(config)
  }

  const files = buildHotspotCandidates(complexity, churn, config)
  const legacyEntries = files.filter((entry) =>
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

  return assembleHotspotOutput(config, legacy, soft, softTopRightPressure)
}

const resolveHotspotInputs = (
  inputs: ReadonlyMap<string, unknown>,
): HotspotInputs => ({
  complexity: (inputs.get("TS-LD-01-cyclomatic-complexity") ??
    inputs.get("TS-LD-01")) as TsLd01Output | undefined,
  churn: inputs.get("SHARED-CHURN-01") as SharedChurn01Output | undefined,
})

const emptyHotspotOutput = (config: HotspotConfig): HotspotOutput => ({
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
})

const buildHotspotCandidates = (
  complexity: TsLd01Output,
  churn: SharedChurn01Output,
  config: HotspotConfig,
): ReadonlyArray<HotspotCandidate> => {
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
  return files
}

const assembleHotspotOutput = (
  config: HotspotConfig,
  legacy: HotspotSummary,
  soft: HotspotSummary,
  softTopRightPressure: number,
): HotspotOutput => {
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
