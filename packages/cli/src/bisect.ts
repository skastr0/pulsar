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
  type SignalRunResult,
} from "@skastr0/pulsar-core"
import { Effect } from "effect"
import { loadPulsarVectorFromPath, makePulsarRuntime } from "./runtime.js"

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

export type BisectSamplingMode =
  | "auto"
  | "full"
  | "merge-only"
  | "adaptive-delta"

export interface BisectSamplingSummary {
  readonly requested: BisectSamplingMode
  readonly applied: Exclude<BisectSamplingMode, "auto">
  readonly totalCommits: number
  readonly scoredCommits: number
  readonly diagnostics: ReadonlyArray<string>
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
      const report = buildObserverReport(sampled.trajectory, {
        repoPath,
        fromSha: opts.fromSha,
        toSha: opts.toSha,
        topCulprits: opts.topCulprits,
        vectorName: vector?.id ?? null,
        sampling: sampled.sampling,
        selectedSignals: opts.selectedSignals ?? [],
        selectedCategories: opts.selectedCategories ?? [],
        firstCrossing: opts.firstCrossing,
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

interface RangeCommit {
  readonly sha: string
  readonly parentCount: number
}

const AUTO_FULL_RANGE_THRESHOLD = 500
const ADAPTIVE_INITIAL_SAMPLES = 17
const ADAPTIVE_MAX_GAP = 64
const ADAPTIVE_DELTA_THRESHOLD = 0.08
const ADAPTIVE_MAX_SCORED_COMMITS = 1025

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

const sampleTrajectory = <Result, Entry extends { readonly sha: string }>(
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  hasFirstCrossing: boolean,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
  chooseMidpoint: (
    leftIndex: number,
    rightIndex: number,
    leftEntry: Entry,
    rightEntry: Entry,
  ) => number | undefined,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<Entry>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  Effect.gen(function* () {
    const plan = resolveSamplingPlan(commits, requested, { hasFirstCrossing })
    if (plan.applied === "full") {
      const trajectory = yield* scoreTrajectoryIndexes(
        allIndexes(commits.length),
        commits,
        concurrency,
        scoreCommit,
        toEntry,
      )
      return {
        trajectory,
        sampling: {
          requested,
          applied: "full",
          totalCommits: commits.length,
          scoredCommits: trajectory.length,
          diagnostics: plan.diagnostics,
        },
      }
    }

    if (plan.applied === "merge-only") {
      const indexes = selectMergeOnlyIndexes(commits)
      const trajectory = yield* scoreTrajectoryIndexes(
        indexes,
        commits,
        concurrency,
        scoreCommit,
        toEntry,
      )
      return {
        trajectory,
        sampling: {
          requested,
          applied: "merge-only",
          totalCommits: commits.length,
          scoredCommits: trajectory.length,
          diagnostics: plan.diagnostics,
        },
      }
    }

    const scored = new Map<number, Entry>()
    let pending = new Set(initialAdaptiveIndexes(commits.length))
    let capped = false

    while (pending.size > 0) {
      const batch = yield* scoreTrajectoryIndexes(
        [...pending],
        commits,
        concurrency,
        scoreCommit,
        toEntry,
      )
      for (const entry of batch) {
        const index = commits.findIndex((commit) => commit.sha === entry.sha)
        if (index >= 0) scored.set(index, entry)
      }

      const next = new Set<number>()
      const orderedIndexes = [...scored.keys()].sort((a, b) => a - b)
      for (let i = 1; i < orderedIndexes.length; i += 1) {
        const leftIndex = orderedIndexes[i - 1]!
        const rightIndex = orderedIndexes[i]!
        const leftEntry = scored.get(leftIndex)!
        const rightEntry = scored.get(rightIndex)!
        const midpoint = chooseMidpoint(leftIndex, rightIndex, leftEntry, rightEntry)
        if (midpoint === undefined || scored.has(midpoint)) continue
        if (scored.size + next.size >= ADAPTIVE_MAX_SCORED_COMMITS) {
          capped = true
          break
        }
        next.add(midpoint)
      }

      pending = next
      if (capped) break
    }

    const trajectory = [...scored.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, entry]) => entry)

    return {
      trajectory,
      sampling: {
        requested,
        applied: "adaptive-delta",
        totalCommits: commits.length,
        scoredCommits: trajectory.length,
        diagnostics: capped
          ? [...plan.diagnostics, `adaptive-delta stopped at ${ADAPTIVE_MAX_SCORED_COMMITS} sampled commits`] 
          : plan.diagnostics,
      },
    }
  })

const scoreTrajectoryIndexes = <Result, Entry extends { readonly sha: string }>(
  indexes: ReadonlyArray<number>,
  commits: ReadonlyArray<RangeCommit>,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
): Effect.Effect<ReadonlyArray<Entry>, unknown, never> => {
  const uniqueIndexes = [...new Set(indexes)].sort((a, b) => a - b)
  return Effect.forEach(
    uniqueIndexes,
    (index) => {
      const commit = commits[index]
      if (commit === undefined) {
        return Effect.die(new Error(`Missing commit metadata for index ${index}`))
      }
      return scoreCommit(commit.sha).pipe(
        Effect.map((result) => toEntry(commit.sha, result)),
      )
    },
    { concurrency },
  )
}

export const resolveSamplingPlan = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  opts: { readonly hasFirstCrossing?: boolean } = {},
): { readonly applied: Exclude<BisectSamplingMode, "auto">; readonly diagnostics: ReadonlyArray<string> } => {
  if (requested === "full") {
    return { applied: "full", diagnostics: [] }
  }

  if (requested === "auto") {
    if (opts.hasFirstCrossing === true) {
      return {
        applied: "full",
        diagnostics: [
          "auto sampling chose full because first-crossing queries require exact commit order",
        ],
      }
    }
    if (commits.length <= AUTO_FULL_RANGE_THRESHOLD) {
      return { applied: "full", diagnostics: [] }
    }
    return {
      applied: "adaptive-delta",
      diagnostics: [
        `auto sampling chose adaptive-delta because the range has ${commits.length} commits`,
        "adaptive-delta can miss smaller local drops; rerun with --sample full to confirm an exact culprit",
      ],
    }
  }

  if (requested === "merge-only") {
    const indexes = selectMergeOnlyIndexes(commits)
    if (indexes.length >= Math.max(2, commits.length)) {
      return { applied: "full", diagnostics: ["merge-only matched the full range; using full sampling instead"] }
    }
    if (indexes.length < 2) {
      return {
        applied: "full",
        diagnostics: ["merge-only found too few merge commits; using full sampling instead"],
      }
    }
    return {
      applied: "merge-only",
      diagnostics: [
        "merge-only includes the range endpoints plus merge commits only",
        "non-merge culprit commits can be skipped; rerun with --sample full to confirm an exact culprit",
        ...(opts.hasFirstCrossing === true
          ? ["first-crossing under merge-only sampling is approximate; rerun with --sample full for exact crossing"]
          : []),
      ],
    }
  }

  return {
    applied: "adaptive-delta",
    diagnostics: [
      `adaptive-delta started from ${ADAPTIVE_INITIAL_SAMPLES} evenly spaced samples`,
      "adaptive-delta refines only where sampled deltas stay large or commit gaps stay wide",
      ...(opts.hasFirstCrossing === true
        ? ["first-crossing under adaptive-delta sampling is approximate; rerun with --sample full for exact crossing"]
        : []),
    ],
  }
}

const allIndexes = (length: number): ReadonlyArray<number> =>
  Array.from({ length }, (_, index) => index)

export const selectMergeOnlyIndexes = (
  commits: ReadonlyArray<RangeCommit>,
): ReadonlyArray<number> => {
  if (commits.length === 0) return []
  const indexes = new Set<number>([0, commits.length - 1])
  for (let index = 0; index < commits.length; index += 1) {
    if ((commits[index]?.parentCount ?? 0) > 1) {
      indexes.add(index)
    }
  }
  return [...indexes].sort((a, b) => a - b)
}

export const initialAdaptiveIndexes = (length: number): ReadonlyArray<number> => {
  if (length <= ADAPTIVE_INITIAL_SAMPLES) return allIndexes(length)
  const indexes = new Set<number>([0, length - 1])
  for (let step = 1; step < ADAPTIVE_INITIAL_SAMPLES - 1; step += 1) {
    const ratio = step / (ADAPTIVE_INITIAL_SAMPLES - 1)
    indexes.add(Math.round((length - 1) * ratio))
  }
  return [...indexes].sort((a, b) => a - b)
}

export const chooseAdaptiveMidpoint = (
  leftIndex: number,
  rightIndex: number,
  leftScore: number,
  rightScore: number,
): number | undefined => {
  const gap = rightIndex - leftIndex
  if (gap <= 1) return undefined
  const delta = Math.abs(leftScore - rightScore)
  if (gap <= ADAPTIVE_MAX_GAP && delta < ADAPTIVE_DELTA_THRESHOLD) {
    return undefined
  }
  return leftIndex + Math.floor(gap / 2)
}

export const chooseObserverAdaptiveMidpoint = (
  leftIndex: number,
  rightIndex: number,
  leftEntry: { readonly weightedMean: number; readonly readinessScore: number | undefined },
  rightEntry: { readonly weightedMean: number; readonly readinessScore: number | undefined },
): number | undefined => {
  const gap = rightIndex - leftIndex
  if (gap <= 1) return undefined
  if (gap > ADAPTIVE_MAX_GAP) return leftIndex + Math.floor(gap / 2)

  const weightedMeanDelta = Math.abs(leftEntry.weightedMean - rightEntry.weightedMean)
  const readinessDelta =
    leftEntry.readinessScore === undefined || rightEntry.readinessScore === undefined
      ? undefined
      : Math.abs(leftEntry.readinessScore - rightEntry.readinessScore)
  if (
    weightedMeanDelta < ADAPTIVE_DELTA_THRESHOLD &&
    (readinessDelta === undefined || readinessDelta < ADAPTIVE_DELTA_THRESHOLD)
  ) {
    return undefined
  }
  return leftIndex + Math.floor(gap / 2)
}

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
  const lines: Array<string> = []
  const finalEntry = report.trajectory[report.trajectory.length - 1]

