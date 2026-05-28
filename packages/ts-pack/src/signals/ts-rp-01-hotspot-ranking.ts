import type { RichFactIndexes } from "./ts-rp-01-hotspot-rich-facts.js"
import {
  aboveFloor,
  compareNumberDesc,
  compareStringAsc,
  median,
  normalizeObservedMagnitude,
  percentileRank,
  softGate,
} from "./ts-rp-01-hotspot-math.js"
import type {
  Hotspot,
  HotspotCandidate,
  HotspotConfig,
  HotspotOutputWithoutExplanation,
  HotspotRiskFactors,
  HotspotSummary,
  Quadrant,
} from "./ts-rp-01-hotspot-types.js"

interface ChurnByFileInput {
  readonly byFile: ReadonlyMap<string, number>
}

interface ComplexityByFileInput {
  readonly byFile: ReadonlyMap<string, { readonly max: number }>
}

export const buildHotspotCandidates = (
  complexity: ComplexityByFileInput,
  churn: ChurnByFileInput,
  config: HotspotConfig,
  facts: RichFactIndexes,
): ReadonlyArray<HotspotCandidate> => {
  const files: Array<HotspotCandidate> = []
  for (const [file, summary] of complexity.byFile) {
    const cplx = summary.max
    const c = churn.byFile.get(file) ?? 0
    if (c <= 0) continue
    const weightedChurn = facts.weightedChurnByFile.get(file)?.weightedChurn
    const ownershipRisk = facts.ownershipRiskByFile.get(file)
    const coverageGap = facts.coverageGapByFile.get(file)
    const cochangeRisk = facts.cochangeRiskByFile.get(file)
    const thresholdWeight =
      softGate(c, config.min_churn, config.threshold_softness) *
      softGate(cplx, config.min_complexity, config.threshold_softness)
    files.push({
      file,
      churn: c,
      complexity: cplx,
      thresholdWeight,
      ...(weightedChurn !== undefined ? { weightedChurn } : {}),
      ...(ownershipRisk !== undefined ? { ownershipRisk } : {}),
      ...(coverageGap !== undefined ? { coverageGap } : {}),
      ...(cochangeRisk !== undefined ? { cochangeRisk } : {}),
    })
  }
  return files
}

export const hasCandidateRiskFacts = (entry: HotspotCandidate): boolean =>
  entry.weightedChurn !== undefined ||
  entry.ownershipRisk !== undefined ||
  entry.coverageGap !== undefined ||
  entry.cochangeRisk !== undefined

export const summarizeHotspots = (
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
    ...(entry.weightedChurn !== undefined ? { weightedChurn: entry.weightedChurn } : {}),
    ...(entry.ownershipRisk !== undefined ? { ownershipRisk: entry.ownershipRisk } : {}),
    ...(entry.coverageGap !== undefined ? { coverageGap: entry.coverageGap } : {}),
    ...(entry.cochangeRisk !== undefined ? { cochangeRisk: entry.cochangeRisk } : {}),
    ...(entry.riskFactors !== undefined ? { riskFactors: entry.riskFactors } : {}),
    rank: 0,
  }))

  scored.sort(compareScoredHotspots)
  const ranked = scored.map((hotspot, index) => ({ ...hotspot, rank: index + 1 }))
  const topRight = ranked.filter((hotspot) => hotspot.quadrant === "top-right").length

  return {
    ranked,
    topRightShare: ranked.length === 0 ? 0 : topRight / ranked.length,
    medianChurn,
    medianComplexity,
  }
}

