import {
  CATEGORIES,
  type Category,
} from "@skastr0/pulsar-core/signal"
import {
  findCulprits,
  findDriftCulprits,
  summarizeScores,
} from "./bisect-signal-report.js"
import {
  buildObserverCurves,
  compactObserverTrajectory,
} from "./bisect-observer-shape.js"
import type {
  CategoryTrajectory,
  ObserverBisectReport,
  ObserverCommitEntry,
  ObserverCurveSample,
  SignalTrajectory,
} from "./bisect-observer-types.js"
import type {
  Culprit,
  ScorePoint,
} from "./bisect-signal-types.js"

type ObserverReportScope = {
  readonly signalCategories: Record<string, Category>
  readonly selectedCategories: ReadonlyArray<Category>
  readonly selectedSignalSet: ReadonlySet<string>
  readonly trajectory: ReadonlyArray<ObserverCommitEntry>
}

type ObserverTrajectoryPayload = Pick<
  ObserverBisectReport,
  "trajectory" | "commits" | "curves" | "signalCategories" | "perCategory" | "perSignal"
>

type ObserverCulpritPayload = Pick<
  ObserverBisectReport,
  | "weightedMeanCulprits"
  | "weightedMeanDriftCulprits"
  | "perCategoryCulprits"
  | "perCategoryDriftCulprits"
  | "perSignalCulprits"
  | "perSignalDriftCulprits"
>

export const resolveObserverReportScope = (
  results: ReadonlyArray<ObserverCurveSample>,
  opts: {
    readonly selectedSignals: ReadonlyArray<string>
    readonly selectedCategories: ReadonlyArray<Category>
  },
): ObserverReportScope => {
  const signalCategories = mergeSignalCategories(results)
  const selectedCategories =
    opts.selectedCategories.length === 0 ? [...CATEGORIES] : opts.selectedCategories
  const selectedSignalSet = selectedSignalsForReport(
    signalCategories,
    opts.selectedSignals,
    selectedCategories,
  )
  const trajectory = results.map(({ signalCategories: _signalCategories, ...entry }) => entry)

  return { signalCategories, selectedCategories, selectedSignalSet, trajectory }
}

export const observerTrajectoryPayload = (
  scope: ObserverReportScope,
): ObserverTrajectoryPayload => ({
  trajectory: compactObserverTrajectory(
    scope.trajectory,
    scope.selectedCategories,
    scope.selectedSignalSet,
  ),
  commits: scope.trajectory.map((entry) => entry.sha),
  curves: buildObserverCurves(
    scope.trajectory,
    scope.selectedCategories,
    scope.selectedSignalSet,
  ),
  signalCategories: Object.fromEntries(
    Object.entries(scope.signalCategories).filter(([signalId]) =>
      scope.selectedSignalSet.has(signalId),
    ),
  ),
  perCategory: Object.fromEntries(
    scope.selectedCategories.map((category) => [
      category,
      summarizeCategoryTrajectory(scope.trajectory.map((entry) => entry.categories[category])),
    ]),
  ) as Record<Category, CategoryTrajectory>,
  perSignal: perSignalTrajectories(
    scope.trajectory,
    scope.signalCategories,
    scope.selectedSignalSet,
  ),
})

export const observerCulpritPayload = (
  scope: ObserverReportScope,
  topCulprits: number,
): ObserverCulpritPayload => ({
  weightedMeanCulprits: findCulprits(scorePoints(scope.trajectory, "weightedMean"), topCulprits),
  weightedMeanDriftCulprits: findDriftCulprits(
    scorePoints(scope.trajectory, "weightedMean"),
    topCulprits,
  ),
  perCategoryCulprits: categoryCulprits(
    scope.trajectory,
    scope.selectedCategories,
    topCulprits,
    findCulprits,
  ),
  perCategoryDriftCulprits: categoryCulprits(
    scope.trajectory,
    scope.selectedCategories,
    topCulprits,
    findDriftCulprits,
  ),
  perSignalCulprits: signalCulprits(
    scope.trajectory,
    scope.selectedSignalSet,
    topCulprits,
    findCulprits,
  ),
  perSignalDriftCulprits: signalCulprits(
    scope.trajectory,
    scope.selectedSignalSet,
    topCulprits,
    findDriftCulprits,
  ),
})

