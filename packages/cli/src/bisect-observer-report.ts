import {
  CATEGORIES,
  type Category,
  type Registry,
} from "@skastr0/pulsar-core"
import {
  findCulprits,
  findDriftCulprits,
  findFirstCrossing,
  summarizeScores,
} from "./bisect-signal-report.js"
import {
  buildObserverCurves,
  compactObserverTrajectory,
  resolveCrossingPoints,
} from "./bisect-observer-shape.js"
import type {
  CategoryTrajectory,
  Culprit,
  FirstCrossingQuery,
  ObserverBisectReport,
  ObserverCommitEntry,
  ObserverCurveSample,
  ObserverCurveSet,
  ScorePoint,
  SignalTrajectory,
} from "./bisect-types.js"
import type { BisectSamplingSummary } from "./bisect-sampling.js"

export const buildObserverReport = (
  results: ReadonlyArray<ObserverCurveSample>,
  opts: {
    readonly repoPath: string
    readonly fromSha: string
    readonly toSha: string
    readonly topCulprits: number
    readonly vectorName: string | null
    readonly sampling: BisectSamplingSummary
    readonly selectedSignals: ReadonlyArray<string>
    readonly selectedCategories: ReadonlyArray<Category>
    readonly firstCrossing: FirstCrossingQuery | undefined
  },
): ObserverBisectReport => {
  const signalCategories = mergeSignalCategories(results)
  const selectedCategories =
    opts.selectedCategories.length === 0 ? [...CATEGORIES] : opts.selectedCategories
  const selectedSignalSet = selectedSignalsForReport(
    signalCategories,
    opts.selectedSignals,
    selectedCategories,
  )
  const trajectory = results.map(({ signalCategories: _signalCategories, ...entry }) => entry)

  const weightedMeanScores = summarizeScores(trajectory.map((entry) => entry.weightedMean))
  const readinessTrajectory = trajectory.flatMap((entry) =>
    entry.readinessScore === undefined
      ? []
      : [{ sha: entry.sha, score: entry.readinessScore }],
  )
  const readinessScores =
    readinessTrajectory.length === 0
      ? undefined
      : summarizeScores(readinessTrajectory.map((entry) => entry.score))

  const perCategory = Object.fromEntries(
    selectedCategories.map((category) => [
      category,
      summarizeCategoryTrajectory(trajectory.map((entry) => entry.categories[category])),
    ]),
  ) as Record<Category, CategoryTrajectory>

  const finalEntry = trajectory[trajectory.length - 1]
  return {
    schemaVersion: "observer-bisect/v2",
    repoPath: opts.repoPath,
    fromSha: opts.fromSha,
    toSha: opts.toSha,
    vectorName: opts.vectorName,
    trajectory: compactObserverTrajectory(trajectory, selectedCategories, selectedSignalSet),
    commits: trajectory.map((entry) => entry.sha),
    curves: buildObserverCurves(trajectory, selectedCategories, selectedSignalSet),
    signalCategories: Object.fromEntries(
      Object.entries(signalCategories).filter(([signalId]) => selectedSignalSet.has(signalId)),
    ),
    perCategory,
    perSignal: perSignalTrajectories(trajectory, signalCategories, selectedSignalSet),
    weightedMeanCulprits: findCulprits(scorePoints(trajectory, "weightedMean"), opts.topCulprits),
    weightedMeanDriftCulprits: findDriftCulprits(scorePoints(trajectory, "weightedMean"), opts.topCulprits),
    perCategoryCulprits: categoryCulprits(trajectory, selectedCategories, opts.topCulprits, findCulprits),
    perCategoryDriftCulprits: categoryCulprits(trajectory, selectedCategories, opts.topCulprits, findDriftCulprits),
    perSignalCulprits: signalCulprits(trajectory, selectedSignalSet, opts.topCulprits, findCulprits),
    perSignalDriftCulprits: signalCulprits(trajectory, selectedSignalSet, opts.topCulprits, findDriftCulprits),
    readinessCulprits: findCulprits(readinessTrajectory, opts.topCulprits),
    readinessDriftCulprits: findDriftCulprits(readinessTrajectory, opts.topCulprits),
    sampling: opts.sampling,
    finalReadinessScore: readinessScores?.final,
    minReadinessScore: readinessScores?.min,
    maxReadinessScore: readinessScores?.max,
    readinessDrift: readinessScores?.drift,
    finalApplicableSignalCount: finalEntry?.applicableSignalCount ?? 0,
    finalWeightedMean: weightedMeanScores.final,
    minWeightedMean: weightedMeanScores.min,
    maxWeightedMean: weightedMeanScores.max,
    totalDrift: weightedMeanScores.drift,
    finalMinimumDimension: finalEntry?.minimum,
    hardGateStatusAtFinal: finalEntry?.hardGateStatus ?? "pass",
    firstCrossing:
      opts.firstCrossing === undefined
        ? undefined
        : findFirstCrossing(resolveCrossingPoints(trajectory, opts.firstCrossing.target), opts.firstCrossing),
    selectedSignals: [...selectedSignalSet],
    selectedCategories,
  }
}

