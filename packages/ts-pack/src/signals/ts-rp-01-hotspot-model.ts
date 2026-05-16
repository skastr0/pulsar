import {
  buildCompositeExplanation,
  resolveCompositeInputs,
  type CompositeExplanation,
  type CompositeInputResolution,
  type CompositeInputSpec,
} from "@skastr0/pulsar-core/signal"
import type {
  Shared02BusFactorOutput,
  SharedChurn01Output,
  SharedChurn02Output,
  SharedCochange01Output,
  SharedCov01CoverageFactsOutput,
} from "@skastr0/pulsar-shared-signals"
import type { TsLd01Output } from "./ts-ld-01-complexity.js"

interface HotspotConfig {
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
  readonly weightedChurn?: number
  readonly ownershipRisk?: number
  readonly coverageGap?: number
  readonly cochangeRisk?: number
  readonly riskFactors?: HotspotRiskFactors
}

export interface HotspotOutput {
  readonly hotspots: ReadonlyArray<Hotspot>
  readonly explanation: CompositeExplanation
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
  readonly riskModel: "legacy-churn-complexity" | "risk-hotspot-v2"
  readonly riskFilesConsidered: number
  readonly riskPressure: number
  readonly inputFactStates: HotspotInputFactStates
}

interface HotspotCandidate {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly thresholdWeight: number
  readonly weightedChurn?: number
  readonly ownershipRisk?: number
  readonly coverageGap?: number
  readonly cochangeRisk?: number
  readonly riskFactors?: HotspotRiskFactors
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
  readonly weightedChurn: SharedChurn02Output | undefined
  readonly ownership: Shared02BusFactorOutput | undefined
  readonly coverage: SharedCov01CoverageFactsOutput | undefined
  readonly cochange: SharedCochange01Output | undefined
}

export type HotspotFactState =
  | "present"
  | "zero"
  | "absent"
  | "unknown"
  | "not_configured"
  | "not_applicable"

export interface HotspotInputFactStates {
  readonly recencyWeightedChurn: HotspotFactState
  readonly ownership: HotspotFactState
  readonly coverage: HotspotFactState
  readonly cochange: HotspotFactState
}

export interface HotspotRiskFactors {
  readonly complexity: number
  readonly churn: number
  readonly ownership?: number
  readonly coverage?: number
  readonly cochange?: number
}

const HOTSPOT_ENFORCEMENT_CEILING = [
  "trend",
  "review-routing",
  "dashboard",
] as const

