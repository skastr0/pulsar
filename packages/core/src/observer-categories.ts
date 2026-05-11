import { type Category, categoryRecord } from "./category.js"
import type { Registry } from "./registry.js"
import type { SignalRunResult } from "./runner.js"
import type { ResolvedSignal } from "./signal.js"
import { categoryAggregationConfigOf, type CategoryAggregationObserverConfig, type PulsarVector, weightOf as vectorWeightOf } from "./vector.js"
import type { CategoryOutput } from "./observer-model.js"
import { localSignalPressure } from "./observer-local-pressure.js"
import { clamp01, confidenceForSignal, roundScore, signalApplicabilityOf } from "./observer-score-utils.js"

export const aggregateCategories = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: PulsarVector | undefined,
): Record<Category, CategoryOutput> =>
  categoryRecord((category) => aggregateOneCategory(category, registry, signalResults, vector))

type CategoryGroupBucket = {
  weightedSum: number
  weightTotal: number
  signalIds: Array<string>
}

interface CategoryAggregationInputs {
  readonly signalsInCategory: ReadonlyArray<ResolvedSignal>
  readonly signalsRecord: Record<string, number>
  readonly weightsRecord: Record<string, number>
  activeIds: Array<string>
  applicableSignalCount: number
  weightedSum: number
  weightTotal: number
  groups: Map<string, CategoryGroupBucket>
  languageLocalGroups: Set<string>
  pressureInputs: Array<PressureInput>
  applicableScores: Array<number>
}

type PressureInput = {
  readonly score: number
  readonly weight: number
  readonly confidence: number
}

const aggregateOneCategory = (
  category: Category,
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: PulsarVector | undefined,
): CategoryOutput => {
  const inputs = collectCategoryAggregationInputs(category, registry, signalResults, vector)
  const rawScore = inputs.weightTotal === 0 ? 1 : inputs.weightedSum / inputs.weightTotal
  const lowestSignalScore = Math.min(...inputs.applicableScores)
  const normalization =
    inputs.languageLocalGroups.size > 1
      ? buildCategoryNormalization(inputs.groups)
      : undefined
  const normalizedScore = normalization?.score ?? rawScore
  const pressure = aggregateCategoryPressure(
    inputs.pressureInputs,
    categoryAggregationConfigOf(vector),
    inputs.pressureInputs,
  )
  const pressureScore = clamp01(1 - pressure.finalPressure)
  const score = roundScore(Math.min(normalizedScore, pressureScore))
  return {
    score,
    signals: inputs.signalsRecord,
    signalCount: inputs.signalsInCategory.length,
    applicableSignalCount: inputs.applicableSignalCount,
    activeSignalIds: inputs.activeIds,
    aggregation: {
      strategy: normalization === undefined ? "weighted-mean" : "language-group-mean",
      rawScore,
      aggregateScore: normalizedScore,
      lowestSignalScore: Number.isFinite(lowestSignalScore) ? lowestSignalScore : 1,
      finalScore: score,
      shapedByPressure: score < normalizedScore,
      pressure,
      weightTotal: inputs.weightTotal,
      weights: inputs.weightsRecord,
    },
    ...(normalization !== undefined ? { normalization: normalization.snapshot } : {}),
  }
}

const collectCategoryAggregationInputs = (
  category: Category,
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: PulsarVector | undefined,
): CategoryAggregationInputs => {
  const signalsInCategory = registry.sorted.filter(
    (signal) => signal.category === category && signalResults.has(signal.id),
  )
  const inputs = makeEmptyCategoryAggregationInputs(signalsInCategory)
  for (const signal of signalsInCategory) {
    addCategorySignalInput(signal, signalResults.get(signal.id), vector, inputs)
  }
  return inputs
}

const makeEmptyCategoryAggregationInputs = (
  signalsInCategory: ReadonlyArray<ResolvedSignal>,
): CategoryAggregationInputs => ({
  signalsInCategory,
  signalsRecord: {},
  weightsRecord: {},
  activeIds: [],
  applicableSignalCount: 0,
  weightedSum: 0,
  weightTotal: 0,
  groups: new Map(),
  languageLocalGroups: new Set(),
  pressureInputs: [],
  applicableScores: [],
})

const addCategorySignalInput = (
  signal: ResolvedSignal,
  result: SignalRunResult | undefined,
  vector: PulsarVector | undefined,
  inputs: CategoryAggregationInputs,
): void => {
  if (result === undefined) return
  const weight = vectorWeightOf(signal, vector)
  inputs.signalsRecord[signal.id] = result.score
  inputs.weightsRecord[signal.id] = weight
  inputs.activeIds.push(signal.id)
  if (signalApplicabilityOf(result) !== "applicable") return

  const confidence = confidenceForSignal(signal, result)
  const effectiveScore = confidenceAdjustedScore(result.score, confidence)
  inputs.applicableSignalCount += 1
  inputs.weightedSum += weight * effectiveScore
  inputs.weightTotal += weight
  inputs.pressureInputs.push({ score: result.score, weight, confidence })
  inputs.applicableScores.push(result.score)
  addCategoryNormalizationInput(signal, weight, effectiveScore, inputs)
}

