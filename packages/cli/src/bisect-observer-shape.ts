import {
  CATEGORIES,
  type Category,
} from "@skastr0/pulsar-core/signal"
import type {
  ObserverCommitEntry,
  ObserverCurveSet,
} from "./bisect-observer-types.js"
import type { ScorePoint } from "./bisect-signal-types.js"

export const compactObserverTrajectory = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  selectedCategories: ReadonlyArray<Category>,
  selectedSignalSet: ReadonlySet<string>,
): ReadonlyArray<ObserverCommitEntry> => {
  const categorySet = new Set<Category>(selectedCategories)
  return trajectory.map((entry) => ({
    ...entry,
    categories: filterCategoryRecord(entry.categories, categorySet),
    categorySignalCounts: filterCategoryRecord(entry.categorySignalCounts, categorySet),
    categoryApplicableSignalCounts: filterCategoryRecord(
      entry.categoryApplicableSignalCounts,
      categorySet,
    ),
    signals: Object.fromEntries(
      Object.entries(entry.signals).filter(([signalId]) => selectedSignalSet.has(signalId)),
    ),
  }))
}

export const buildObserverCurves = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  selectedCategories: ReadonlyArray<Category>,
  selectedSignalSet: ReadonlySet<string>,
): ObserverCurveSet => ({
  weightedMean: trajectory.map((entry) => entry.weightedMean),
  readiness: trajectory.map((entry) => entry.readinessScore ?? null),
  categories: Object.fromEntries(
    selectedCategories.map((category) => [
      category,
      trajectory.map((entry) => entry.categories[category]),
    ]),
  ),
  signals: Object.fromEntries(
    [...selectedSignalSet].map((signalId) => [
      signalId,
      nullableSignalScores(trajectory, signalId),
    ]),
  ),
})

export const resolveCrossingPoints = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  target: string,
): ReadonlyArray<ScorePoint> => {
  if (target === "weightedMean" || target === "weighted_mean") {
    return trajectory.map((entry) => ({ sha: entry.sha, score: entry.weightedMean }))
  }
  if (target === "readiness" || target === "readinessScore") {
    return trajectory.flatMap((entry) =>
      entry.readinessScore === undefined ? [] : [{ sha: entry.sha, score: entry.readinessScore }],
    )
  }
  if ((CATEGORIES as ReadonlyArray<string>).includes(target)) {
    const category = target as Category
    return trajectory.map((entry) => ({ sha: entry.sha, score: entry.categories[category] }))
  }
  return signalScorePoints(trajectory, target)
}

const filterCategoryRecord = <Value>(
  record: Record<Category, Value>,
  categories: ReadonlySet<Category>,
): Record<Category, Value> =>
  Object.fromEntries(
    Object.entries(record).filter(([category]) => categories.has(category as Category)),
  ) as Record<Category, Value>

const nullableSignalScores = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  signalId: string,
): ReadonlyArray<number | null> =>
  trajectory.map((entry) => entry.signals[signalId] ?? null)

const signalScorePoints = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  signalId: string,
): ReadonlyArray<ScorePoint> =>
  trajectory.flatMap((entry) => {
    const score = entry.signals[signalId]
    return score === undefined ? [] : [{ sha: entry.sha, score }]
  })