export const TS_RP_01_COMPOSITE_INPUTS = [
  {
    id: "TS-LD-01-cyclomatic-complexity",
    aliases: ["TS-LD-01"],
    factorPath: "inputs.complexity",
    weight: 0.5,
    cacheFingerprint: "ts-rp-01-hotspot-complexity-input-v1",
    rawValue: (value) => summarizeComplexityInput(value as TsLd01Output),
    normalize: (value) => normalizeComplexityInput(value as TsLd01Output),
  },
  {
    id: "SHARED-CHURN-01-recent-churn",
    aliases: ["SHARED-CHURN-01"],
    factorPath: "inputs.churn",
    weight: 0.5,
    cacheFingerprint: "ts-rp-01-hotspot-churn-input-v1",
    rawValue: (value) => summarizeChurnInput(value as SharedChurn01Output),
    normalize: (value) => normalizeChurnInput(value as SharedChurn01Output),
  },
  {
    id: "SHARED-CHURN-02-recency-weighted-churn",
    aliases: ["SHARED-CHURN-02"],
    optional: true,
    factorPath: "inputs.recency_weighted_churn",
    weight: 0.25,
    cacheFingerprint: "ts-rp-01-hotspot-weighted-churn-input-v1",
    rawValue: (value) => summarizeWeightedChurnInput(value as SharedChurn02Output),
    normalize: (value) => normalizeWeightedChurnInput(value as SharedChurn02Output),
  },
  {
    id: "SHARED-02-bus-factor",
    aliases: ["SHARED-02"],
    optional: true,
    factorPath: "inputs.ownership",
    weight: 0.15,
    cacheFingerprint: "ts-rp-01-hotspot-ownership-input-v1",
    rawValue: (value) => summarizeOwnershipInput(value as Shared02BusFactorOutput),
    normalize: (value) => normalizeOwnershipInput(value as Shared02BusFactorOutput),
  },
  {
    id: "SHARED-COV-01-coverage-facts",
    aliases: ["SHARED-COV-01"],
    optional: true,
    factorPath: "inputs.coverage",
    weight: 0.15,
    cacheFingerprint: "ts-rp-01-hotspot-coverage-input-v1",
    rawValue: (value) => summarizeCoverageInput(value as SharedCov01CoverageFactsOutput),
    normalize: (value) => normalizeCoverageInput(value as SharedCov01CoverageFactsOutput),
  },
  {
    id: "SHARED-COCHANGE-01-logical-coupling",
    aliases: ["SHARED-COCHANGE-01"],
    optional: true,
    factorPath: "inputs.cochange",
    weight: 0.1,
    cacheFingerprint: "ts-rp-01-hotspot-cochange-input-v1",
    rawValue: (value) => summarizeCochangeInput(value as SharedCochange01Output),
    normalize: (value) => normalizeCochangeInput(value as SharedCochange01Output),
  },
] satisfies ReadonlyArray<CompositeInputSpec>

export const computeHotspotOutput = (
  config: HotspotConfig,
  inputs: ReadonlyMap<string, unknown>,
): HotspotOutput => {
  const resolution = resolveCompositeInputs(TS_RP_01_COMPOSITE_INPUTS, inputs)
  const { complexity, churn, weightedChurn, ownership, coverage, cochange } =
    resolveHotspotInputs(resolution)
  if (complexity === undefined || churn === undefined) {
    return withHotspotExplanation(
      emptyHotspotOutput(config),
      resolution,
      "Hotspot composite is neutral because required primitive inputs are missing.",
    )
  }

  const richFacts = buildRichFactIndexes({ weightedChurn, ownership, coverage, cochange })
  const files = buildHotspotCandidates(complexity, churn, config, richFacts)
  const riskModel =
    richFacts.hasRiskFacts ? "risk-hotspot-v2" as const : "legacy-churn-complexity" as const
  const legacyEntries = files.filter((entry) =>
    entry.churn >= config.min_churn && entry.complexity >= config.min_complexity,
  )
  const softEntries = files.filter((entry) => entry.thresholdWeight > 0)
  const legacy = summarizeHotspots(legacyEntries, (entry) => entry.churn * entry.complexity)
  const soft = summarizeHotspots(
    softEntries,
    (entry) =>
      riskModel === "risk-hotspot-v2"
        ? riskScoreFor(entry)
        : entry.churn * entry.complexity * entry.thresholdWeight,
  )
  const softTopRightPressure = computeSoftTopRightPressure(
    softEntries,
    config.min_churn,
    config.min_complexity,
    config.threshold_softness,
    config.peer_percentile_floor,
  )

  return withHotspotExplanation(
    assembleHotspotOutput(
      config,
      legacy,
      soft,
      softTopRightPressure,
      riskModel,
      richFacts.states,
    ),
    resolution,
    riskModel === "risk-hotspot-v2"
      ? "Ranks files by deterministic review risk from recency-weighted churn, complexity, ownership, coverage, and logical coupling facts."
      : "Ranks files by the composite pressure of recent churn and cyclomatic complexity.",
  )
}