const addCategoryNormalizationInput = (
  signal: ResolvedSignal,
  weight: number,
  effectiveScore: number,
  inputs: {
    readonly groups: Map<string, CategoryGroupBucket>
    readonly languageLocalGroups: Set<string>
  },
): void => {
  const normalizationGroup = normalizationGroupOfSignal(signal)
  const bucket = inputs.groups.get(normalizationGroup) ?? {
    weightedSum: 0,
    weightTotal: 0,
    signalIds: [],
  }
  bucket.weightedSum += weight * effectiveScore
  bucket.weightTotal += weight
  bucket.signalIds.push(signal.id)
  inputs.groups.set(normalizationGroup, bucket)
  if (isLanguageNormalizationGroup(normalizationGroup)) {
    inputs.languageLocalGroups.add(normalizationGroup)
  }
}

const buildCategoryNormalization = (
  groups: ReadonlyMap<
    string,
    {
      weightedSum: number
      weightTotal: number
      signalIds: ReadonlyArray<string>
    }
  >,
): {
  readonly score: number
  readonly snapshot: NonNullable<CategoryOutput["normalization"]>
} => {
  const normalizedGroups: NonNullable<CategoryOutput["normalization"]>["groups"] = {}
  let groupScoreSum = 0
  let groupCount = 0

  for (const [group, bucket] of groups) {
    const score = bucket.weightTotal === 0 ? 1 : bucket.weightedSum / bucket.weightTotal
    normalizedGroups[group] = {
      score,
      signals: [...bucket.signalIds].sort(),
      signalCount: bucket.signalIds.length,
    }
    groupScoreSum += score
    groupCount += 1
  }

  return {
    score: groupCount === 0 ? 1 : groupScoreSum / groupCount,
    snapshot: {
      strategy: "language-group-mean",
      groups: normalizedGroups,
    },
  }
}

const normalizationGroupOfSignal = (signal: ResolvedSignal): string => {
  if (signal.normalizationGroup !== undefined) return signal.normalizationGroup
  if (signal.id.startsWith("TS-")) return "typescript"
  if (signal.id.startsWith("RS-")) return "rust"
  if (signal.id.startsWith("SHARED-")) return "shared"
  return "default"
}

const isLanguageNormalizationGroup = (group: string): boolean =>
  group === "typescript" || group === "rust"

const aggregateCategoryPressure = (
  inputs: ReadonlyArray<{
    readonly score: number
    readonly weight: number
    readonly confidence: number
  }>,
  config: CategoryAggregationObserverConfig,
  localInputs: ReadonlyArray<{
    readonly score: number
    readonly weight: number
    readonly confidence: number
  }> = inputs,
): NonNullable<CategoryOutput["aggregation"]>["pressure"] => {
  let weightedPressureSum = 0
  let weightedPnormSum = 0
  let weightTotal = 0

  for (const input of inputs) {
    const weight = input.weight
    const pressure = confidenceAdjustedPressure(input.score, input.confidence)
    weightedPressureSum += weight * pressure
    weightedPnormSum += weight * Math.pow(pressure, config.p_norm)
    weightTotal += weight
  }

  let maxLocalPressure = 0
  for (const input of localInputs) {
    maxLocalPressure = Math.max(
      maxLocalPressure,
      confidenceAdjustedPressure(input.score, input.confidence),
    )
  }

  const meanPressure = weightTotal === 0 ? 0 : weightedPressureSum / weightTotal
  const pnormPressure =
    weightTotal === 0
      ? 0
      : Math.pow(weightedPnormSum / weightTotal, 1 / config.p_norm)
  const localPressure = localSignalPressure(maxLocalPressure, config)
  const finalPressure = clamp01(Math.max(pnormPressure, localPressure))

  return {
    strategy: "pressure-pnorm-local-max",
    p: config.p_norm,
    meanPressure: roundScore(meanPressure),
    pnormPressure: roundScore(pnormPressure),
    maxLocalPressure: roundScore(maxLocalPressure),
    localPressure: roundScore(localPressure),
    finalPressure: roundScore(finalPressure),
  }
}

const confidenceAdjustedScore = (score: number, confidence: number): number =>
  clamp01(1 - confidenceAdjustedPressure(score, confidence))

const confidenceAdjustedPressure = (score: number, confidence: number): number =>
  clamp01(1 - score) * confidence