export const summarizeReadinessTrajectory = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
): {
  readonly trajectory: ReadonlyArray<ScorePoint>
  readonly scores: ReturnType<typeof summarizeScores> | undefined
} => {
  const readinessTrajectory = trajectory.flatMap((entry) =>
    entry.readinessScore === undefined
      ? []
      : [{ sha: entry.sha, score: entry.readinessScore }],
  )
  return {
    trajectory: readinessTrajectory,
    scores:
      readinessTrajectory.length === 0
        ? undefined
        : summarizeScores(readinessTrajectory.map((entry) => entry.score)),
  }
}

const scorePoints = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  key: "weightedMean",
): ReadonlyArray<ScorePoint> =>
  trajectory.map((entry) => ({ sha: entry.sha, score: entry[key] }))

const categoryCulprits = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  categories: ReadonlyArray<Category>,
  topCulprits: number,
  finder: <T extends ScorePoint>(
    trajectory: ReadonlyArray<T>,
    topN: number,
  ) => ReadonlyArray<Culprit>,
): Record<Category, ReadonlyArray<Culprit>> =>
  Object.fromEntries(
    categories.map((category) => [
      category,
      finder(
        trajectory.map((entry) => ({ sha: entry.sha, score: entry.categories[category] })),
        topCulprits,
      ),
    ]),
  ) as Record<Category, ReadonlyArray<Culprit>>

const signalCulprits = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  selectedSignalSet: ReadonlySet<string>,
  topCulprits: number,
  finder: <T extends ScorePoint>(
    trajectory: ReadonlyArray<T>,
    topN: number,
  ) => ReadonlyArray<Culprit>,
): Record<string, ReadonlyArray<Culprit>> =>
  Object.fromEntries(
    [...selectedSignalSet].map((signalId) => [
      signalId,
      finder(signalScorePoints(trajectory, signalId), topCulprits),
    ]),
  )

const perSignalTrajectories = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  signalCategories: Record<string, Category>,
  selectedSignalSet: ReadonlySet<string>,
): Record<string, SignalTrajectory> =>
  Object.fromEntries(
    Object.entries(signalCategories)
      .filter(([signalId]) => selectedSignalSet.has(signalId))
      .map(([signalId, category]) => [
        signalId,
        summarizeSignalTrajectory(category, nullableSignalScores(trajectory, signalId)),
      ]),
  )

const summarizeCategoryTrajectory = (scores: ReadonlyArray<number>): CategoryTrajectory => {
  const summary = summarizeScores(scores)
  return {
    scores,
    min: summary.min,
    max: summary.max,
    final: summary.final,
    drift: summary.drift,
    distinctLevels: summary.distinctLevels,
  }
}

const summarizeSignalTrajectory = (
  category: Category,
  scores: ReadonlyArray<number | null>,
): SignalTrajectory => {
  const observed = scores.filter((score): score is number => score !== null)
  if (observed.length === 0) {
    return {
      category,
      scores,
      observedCount: 0,
      min: undefined,
      max: undefined,
      final: undefined,
      drift: undefined,
      distinctLevels: 0,
    }
  }
  const summary = summarizeCategoryTrajectory(observed)
  return {
    category,
    scores,
    observedCount: observed.length,
    min: summary.min,
    max: summary.max,
    final: summary.final,
    drift: summary.drift,
    distinctLevels: summary.distinctLevels,
  }
}

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

const mergeSignalCategories = (
  results: ReadonlyArray<ObserverCurveSample>,
): Record<string, Category> => {
  const entries = new Map<string, Category>()
  for (const result of results) {
    for (const [signalId, category] of Object.entries(result.signalCategories)) {
      entries.set(signalId, category)
    }
  }
  return Object.fromEntries(
    [...entries.entries()].sort(([left], [right]) => left.localeCompare(right)),
  )
}

const selectedSignalsForReport = (
  signalCategories: Record<string, Category>,
  requestedSignals: ReadonlyArray<string>,
  selectedCategories: ReadonlyArray<Category>,
): ReadonlySet<string> => {
  const selectedCategorySet = new Set<Category>(selectedCategories)
  const requested = new Set(requestedSignals)
  return new Set(
    Object.entries(signalCategories)
      .filter(([signalId, category]) =>
        requested.size > 0 ? requested.has(signalId) : selectedCategorySet.has(category),
      )
      .map(([signalId]) => signalId)
      .sort((left, right) => left.localeCompare(right)),
  )
}