const resolveHotspotInputs = (
  inputs: CompositeInputResolution,
): HotspotInputs => ({
  complexity: inputs.valueOf<TsLd01Output>("TS-LD-01-cyclomatic-complexity"),
  churn: inputs.valueOf<SharedChurn01Output>("SHARED-CHURN-01-recent-churn"),
  weightedChurn: inputs.valueOf<SharedChurn02Output>("SHARED-CHURN-02-recency-weighted-churn"),
  ownership: inputs.valueOf<Shared02BusFactorOutput>("SHARED-02-bus-factor"),
  coverage: inputs.valueOf<SharedCov01CoverageFactsOutput>("SHARED-COV-01-coverage-facts"),
  cochange: inputs.valueOf<SharedCochange01Output>("SHARED-COCHANGE-01-logical-coupling"),
})

type HotspotOutputWithoutExplanation = Omit<HotspotOutput, "explanation">

const emptyHotspotOutput = (config: HotspotConfig): HotspotOutputWithoutExplanation => ({
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
  riskModel: "legacy-churn-complexity",
  riskFilesConsidered: 0,
  riskPressure: 0,
  inputFactStates: {
    recencyWeightedChurn: "not_configured",
    ownership: "not_configured",
    coverage: "not_configured",
    cochange: "not_configured",
  },
  diagnosticLimit: config.top_n,
})

const buildHotspotCandidates = (
  complexity: TsLd01Output,
  churn: SharedChurn01Output,
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
    const riskFactors = facts.hasRiskFacts
      ? riskFactorsFor({
        churn: c,
        complexity: cplx,
        config,
        ...(weightedChurn !== undefined ? { weightedChurn } : {}),
        ...(ownershipRisk !== undefined ? { ownershipRisk } : {}),
        ...(coverageGap !== undefined ? { coverageGap } : {}),
        ...(cochangeRisk !== undefined ? { cochangeRisk } : {}),
      })
      : undefined
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
      ...(riskFactors !== undefined ? { riskFactors } : {}),
    })
  }
  return files
}

const assembleHotspotOutput = (
  config: HotspotConfig,
  legacy: HotspotSummary,
  soft: HotspotSummary,
  softTopRightPressure: number,
  riskModel: HotspotOutput["riskModel"],
  inputFactStates: HotspotInputFactStates,
): HotspotOutputWithoutExplanation => {
  const legacyFilesConsidered = legacy.ranked.length
  const softFilesConsidered = soft.ranked.length
  const stabilizationWeight = stabilizationBlendWeight(
    legacyFilesConsidered === 0 ? softFilesConsidered : legacyFilesConsidered,
  )
  const useSoftShape = riskModel === "risk-hotspot-v2" || stabilizationWeight >= 0.5
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
    riskModel,
    riskFilesConsidered: riskModel === "risk-hotspot-v2" ? softFilesConsidered : 0,
    riskPressure:
      riskModel === "risk-hotspot-v2" ? riskPressureFor(soft.ranked) : 0,
    inputFactStates,
  }
}

export const scoreHotspotOutput = (
  out: HotspotOutputWithoutExplanation,
): number => {
  if (out.riskModel === "risk-hotspot-v2") {
    if (out.riskFilesConsidered === 0) return 1
    return Math.max(0, 1 - Math.min(1, out.riskPressure))
  }
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
}

const withHotspotExplanation = (
  output: HotspotOutputWithoutExplanation,
  inputs: CompositeInputResolution,
  rationale: string,
): HotspotOutput => ({
  ...output,
  explanation: buildCompositeExplanation({
    inputs,
    finalScore: scoreHotspotOutput(output),
    rationale,
    enforcementCeiling: [...HOTSPOT_ENFORCEMENT_CEILING],
  }),
})

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
    ...(entry.weightedChurn !== undefined ? { weightedChurn: entry.weightedChurn } : {}),
    ...(entry.ownershipRisk !== undefined ? { ownershipRisk: entry.ownershipRisk } : {}),
    ...(entry.coverageGap !== undefined ? { coverageGap: entry.coverageGap } : {}),
    ...(entry.cochangeRisk !== undefined ? { cochangeRisk: entry.cochangeRisk } : {}),
    ...(entry.riskFactors !== undefined ? { riskFactors: entry.riskFactors } : {}),
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

