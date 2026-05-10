import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { promisify } from "node:util"
import {
  CATEGORIES,
  isActive as vectorIsActive,
  timeSeriesConfigOf,
  type Category,
  type MinimumDimension,
  type ObserverOutput,
  type Registry,
  type SignalRunResult,
} from "@skastr0/pulsar-core"
import { Effect } from "effect"
import { loadPulsarVectorFromPath, makePulsarRuntime } from "./runtime.js"
import {
  chooseAdaptiveMidpoint,
  chooseObserverAdaptiveMidpoint,
  sampleTrajectory,
  type BisectSamplingMode,
  type BisectSamplingSummary,
  type RangeCommit,
} from "./bisect-sampling.js"

export {
  chooseAdaptiveMidpoint,
  chooseObserverAdaptiveMidpoint,
  initialAdaptiveIndexes,
  resolveSamplingPlan,
  selectMergeOnlyIndexes,
} from "./bisect-sampling.js"
export type {
  BisectSamplingMode,
  BisectSamplingSummary,
  RangeCommit,
} from "./bisect-sampling.js"

const execFileAsync = promisify(execFile)

export interface BisectOptions {
  readonly signalId?: string
  readonly observer?: boolean
  readonly vectorPath?: string
  readonly selectedSignals?: ReadonlyArray<string>
  readonly selectedCategories?: ReadonlyArray<Category>
  readonly firstCrossing?: FirstCrossingQuery
  readonly fromSha: string
  readonly toSha: string
  readonly repoPath: string
  readonly concurrency: number
  readonly topCulprits: number
  readonly sampling: BisectSamplingMode
  readonly json: boolean
}

interface ScorePoint {
  readonly sha: string
  readonly score: number
}

export interface FirstCrossingQuery {
  readonly target: string
  readonly op: "<" | "<=" | ">" | ">="
  readonly threshold: number
}

export interface FirstCrossingResult extends FirstCrossingQuery {
  readonly sha: string
  readonly previousSha: string | undefined
  readonly previousScore: number | undefined
  readonly score: number
}

export interface CommitScore extends ScorePoint {
  readonly diagnosticsCount: number
  readonly firstDiagnostic: string | undefined
}

export interface Culprit {
  readonly sha: string
  readonly prevSha: string
  readonly prevScore: number
  readonly newScore: number
  readonly drop: number
}

export interface BisectReport {
  readonly schemaVersion: "signal-bisect/v2"
  readonly signalId: string
  readonly repoPath: string
  readonly fromSha: string
  readonly toSha: string
  readonly trajectory: ReadonlyArray<CommitScore>
  readonly culprits: ReadonlyArray<Culprit>
  readonly driftCulprits: ReadonlyArray<Culprit>
  readonly sampling: BisectSamplingSummary
  readonly minScore: number
  readonly maxScore: number
  readonly finalScore: number
  readonly totalDrift: number
  readonly firstCrossing: FirstCrossingResult | undefined
}

export interface ObserverCommitMinimum {
  readonly signal: string
  readonly category: Category
  readonly score: number
}

export interface CategoryTrajectory {
  readonly scores: ReadonlyArray<number>
  readonly min: number
  readonly max: number
  readonly final: number
  readonly drift: number
  readonly distinctLevels: number
}

export interface SignalTrajectory {
  readonly category: Category
  readonly scores: ReadonlyArray<number | null>
  readonly observedCount: number
  readonly min: number | undefined
  readonly max: number | undefined
  readonly final: number | undefined
  readonly drift: number | undefined
  readonly distinctLevels: number
}

export interface ObserverCommitEntry {
  readonly sha: string
  readonly weightedMean: number
  readonly readinessScore: number | undefined
  readonly readinessPressure: number | undefined
  readonly readinessStatus:
    | NonNullable<ObserverOutput["readiness"]>["status"]
    | undefined
  readonly categories: Record<Category, number>
  readonly categorySignalCounts: Record<Category, number>
  readonly categoryApplicableSignalCounts: Record<Category, number>
  readonly applicableSignalCount: number
  readonly signals: Record<string, number>
  readonly minimum: ObserverCommitMinimum | undefined
  readonly hardGateStatus: "pass" | "fail"
  readonly hardGateViolationCount: number
}