export const computeSoftTopRightPressure = (
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

export const stabilizationBlendWeight = (consideredFiles: number): number => {
  const fullyStabilizedAt = 6
  const fullyLegacyAt = 12
  if (consideredFiles <= fullyStabilizedAt) return 1
  if (consideredFiles >= fullyLegacyAt) return 0
  return (fullyLegacyAt - consideredFiles) / (fullyLegacyAt - fullyStabilizedAt)
}

export const riskFactorsFor = (args: {
  readonly churn: number
  readonly complexity: number
  readonly config: HotspotConfig
  readonly weightedChurn?: number
  readonly ownershipRisk?: number
  readonly coverageGap?: number
  readonly cochangeRisk?: number
}): HotspotRiskFactors => ({
  complexity: normalizeObservedMagnitude(
    args.complexity,
    args.config.min_complexity,
    args.config.threshold_softness,
  ),
  churn: normalizeObservedMagnitude(
    args.weightedChurn ?? args.churn,
    args.config.min_churn,
    args.config.threshold_softness,
  ),
  ...(args.ownershipRisk !== undefined ? { ownership: args.ownershipRisk } : {}),
  ...(args.coverageGap !== undefined ? { coverage: args.coverageGap } : {}),
  ...(args.cochangeRisk !== undefined ? { cochange: args.cochangeRisk } : {}),
})

export const riskScoreFor = (entry: HotspotCandidate): number => {
  const factors = entry.riskFactors
  if (factors === undefined) return entry.churn * entry.complexity * entry.thresholdWeight
  const weighted = [
    ["complexity", factors.complexity, 0.35],
    ["churn", factors.churn, 0.25],
    ["ownership", factors.ownership, 0.15],
    ["coverage", factors.coverage, 0.15],
    ["cochange", factors.cochange, 0.1],
  ] as const
  const present = weighted.filter(([, value]) => value !== undefined)
  const totalWeight = present.reduce((sum, [, , weight]) => sum + weight, 0)
  if (totalWeight === 0) return 0
  return present.reduce((sum, [, value, weight]) => sum + (value ?? 0) * weight, 0) /
    totalWeight
}

export const riskPressureFor = (hotspots: ReadonlyArray<Hotspot>): number => {
  if (hotspots.length === 0) return 0
  const risky = hotspots.filter((hotspot) => hotspot.hotspotScore > 0)
  if (risky.length === 0) return 0
  const top = risky.slice(0, Math.min(10, risky.length))
  return top.reduce((sum, hotspot) => sum + hotspot.hotspotScore, 0) / top.length
}

export const scoreHotspotOutput = (
  out: HotspotOutputWithoutExplanation,
): number => {
  if (out.riskModel === "risk-hotspot-v2") {
    if (out.riskFilesConsidered === 0) return 1
    return Math.max(0, 1 - Math.min(1, out.riskPressure))
  }
  if (out.legacyFilesConsidered === 0 && out.softFilesConsidered === 0) return 1
  const legacyPressure = Math.min(
    1,
    Math.max(out.legacyTopRightShare * 1.5, out.softTopRightPressure),
  )
  const legacyScore =
    out.legacyFilesConsidered === 0
      ? 1
      : Math.max(0, 1 - legacyPressure)
  const stabilizedScore =
    out.softFilesConsidered === 0
      ? legacyScore
      : Math.max(0, 1 - Math.min(1, out.softTopRightShare + out.softTopRightPressure * 2))
  return (
    legacyScore * (1 - out.stabilizationWeight) +
    stabilizedScore * out.stabilizationWeight
  )
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

const compareScoredHotspots = (
  left: {
    readonly file: string
    readonly churn: number
    readonly complexity: number
    readonly hotspotScore: number
  },
  right: {
    readonly file: string
    readonly churn: number
    readonly complexity: number
    readonly hotspotScore: number
  },
): number => {
  const scoreDelta = compareNumberDesc(left.hotspotScore, right.hotspotScore)
  if (scoreDelta !== 0) return scoreDelta
  const churnDelta = compareNumberDesc(left.churn, right.churn)
  if (churnDelta !== 0) return churnDelta
  const complexityDelta = compareNumberDesc(left.complexity, right.complexity)
  if (complexityDelta !== 0) return complexityDelta
  return compareStringAsc(left.file, right.file)
}