const summarizeComplexityInput = (input: TsLd01Output): unknown => ({
  files: input.byFile.size,
  totalFunctions: input.totalFunctions,
  maxComplexity: input.maxComplexity,
})

const summarizeChurnInput = (input: SharedChurn01Output): unknown => ({
  files: input.byFile.size,
  totalCommits: input.totalCommits,
  windowDays: input.windowDays,
  ...(input.sampled === true ? { sampled: true } : {}),
})

const summarizeWeightedChurnInput = (input: SharedChurn02Output): unknown => ({
  files: input.byFile.size,
  totalCommits: input.totalCommits,
  windowDays: input.windowDays,
  halfLifeDays: input.halfLifeDays,
  ...(input.sampled === true ? { sampled: true } : {}),
})

const summarizeOwnershipInput = (input: Shared02BusFactorOutput): unknown => ({
  touchedFiles: input.touchedFileCount,
  touchedLoc: input.touchedLoc,
  siloed: input.effectiveSiloed?.length ?? input.siloed.length,
  repoAuthors: input.repoAuthors.length,
})

const summarizeCoverageInput = (input: SharedCov01CoverageFactsOutput): unknown => ({
  state: input.state,
  files: input.files.length,
  lineCoverage: input.summary.lines.pct,
  functionCoverage: input.summary.functions.pct,
  branchCoverage: input.summary.branches.pct,
})

const summarizeCochangeInput = (input: SharedCochange01Output): unknown => ({
  pairs: input.pairs.length,
  totalCommits: input.totalCommits,
  windowDays: input.windowDays,
  ...(input.sampled === true ? { sampled: true } : {}),
})

const normalizeComplexityInput = (input: TsLd01Output): number =>
  clamp01(input.maxComplexity / 50)

const normalizeChurnInput = (input: SharedChurn01Output): number => {
  const maxFileChurn = Math.max(0, ...input.byFile.values())
  return clamp01(maxFileChurn / Math.max(1, input.windowDays))
}

const normalizeWeightedChurnInput = (input: SharedChurn02Output): number => {
  const maxWeightedChurn = Math.max(
    0,
    ...[...input.byFile.values()].map((file) => file.weightedChurn),
  )
  return clamp01(maxWeightedChurn / Math.max(1, input.halfLifeDays))
}

const normalizeOwnershipInput = (input: Shared02BusFactorOutput): number => {
  const entries = input.effectiveSiloed ?? input.siloed
  return clamp01(Math.max(0, ...entries.map((entry) => {
    if ("penaltyWeight" in entry && typeof entry.penaltyWeight === "number") {
      return entry.penaltyWeight
    }
    return input.touchedLoc === 0 ? 0 : entry.loc / input.touchedLoc
  })))
}

const normalizeCoverageInput = (input: SharedCov01CoverageFactsOutput): number => {
  if (input.state === "absent" || input.state === "unknown" || input.state === "not_configured") {
    return 0
  }
  return clamp01(1 - input.summary.lines.pct)
}

const normalizeCochangeInput = (input: SharedCochange01Output): number =>
  clamp01(Math.max(0, ...input.pairs.map((pair) => pair.confidence)))

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

interface RichFactIndexes {
  readonly weightedChurnByFile: ReadonlyMap<string, { readonly weightedChurn: number }>
  readonly ownershipRiskByFile: ReadonlyMap<string, number>
  readonly coverageGapByFile: ReadonlyMap<string, number>
  readonly cochangeRiskByFile: ReadonlyMap<string, number>
  readonly hasRiskFacts: boolean
  readonly states: HotspotInputFactStates
}

