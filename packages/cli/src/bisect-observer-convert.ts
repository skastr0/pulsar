import {
  type MinimumDimension,
  type ObserverOutput,
} from "@skastr0/pulsar-core/observer"
import {
  CATEGORIES,
  type Category,
} from "@skastr0/pulsar-core/signal"
import type {
  ObserverCommitMinimum,
  ObserverCurveSample,
} from "./bisect-observer-types.js"

export const toObserverCurveSample = (
  sha: string,
  result: ObserverOutput,
): ObserverCurveSample => {
  const { signalScores, signalCategories } = toSignalCurve(result)
  const categorySignalCounts = toCategorySignalCounts(result, "signalCount")
  const categoryApplicableSignalCounts = toCategorySignalCounts(
    result,
    "applicableSignalCount",
  )
  return {
    sha,
    weightedMean: result.weighted_mean,
    readinessScore: result.readiness?.score,
    readinessPressure: result.readiness?.pressure,
    readinessStatus: result.readiness?.status,
    categories: toCategoryScores(result),
    categorySignalCounts,
    categoryApplicableSignalCounts,
    applicableSignalCount: CATEGORIES.reduce(
      (sum, category) => sum + categoryApplicableSignalCounts[category],
      0,
    ),
    signals: signalScores,
    signalCategories,
    minimum: toObserverCommitMinimum(result.minimum),
    hardGateStatus: result.hard_gate_status,
    hardGateViolationCount: result.hard_gate_violations.length,
  }
}

const toCategoryScores = (output: ObserverOutput): Record<Category, number> =>
  Object.fromEntries(
    CATEGORIES.map((category) => [category, output.categories[category].score]),
  ) as Record<Category, number>

const toCategorySignalCounts = (
  output: ObserverOutput,
  field: "signalCount" | "applicableSignalCount",
): Record<Category, number> =>
  Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      field === "signalCount"
        ? output.categories[category].signalCount
        : (output.categories[category].applicableSignalCount ??
            output.categories[category].signalCount),
    ]),
  ) as Record<Category, number>

const toSignalCurve = (
  output: ObserverOutput,
): {
  readonly signalScores: Record<string, number>
  readonly signalCategories: Record<string, Category>
} => {
  const signalScores: Record<string, number> = {}
  const signalCategories: Record<string, Category> = {}
  for (const category of CATEGORIES) {
    const signals = output.categories[category].signals
    for (const signalId of Object.keys(signals).sort()) {
      const score = signals[signalId]
      if (score === undefined) continue
      signalScores[signalId] = score
      signalCategories[signalId] = category
    }
  }
  return { signalScores, signalCategories }
}

const toObserverCommitMinimum = (
  minimum: MinimumDimension | undefined,
): ObserverCommitMinimum | undefined => {
  if (minimum === undefined) return undefined
  return {
    signal: minimum.signal,
    category: minimum.category,
    score: minimum.score,
  }
}