interface ObserverCurveSample extends ObserverCommitEntry {
  readonly signalCategories: Record<string, Category>
}

export interface ObserverBisectReport {
  readonly schemaVersion: "observer-bisect/v2"
  readonly repoPath: string
  readonly fromSha: string
  readonly toSha: string
  readonly vectorName: string | null
  readonly trajectory: ReadonlyArray<ObserverCommitEntry>
  readonly commits: ReadonlyArray<string>
  readonly curves: ObserverCurveSet
  readonly signalCategories: Record<string, Category>
  readonly perCategory: Record<Category, CategoryTrajectory>
  readonly perSignal: Record<string, SignalTrajectory>
  readonly weightedMeanCulprits: ReadonlyArray<Culprit>
  readonly weightedMeanDriftCulprits: ReadonlyArray<Culprit>
  readonly perCategoryCulprits: Record<Category, ReadonlyArray<Culprit>>
  readonly perCategoryDriftCulprits: Record<Category, ReadonlyArray<Culprit>>
  readonly perSignalCulprits: Record<string, ReadonlyArray<Culprit>>
  readonly perSignalDriftCulprits: Record<string, ReadonlyArray<Culprit>>
  readonly readinessCulprits: ReadonlyArray<Culprit>
  readonly readinessDriftCulprits: ReadonlyArray<Culprit>
  readonly sampling: BisectSamplingSummary
  readonly finalReadinessScore: number | undefined
  readonly minReadinessScore: number | undefined
  readonly maxReadinessScore: number | undefined
  readonly readinessDrift: number | undefined
  readonly finalApplicableSignalCount: number
  readonly finalWeightedMean: number
  readonly minWeightedMean: number
  readonly maxWeightedMean: number
  readonly totalDrift: number
  readonly finalMinimumDimension: ObserverCommitMinimum | undefined
  readonly hardGateStatusAtFinal: "pass" | "fail"
  readonly firstCrossing: FirstCrossingResult | undefined
  readonly selectedSignals: ReadonlyArray<string>
  readonly selectedCategories: ReadonlyArray<Category>
}

export interface ObserverCurveSet {
  readonly weightedMean: ReadonlyArray<number>
  readonly readiness: ReadonlyArray<number | null>
  readonly categories: Partial<Record<Category, ReadonlyArray<number>>>
  readonly signals: Record<string, ReadonlyArray<number | null>>
}