const buildRichFactIndexes = (
  inputs: Pick<HotspotInputs, "weightedChurn" | "ownership" | "coverage" | "cochange">,
): RichFactIndexes => {
  const weightedChurnByFile = inputs.weightedChurn?.byFile ?? new Map()
  const ownershipRiskByFile = ownershipRiskMap(inputs.ownership)
  const coverageGapByFile = coverageGapMap(inputs.coverage)
  const cochangeRiskByFile = cochangeRiskMap(inputs.cochange)
  const states = {
    recencyWeightedChurn: weightedChurnState(inputs.weightedChurn),
    ownership: ownershipState(inputs.ownership),
    coverage: inputs.coverage?.state ?? "not_configured",
    cochange: cochangeState(inputs.cochange),
  } satisfies HotspotInputFactStates
  return {
    weightedChurnByFile,
    ownershipRiskByFile,
    coverageGapByFile,
    cochangeRiskByFile,
    hasRiskFacts:
      weightedChurnByFile.size > 0 ||
      ownershipRiskByFile.size > 0 ||
      coverageGapByFile.size > 0 ||
      cochangeRiskByFile.size > 0,
    states,
  }
}

const ownershipRiskMap = (
  input: Shared02BusFactorOutput | undefined,
): ReadonlyMap<string, number> => {
  if (input === undefined) return new Map()
  const entries = input.effectiveSiloed ?? input.siloed
  return new Map(
    entries.map((entry) => {
      const penaltyWeight =
        "penaltyWeight" in entry && typeof entry.penaltyWeight === "number"
          ? entry.penaltyWeight
          : input.touchedLoc === 0 ? 0 : entry.loc / input.touchedLoc
      return [entry.file, clamp01(penaltyWeight)] as const
    }),
  )
}

const coverageGapMap = (
  input: SharedCov01CoverageFactsOutput | undefined,
): ReadonlyMap<string, number> => {
  if (input === undefined) return new Map()
  if (input.state !== "present" && input.state !== "zero") return new Map()
  return new Map(
    input.files.map((file) => [
      file.file,
      clamp01(1 - file.lines.pct),
    ] as const),
  )
}

const cochangeRiskMap = (
  input: SharedCochange01Output | undefined,
): ReadonlyMap<string, number> => {
  if (input === undefined) return new Map()
  const byFile = new Map<string, number>()
  for (const pair of input.pairs) {
    const risk = clamp01(Math.max(pair.confidence, pair.support))
    byFile.set(pair.leftFile, Math.max(byFile.get(pair.leftFile) ?? 0, risk))
    byFile.set(pair.rightFile, Math.max(byFile.get(pair.rightFile) ?? 0, risk))
  }
  return byFile
}

const weightedChurnState = (
  input: SharedChurn02Output | undefined,
): HotspotFactState => {
  if (input === undefined) return "not_configured"
  return input.byFile.size === 0 ? "zero" : "present"
}

const ownershipState = (
  input: Shared02BusFactorOutput | undefined,
): HotspotFactState => {
  if (input === undefined) return "not_configured"
  if (input.touchedFileCount === 0 || input.touchedLoc === 0) return "not_applicable"
  return (input.effectiveSiloed?.length ?? input.siloed.length) === 0 ? "zero" : "present"
}

const cochangeState = (
  input: SharedCochange01Output | undefined,
): HotspotFactState => {
  if (input === undefined) return "not_configured"
  return input.pairs.length === 0 ? "zero" : "present"
}

const riskFactorsFor = (args: {
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

const riskScoreFor = (entry: HotspotCandidate): number => {
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

const riskPressureFor = (hotspots: ReadonlyArray<Hotspot>): number => {
  if (hotspots.length === 0) return 0
  const risky = hotspots.filter((hotspot) => hotspot.hotspotScore > 0)
  if (risky.length === 0) return 0
  const top = risky.slice(0, Math.min(10, risky.length))
  return top.reduce((sum, hotspot) => sum + hotspot.hotspotScore, 0) / top.length
}