  lines.push("")
  lines.push(`  Repo:    ${report.repoPath}`)
  lines.push("  Mode:    observer")
  if (report.vectorName !== null) {
    lines.push(`  Vector:  ${report.vectorName}`)
  }
  lines.push(`  Range:   ${report.fromSha}..${report.toSha}`)
  lines.push(`  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`)
  if (report.sampling.scoredCommits !== report.sampling.totalCommits) {
    lines.push(
      `  Sample:  ${report.sampling.applied} (${report.sampling.scoredCommits}/${report.sampling.totalCommits} commits scored)`,
    )
  }
  lines.push(`  Evidence: ${applicableSignalCount} applicable signals`)
  for (const diagnostic of report.sampling.diagnostics) {
    lines.push(`  Note:    ${diagnostic}`)
  }
  lines.push("")
  if (report.finalReadinessScore !== undefined) {
    lines.push(
      `  Readiness: min ${report.minReadinessScore?.toFixed(3) ?? "n/a"}   max ${report.maxReadinessScore?.toFixed(3) ?? "n/a"}   final ${report.finalReadinessScore.toFixed(3)}   drift ${report.readinessDrift?.toFixed(3) ?? "n/a"}   pressure ${finalEntry?.readinessPressure?.toFixed(3) ?? "n/a"} ${finalEntry?.readinessStatus ?? ""}`,
    )
  }
  lines.push(
    `  Evidence mean: min ${report.minWeightedMean.toFixed(3)}   max ${report.maxWeightedMean.toFixed(3)}   final ${report.finalWeightedMean.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  )
  lines.push(`  Final hard gate: ${report.hardGateStatusAtFinal}`)
  if (report.finalMinimumDimension !== undefined) {
    lines.push(
      `  Final minimum dimension: ${report.finalMinimumDimension.signal} / ${report.finalMinimumDimension.category} @ ${report.finalMinimumDimension.score.toFixed(3)}`,
    )
  }
  lines.push("")
  lines.push("  HEAD category scores:")
  for (const category of report.selectedCategories) {
    const score = finalEntry?.categories[category] ?? 1
    const signalCount = countFinalApplicableSignalsByCategory(finalEntry, category)
    lines.push(
      `    ${padCategory(category)}  ${score.toFixed(3)}  ${renderScoreBar(score)}  (${signalCount} applicable)`,
    )
  }
  lines.push("")
  lines.push("  Category trajectory summary:")
  for (const category of report.selectedCategories) {
    const summary = report.perCategory[category]
    lines.push(
      `    ${padCategory(category)}  min ${summary.min.toFixed(3)}   max ${summary.max.toFixed(3)}   final ${summary.final.toFixed(3)}   drift ${summary.drift.toFixed(3)}   levels ${summary.distinctLevels}`,
    )
  }
  lines.push("")
  if (report.readinessCulprits.length === 0) {
    lines.push("  No readiness degrading commits in range.")
  } else {
    lines.push(`  Top ${report.readinessCulprits.length} readiness culprit commits:`)
    for (const culprit of report.readinessCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  if (shouldPrintDriftCulprits(report.readinessCulprits, report.readinessDriftCulprits)) {
    lines.push("")
    lines.push(`  Top ${report.readinessDriftCulprits.length} readiness drift culprits:`)
    for (const culprit of report.readinessDriftCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drift ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  lines.push("")
  if (report.weightedMeanCulprits.length === 0) {
    lines.push("  No evidence-mean degrading commits in range.")
  } else {
    lines.push(`  Top ${report.weightedMeanCulprits.length} evidence-mean culprit commits:`)
    for (const culprit of report.weightedMeanCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  if (shouldPrintDriftCulprits(report.weightedMeanCulprits, report.weightedMeanDriftCulprits)) {
    lines.push("")
    lines.push(
      `  Top ${report.weightedMeanDriftCulprits.length} evidence-mean drift culprits:`,
    )
    for (const culprit of report.weightedMeanDriftCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drift ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  lines.push("")
  lines.push("  Per-category culprit leaders:")
  for (const category of report.selectedCategories) {
    const culprit = report.perCategoryCulprits[category][0]
    if (culprit === undefined) {
      lines.push(`    ${padCategory(category)}  none`)
      continue
    }
    lines.push(
      `    ${padCategory(category)}  ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}  (${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)})`,
    )
  }
  const signalLeaders = Object.entries(report.perSignalCulprits)
    .map(([signalId, culprits]) => ({ signalId, culprit: culprits[0] }))
    .filter(
      (entry): entry is { signalId: string; culprit: Culprit } =>
        entry.culprit !== undefined,
    )
    .sort((a, b) => b.culprit.drop - a.culprit.drop)
    .slice(0, 5)
  if (signalLeaders.length > 0) {
    lines.push("")
    lines.push(`  Top ${signalLeaders.length} signal culprit leaders:`)
    for (const { signalId, culprit } of signalLeaders) {
      lines.push(
        `    ${signalId.padEnd(10, " ")}  ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}  (${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)})`,
      )
    }
  }
  if (report.firstCrossing !== undefined) {
    lines.push("")
    lines.push(
      `  First crossing: ${report.firstCrossing.target} ${report.firstCrossing.op} ${report.firstCrossing.threshold} at ${report.firstCrossing.sha.slice(0, 8)} (${report.firstCrossing.score.toFixed(3)})`,
    )
  }
  lines.push("")
  for (const line of lines) console.log(line)
}

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