export const runBisectCommand = (opts: BisectOptions) =>
  Effect.gen(function* () {
    const repoPath = resolve(opts.repoPath)
    if (!existsSync(repoPath)) {
      return yield* Effect.fail(new Error(`Path does not exist: ${repoPath}`))
    }

    const vector = yield* loadPulsarVectorFromPath(opts.vectorPath)
    const { engine, registry } = yield* makePulsarRuntime(repoPath, vector, {
      timeSeries: {
        enabled: opts.observer === true || opts.signalId === undefined || timeSeriesConfigOf(vector).enabled,
      },
    })
    const observerMode = opts.observer === true || opts.signalId === undefined

    if (observerMode) {
      const activeSignalIds = registry.sorted
        .filter((signal) => vectorIsActive(signal, vector))
        .map((signal) => signal.id)
      if (activeSignalIds.length === 0) {
        const vectorSuffix = vector?.id ? ` for vector ${vector.id}` : ""
        return yield* Effect.fail(
          new Error(`Observer mode has no active signals${vectorSuffix}.`),
        )
      }

      const started = Date.now()
      const commits = yield* resolveBisectCommits(repoPath, opts.fromSha, opts.toSha)
      const sampled = yield* sampleObserverTrajectory(
        commits,
        opts.sampling,
        opts.firstCrossing !== undefined,
        opts.concurrency,
        (sha) => engine.observeCommit(repoPath, sha),
      )
      const elapsedMs = Date.now() - started
      const selectedSignals = (opts.selectedSignals ?? []).map(
        (signalId) => registry.canonicalIdOf(signalId) ?? signalId,
      )
      const report = buildObserverReport(sampled.trajectory, {
        repoPath,
        fromSha: opts.fromSha,
        toSha: opts.toSha,
        topCulprits: opts.topCulprits,
        vectorName: vector?.id ?? null,
        sampling: sampled.sampling,
        selectedSignals,
        selectedCategories: opts.selectedCategories ?? [],
        firstCrossing: canonicalizeFirstCrossingQuery(opts.firstCrossing, registry),
      })
      if (opts.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      printObserverHumanReport(report, elapsedMs, report.finalApplicableSignalCount)
      return
    }

    const started = Date.now()
    const commits = yield* resolveBisectCommits(repoPath, opts.fromSha, opts.toSha)
    const sampled = yield* sampleSignalTrajectory(
      commits,
      opts.sampling,
      opts.firstCrossing !== undefined,
      opts.concurrency,
      (sha) => engine.scoreCommit(repoPath, sha, opts.signalId!),
    )
    const elapsedMs = Date.now() - started

    const culprits = findCulprits(sampled.trajectory, opts.topCulprits)
    const driftCulprits = findDriftCulprits(sampled.trajectory, opts.topCulprits)
    const scores = summarizeScores(sampled.trajectory.map((t) => t.score))

    const report: BisectReport = {
      schemaVersion: "signal-bisect/v2",
      signalId: opts.signalId,
      repoPath,
      fromSha: opts.fromSha,
      toSha: opts.toSha,
      trajectory: sampled.trajectory,
      culprits,
      driftCulprits,
      sampling: sampled.sampling,
      minScore: scores.min,
      maxScore: scores.max,
      finalScore: scores.final,
      totalDrift: scores.drift,
      firstCrossing:
        opts.firstCrossing === undefined
          ? undefined
          : findFirstCrossing(sampled.trajectory, opts.firstCrossing),
    }

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    printHumanReport(report, elapsedMs)
  })

const buildObserverReport = (
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
  const readinessCulprits = findCulprits(readinessTrajectory, opts.topCulprits)
  const readinessDriftCulprits = findDriftCulprits(readinessTrajectory, opts.topCulprits)
  const weightedMeanCulprits = findCulprits(
    trajectory.map((entry) => ({ sha: entry.sha, score: entry.weightedMean })),
    opts.topCulprits,
  )
  const weightedMeanDriftCulprits = findDriftCulprits(
    trajectory.map((entry) => ({ sha: entry.sha, score: entry.weightedMean })),
    opts.topCulprits,
  )

  const perCategory = Object.fromEntries(
    selectedCategories.map((category) => [
      category,
      summarizeCategoryTrajectory(
        trajectory.map((entry) => entry.categories[category]),
      ),
    ]),
  ) as Record<Category, CategoryTrajectory>

  const perCategoryCulprits = Object.fromEntries(
    selectedCategories.map((category) => [
      category,
      findCulprits(
        trajectory.map((entry) => ({ sha: entry.sha, score: entry.categories[category] })),
        opts.topCulprits,
      ),
    ]),
  ) as Record<Category, ReadonlyArray<Culprit>>
  const perCategoryDriftCulprits = Object.fromEntries(
    selectedCategories.map((category) => [
      category,
      findDriftCulprits(
        trajectory.map((entry) => ({ sha: entry.sha, score: entry.categories[category] })),
        opts.topCulprits,
      ),
    ]),
  ) as Record<Category, ReadonlyArray<Culprit>>

  const perSignal = Object.fromEntries(
    Object.entries(signalCategories)
      .filter(([signalId]) => selectedSignalSet.has(signalId))
      .map(([signalId, category]) => [
      signalId,
      summarizeSignalTrajectory(category, nullableSignalScores(trajectory, signalId)),
    ]),
  )
  const perSignalCulprits = Object.fromEntries(
    [...selectedSignalSet].map((signalId) => [
      signalId,
      findCulprits(signalScorePoints(trajectory, signalId), opts.topCulprits),
    ]),
  )
  const perSignalDriftCulprits = Object.fromEntries(
    [...selectedSignalSet].map((signalId) => [
      signalId,
      findDriftCulprits(signalScorePoints(trajectory, signalId), opts.topCulprits),
    ]),
  )

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
    perSignal,
    weightedMeanCulprits,
    weightedMeanDriftCulprits,
    perCategoryCulprits,
    perCategoryDriftCulprits,
    perSignalCulprits,
    perSignalDriftCulprits,
    readinessCulprits,
    readinessDriftCulprits,
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

const toObserverCurveSample = (
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

const summarizeCategoryTrajectory = (
  scores: ReadonlyArray<number>,
): CategoryTrajectory => {
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

const canonicalizeFirstCrossingQuery = (
  query: FirstCrossingQuery | undefined,
  registry: Registry,
): FirstCrossingQuery | undefined => {
  if (query === undefined) return undefined
  return { ...query, target: registry.canonicalIdOf(query.target) ?? query.target }
}

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
  const entries = Object.entries(signalCategories)
    .filter(([signalId, category]) => {
      if (requested.size > 0) return requested.has(signalId)
      return selectedCategorySet.has(category)
    })
    .map(([signalId]) => signalId)
    .sort((left, right) => left.localeCompare(right))
  return new Set(entries)
}

const compactObserverTrajectory = (
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

const filterCategoryRecord = <Value>(
  record: Record<Category, Value>,
  categories: ReadonlySet<Category>,
): Record<Category, Value> =>
  Object.fromEntries(
    Object.entries(record).filter(([category]) => categories.has(category as Category)),
  ) as Record<Category, Value>

const buildObserverCurves = (
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

const resolveCrossingPoints = (
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

export const findFirstCrossing = <T extends ScorePoint>(
  trajectory: ReadonlyArray<T>,
  query: FirstCrossingQuery,
): FirstCrossingResult | undefined => {
  for (let index = 0; index < trajectory.length; index += 1) {
    const point = trajectory[index]!
    if (!matchesCrossing(point.score, query.op, query.threshold)) continue
    const previous = trajectory[index - 1]
    return {
      ...query,
      sha: point.sha,
      previousSha: previous?.sha,
      previousScore: previous?.score,
      score: point.score,
    }
  }
  return undefined
}

const matchesCrossing = (
  score: number,
  op: FirstCrossingQuery["op"],
  threshold: number,
): boolean => {
  switch (op) {
    case "<":
      return score < threshold
    case "<=":
      return score <= threshold
    case ">":
      return score > threshold
    case ">=":
      return score >= threshold
  }
}

const resolveBisectCommits = (
  repoPath: string,
  fromSha: string,
  toSha: string,
): Effect.Effect<ReadonlyArray<RangeCommit>, Error> =>
  Effect.tryPromise({
    try: async () => {
      const result = await execFileAsync(
        "git",
        ["rev-list", "--reverse", "--parents", `${fromSha}..${toSha}`],
        { cwd: repoPath },
      )
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const parts = line.split(/\s+/)
          return {
            sha: parts[0]!,
            parentCount: Math.max(0, parts.length - 1),
          }
        })
    },
    catch: (cause) => new Error(`git rev-list ${fromSha}..${toSha} failed: ${String(cause)}`),
  })

const sampleSignalTrajectory = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  hasFirstCrossing: boolean,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<SignalRunResult, unknown, never>,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<CommitScore>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  sampleTrajectory(
    commits,
    requested,
    hasFirstCrossing,
    concurrency,
    scoreCommit,
    (sha, result) => ({
      sha,
      score: result.score,
      diagnosticsCount: result.diagnostics.length,
      firstDiagnostic: result.diagnostics[0]?.message,
    }),
    (leftIndex, rightIndex, leftEntry, rightEntry) =>
      chooseAdaptiveMidpoint(leftIndex, rightIndex, leftEntry.score, rightEntry.score),
  )

const sampleObserverTrajectory = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  hasFirstCrossing: boolean,
  concurrency: number,
  observeCommit: (sha: string) => Effect.Effect<ObserverOutput, unknown, never>,
): Effect.Effect<
  {
    readonly trajectory: ReadonlyArray<ObserverCurveSample>
    readonly sampling: BisectSamplingSummary
  },
  unknown,
  never
> =>
  sampleTrajectory(
    commits,
    requested,
    hasFirstCrossing,
    concurrency,
    observeCommit,
    toObserverCurveSample,
    chooseObserverAdaptiveMidpoint,
  )

const summarizeScores = (
  scores: ReadonlyArray<number>,
): {
  readonly min: number
  readonly max: number
  readonly final: number
  readonly drift: number
  readonly distinctLevels: number
} => {
  if (scores.length === 0) {
    return { min: 1, max: 1, final: 1, drift: 0, distinctLevels: 0 }
  }

  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const final = scores[scores.length - 1] ?? 1
  const distinctLevels = new Set(scores.map((score) => score.toFixed(6))).size
  return {
    min,
    max,
    final,
    drift: max - final,
    distinctLevels,
  }
}

/**
 * Rank the top-N commits by adjacent-pair score drop. Note: this
 * definition only surfaces commits where a single step introduced the
 * regression. Gradual drift across many commits (no single large step)
 * is captured by `totalDrift` in the report, not by this list.
 */
export const findCulprits = <T extends ScorePoint>(
  trajectory: ReadonlyArray<T>,
  topN: number,
): ReadonlyArray<Culprit> => {
  const drops: Array<Culprit> = []
  for (let i = 1; i < trajectory.length; i += 1) {
    const prev = trajectory[i - 1]!
    const cur = trajectory[i]!
    const drop = prev.score - cur.score
    if (drop <= 0) continue
    drops.push({
      sha: cur.sha,
      prevSha: prev.sha,
      prevScore: prev.score,
      newScore: cur.score,
      drop,
    })
  }
  drops.sort((a, b) => b.drop - a.drop)
  return drops.slice(0, topN)
}

export const findDriftCulprits = <T extends ScorePoint>(
  trajectory: ReadonlyArray<T>,
  topN: number,
): ReadonlyArray<Culprit> => {
  if (trajectory.length <= 1) return []

  let runningMax = trajectory[0]?.score ?? 1
  let activeAnchor: Culprit | undefined
  const activeSegment = new Map<string, Culprit>()

  for (let index = 1; index < trajectory.length; index += 1) {
    const prev = trajectory[index - 1]!
    const cur = trajectory[index]!

    if (cur.score >= runningMax) {
      runningMax = Math.max(runningMax, cur.score)
      activeAnchor = undefined
      activeSegment.clear()
      continue
    }

    const adjacentDrop = prev.score - cur.score
    if (adjacentDrop > 0) {
      const existing = activeSegment.get(cur.sha)
      activeAnchor = {
        sha: cur.sha,
        prevSha: prev.sha,
        prevScore: prev.score,
        newScore: cur.score,
        drop: existing?.drop ?? 0,
      }
      activeSegment.set(cur.sha, activeAnchor)
    }

    if (activeAnchor === undefined) continue

    const deficit = runningMax - cur.score
    const current = activeSegment.get(activeAnchor.sha)
    if (current === undefined) continue
    activeSegment.set(activeAnchor.sha, {
      ...current,
      drop: current.drop + deficit,
    })
  }

  return [...activeSegment.values()].sort((a, b) => b.drop - a.drop).slice(0, topN)
}

const printHumanReport = (report: BisectReport, elapsedMs: number): void => {
  const lines: Array<string> = []
  lines.push("")
  lines.push(`  Repo:    ${report.repoPath}`)
  lines.push(`  Signal:  ${report.signalId}`)
  lines.push(`  Range:   ${report.fromSha}..${report.toSha}`)
  lines.push(`  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`)
  if (report.sampling.scoredCommits !== report.sampling.totalCommits) {
    lines.push(
      `  Sample:  ${report.sampling.applied} (${report.sampling.scoredCommits}/${report.sampling.totalCommits} commits scored)`,
    )
  }
  for (const diagnostic of report.sampling.diagnostics) {
    lines.push(`  Note:    ${diagnostic}`)
  }
  lines.push("")
  lines.push(
    `  Scores:  min ${report.minScore.toFixed(3)}   max ${report.maxScore.toFixed(3)}   final ${report.finalScore.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  )
  if (report.firstCrossing !== undefined) {
    lines.push(
      `  First crossing: ${report.firstCrossing.target} ${report.firstCrossing.op} ${report.firstCrossing.threshold} at ${report.firstCrossing.sha.slice(0, 8)} (${report.firstCrossing.score.toFixed(3)})`,
    )
  }
  lines.push("")
  lines.push("  Trajectory (oldest → newest):")
  for (const t of report.trajectory) {
    const bar = renderScoreBar(t.score)
    lines.push(`    ${t.sha.slice(0, 8)}  ${t.score.toFixed(3)}  ${bar}  (${t.diagnosticsCount} diag)`)
  }
  lines.push("")
  if (report.culprits.length === 0) {
    lines.push("  No score-degrading commits in range.")
  } else {
    lines.push(`  Top ${report.culprits.length} culprit commits (largest score drops):`)
    for (const c of report.culprits) {
      lines.push(
        `    ${c.sha.slice(0, 8)}  drop ${c.drop.toFixed(3)}   ${c.prevScore.toFixed(3)} → ${c.newScore.toFixed(3)}  (from ${c.prevSha.slice(0, 8)})`,
      )
    }
  }
  if (shouldPrintDriftCulprits(report.culprits, report.driftCulprits)) {
    lines.push("")
    lines.push(`  Top ${report.driftCulprits.length} drift culprits (sustained deficit):`)
    for (const culprit of report.driftCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drift ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  lines.push("")
  for (const line of lines) console.log(line)
}

const printObserverHumanReport = (
  report: ObserverBisectReport,
  elapsedMs: number,
  applicableSignalCount: number,
): void => {
  const finalEntry = report.trajectory[report.trajectory.length - 1]
  const lines = [
    ...observerHeaderLines(report, elapsedMs, applicableSignalCount),
    ...observerScoreSummaryLines(report, finalEntry),
    ...observerCategoryScoreLines(report, finalEntry),
    ...observerCategorySummaryLines(report),
    ...culpritSectionLines(
      "readiness",
      report.readinessCulprits,
      "No readiness degrading commits in range.",
    ),
    ...driftCulpritSectionLines(
      "readiness",
      report.readinessCulprits,
      report.readinessDriftCulprits,
    ),
    ...culpritSectionLines(
      "evidence-mean",
      report.weightedMeanCulprits,
      "No evidence-mean degrading commits in range.",
    ),
    ...driftCulpritSectionLines(
      "evidence-mean",
      report.weightedMeanCulprits,
      report.weightedMeanDriftCulprits,
    ),
    ...perCategoryLeaderLines(report),
    ...signalLeaderLines(report),
    ...firstCrossingLines(report),
    "",
  ]
  for (const line of lines) console.log(line)
}

const observerHeaderLines = (
  report: ObserverBisectReport,
  elapsedMs: number,
  applicableSignalCount: number,
): ReadonlyArray<string> => {
  const lines = [
    "",
    `  Repo:    ${report.repoPath}`,
    "  Mode:    observer",
    ...(report.vectorName === null ? [] : [`  Vector:  ${report.vectorName}`]),
    `  Range:   ${report.fromSha}..${report.toSha}`,
    `  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`,
  ]
  if (report.sampling.scoredCommits !== report.sampling.totalCommits) {
    lines.push(
      `  Sample:  ${report.sampling.applied} (${report.sampling.scoredCommits}/${report.sampling.totalCommits} commits scored)`,
    )
  }
  lines.push(`  Evidence: ${applicableSignalCount} applicable signals`)
  lines.push(...report.sampling.diagnostics.map((diagnostic) => `  Note:    ${diagnostic}`))
  return lines
}

const observerScoreSummaryLines = (
  report: ObserverBisectReport,
  finalEntry: ObserverCommitEntry | undefined,
): ReadonlyArray<string> => [
  "",
  ...(report.finalReadinessScore === undefined
    ? []
    : [
        `  Readiness: min ${report.minReadinessScore?.toFixed(3) ?? "n/a"}   max ${report.maxReadinessScore?.toFixed(3) ?? "n/a"}   final ${report.finalReadinessScore.toFixed(3)}   drift ${report.readinessDrift?.toFixed(3) ?? "n/a"}   pressure ${finalEntry?.readinessPressure?.toFixed(3) ?? "n/a"} ${finalEntry?.readinessStatus ?? ""}`,
      ]),
  `  Evidence mean: min ${report.minWeightedMean.toFixed(3)}   max ${report.maxWeightedMean.toFixed(3)}   final ${report.finalWeightedMean.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  `  Final hard gate: ${report.hardGateStatusAtFinal}`,
  ...(report.finalMinimumDimension === undefined
    ? []
    : [
        `  Final minimum dimension: ${report.finalMinimumDimension.signal} / ${report.finalMinimumDimension.category} @ ${report.finalMinimumDimension.score.toFixed(3)}`,
      ]),
]

const observerCategoryScoreLines = (
  report: ObserverBisectReport,
  finalEntry: ObserverCommitEntry | undefined,
): ReadonlyArray<string> => [
  "",
  "  HEAD category scores:",
  ...report.selectedCategories.map((category) => {
    const score = finalEntry?.categories[category] ?? 1
    const signalCount = countFinalApplicableSignalsByCategory(finalEntry, category)
    return `    ${padCategory(category)}  ${score.toFixed(3)}  ${renderScoreBar(score)}  (${signalCount} applicable)`
  }),
]

const observerCategorySummaryLines = (
  report: ObserverBisectReport,
): ReadonlyArray<string> => [
  "",
  "  Category trajectory summary:",
  ...report.selectedCategories.map((category) => {
    const summary = report.perCategory[category]
    return `    ${padCategory(category)}  min ${summary.min.toFixed(3)}   max ${summary.max.toFixed(3)}   final ${summary.final.toFixed(3)}   drift ${summary.drift.toFixed(3)}   levels ${summary.distinctLevels}`
  }),
  "",
]

const culpritSectionLines = (
  label: string,
  culprits: ReadonlyArray<Culprit>,
  emptyMessage: string,
): ReadonlyArray<string> =>
  culprits.length === 0
    ? [emptyMessage]
    : [
        `  Top ${culprits.length} ${label} culprit commits:`,
        ...culprits.map((culprit) => `    ${formatCulprit(culprit, "drop")}`),
      ]

const driftCulpritSectionLines = (
  label: string,
  adjacent: ReadonlyArray<Culprit>,
  drift: ReadonlyArray<Culprit>,
): ReadonlyArray<string> =>
  shouldPrintDriftCulprits(adjacent, drift)
    ? [
        "",
        `  Top ${drift.length} ${label} drift culprits:`,
        ...drift.map((culprit) => `    ${formatCulprit(culprit, "drift")}`),
        "",
      ]
    : [""]

const formatCulprit = (culprit: Culprit, label: "drop" | "drift"): string =>
  `${culprit.sha.slice(0, 8)}  ${label} ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`

const perCategoryLeaderLines = (report: ObserverBisectReport): ReadonlyArray<string> => [
  "  Per-category culprit leaders:",
  ...report.selectedCategories.map((category) => {
    const culprit = report.perCategoryCulprits[category][0]
    if (culprit === undefined) return `    ${padCategory(category)}  none`
    return `    ${padCategory(category)}  ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}  (${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)})`
  }),
]

const signalLeaderLines = (report: ObserverBisectReport): ReadonlyArray<string> => {
  const signalLeaders = Object.entries(report.perSignalCulprits)
    .map(([signalId, culprits]) => ({ signalId, culprit: culprits[0] }))
    .filter(
      (entry): entry is { signalId: string; culprit: Culprit } =>
        entry.culprit !== undefined,
    )
    .sort((a, b) => b.culprit.drop - a.culprit.drop)
    .slice(0, 5)
  if (signalLeaders.length === 0) return []
  return [
    "",
    `  Top ${signalLeaders.length} signal culprit leaders:`,
    ...signalLeaders.map(
      ({ signalId, culprit }) =>
        `    ${signalId.padEnd(10, " ")}  ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}  (${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)})`,
    ),
  ]
}

const firstCrossingLines = (report: ObserverBisectReport): ReadonlyArray<string> =>
  report.firstCrossing === undefined
    ? []
    : [
        "",
        `  First crossing: ${report.firstCrossing.target} ${report.firstCrossing.op} ${report.firstCrossing.threshold} at ${report.firstCrossing.sha.slice(0, 8)} (${report.firstCrossing.score.toFixed(3)})`,
      ]

const padCategory = (category: Category): string => category.padEnd(20, " ")

export const countFinalApplicableSignalsByCategory = (
  finalEntry: ObserverCommitEntry | undefined,
  category: Category,
): number => {
  if (finalEntry === undefined) return 0
  return finalEntry.categoryApplicableSignalCounts[category]
}

const shouldPrintDriftCulprits = (
  adjacent: ReadonlyArray<Culprit>,
  drift: ReadonlyArray<Culprit>,
): boolean => {
  if (drift.length === 0) return false
  if (adjacent.length !== drift.length) return true
  return adjacent.some((culprit, index) => culprit.sha !== drift[index]?.sha)
}

const renderScoreBar = (score: number): string => {
  const width = 20
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}