export const observerReportOptions = (
  opts: {
    readonly fromSha: string
    readonly toSha: string
    readonly topCulprits: number
    readonly selectedSignals?: ReadonlyArray<string>
    readonly selectedCategories?: ReadonlyArray<Category>
    readonly firstCrossing?: FirstCrossingQuery
  },
  runtime: {
    readonly repoPath: string
    readonly vector: { readonly id?: string } | undefined
    readonly registry: Registry
  },
  sampling: BisectSamplingSummary,
): Parameters<typeof buildObserverReport>[1] => ({
  repoPath: runtime.repoPath,
  fromSha: opts.fromSha,
  toSha: opts.toSha,
  topCulprits: opts.topCulprits,
  vectorName: runtime.vector?.id ?? null,
  sampling,
  selectedSignals: (opts.selectedSignals ?? []).map(
    (signalId) => runtime.registry.canonicalIdOf(signalId) ?? signalId,
  ),
  selectedCategories: opts.selectedCategories ?? [],
  firstCrossing: canonicalizeFirstCrossingQuery(opts.firstCrossing, runtime.registry),
})

const scorePoints = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  key: "weightedMean",
): ReadonlyArray<ScorePoint> =>
  trajectory.map((entry) => ({ sha: entry.sha, score: entry[key] }))

const categoryCulprits = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  categories: ReadonlyArray<Category>,
  topCulprits: number,
  finder: <T extends ScorePoint>(trajectory: ReadonlyArray<T>, topN: number) => ReadonlyArray<Culprit>,
): Record<Category, ReadonlyArray<Culprit>> =>
  Object.fromEntries(
    categories.map((category) => [
      category,
      finder(trajectory.map((entry) => ({ sha: entry.sha, score: entry.categories[category] })), topCulprits),
    ]),
  ) as Record<Category, ReadonlyArray<Culprit>>

const signalCulprits = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  selectedSignalSet: ReadonlySet<string>,
  topCulprits: number,
  finder: <T extends ScorePoint>(trajectory: ReadonlyArray<T>, topN: number) => ReadonlyArray<Culprit>,
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
  return { scores, min: summary.min, max: summary.max, final: summary.final, drift: summary.drift, distinctLevels: summary.distinctLevels }
}

const summarizeSignalTrajectory = (
  category: Category,
  scores: ReadonlyArray<number | null>,
): SignalTrajectory => {
  const observed = scores.filter((score): score is number => score !== null)
  if (observed.length === 0) {
    return { category, scores, observedCount: 0, min: undefined, max: undefined, final: undefined, drift: undefined, distinctLevels: 0 }
  }
  const summary = summarizeCategoryTrajectory(observed)
  return { category, scores, observedCount: observed.length, min: summary.min, max: summary.max, final: summary.final, drift: summary.drift, distinctLevels: summary.distinctLevels }
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

const canonicalizeFirstCrossingQuery = (
  query: FirstCrossingQuery | undefined,
  registry: Registry,
): FirstCrossingQuery | undefined => query === undefined
  ? undefined
  : { ...query, target: registry.canonicalIdOf(query.target) ?? query.target }

const mergeSignalCategories = (
  results: ReadonlyArray<ObserverCurveSample>,
): Record<string, Category> => {
  const entries = new Map<string, Category>()
  for (const result of results) {
    for (const [signalId, category] of Object.entries(result.signalCategories)) {
      entries.set(signalId, category)
    }
  }
  return Object.fromEntries([...entries.entries()].sort(([left], [right]) => left.localeCompare(right)))
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
      .filter(([signalId, category]) => requested.size > 0 ? requested.has(signalId) : selectedCategorySet.has(category))
      .map(([signalId]) => signalId)
      .sort((left, right) => left.localeCompare(right)),
  )
}
