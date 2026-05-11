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
  type PulsarVector,
  type Registry,
  type SignalRunResult,
} from "@skastr0/pulsar-core"
import { Effect } from "effect"
import { loadPulsarVectorFromPath, makePulsarRuntime } from "./runtime.js"
import {
  printHumanReport,
  printJsonReport,
  printObserverHumanReport,
} from "./bisect-output.js"
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
export { countFinalApplicableSignalsByCategory } from "./bisect-output.js"

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

    const runtime = { engine, registry, vector, repoPath }
    return observerMode
      ? yield* runObserverBisect(opts, runtime)
      : yield* runSignalBisect({ ...opts, signalId: opts.signalId! }, runtime)
  })

interface BisectCommandRuntime {
  readonly engine: {
    readonly observeCommit: (
      repoPath: string,
      sha: string,
    ) => Effect.Effect<ObserverOutput, unknown, never>
    readonly scoreCommit: (
      repoPath: string,
      sha: string,
      signalId: string,
    ) => Effect.Effect<SignalRunResult, unknown, never>
  }
  readonly registry: Registry
  readonly vector: PulsarVector | undefined
  readonly repoPath: string
}

type SignalBisectOptions = BisectOptions & { readonly signalId: string }

const runObserverBisect = (
  opts: BisectOptions,
  runtime: BisectCommandRuntime,
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function* () {
    yield* ensureObserverHasActiveSignals(runtime.registry, runtime.vector)
    const started = Date.now()
    const commits = yield* resolveBisectCommits(runtime.repoPath, opts.fromSha, opts.toSha)
    const sampled = yield* sampleObserverTrajectory(
      commits,
      opts.sampling,
      opts.firstCrossing !== undefined,
      opts.concurrency,
      (sha) => runtime.engine.observeCommit(runtime.repoPath, sha),
    )
    const report = buildObserverReport(sampled.trajectory, observerReportOptions(opts, runtime, sampled.sampling))
    if (opts.json) return printJsonReport(report)
    printObserverHumanReport(report, Date.now() - started, report.finalApplicableSignalCount)
  })

const ensureObserverHasActiveSignals = (
  registry: Registry,
  vector: PulsarVector | undefined,
): Effect.Effect<void, Error, never> =>
  Effect.sync(() =>
    registry.sorted.filter((signal) => vectorIsActive(signal, vector)).map((signal) => signal.id),
  ).pipe(
    Effect.flatMap((activeSignalIds) =>
      activeSignalIds.length > 0
        ? Effect.void
        : Effect.fail(
            new Error(
              `Observer mode has no active signals${vector?.id ? ` for vector ${vector.id}` : ""}.`,
            ),
          ),
    ),
  )

const observerReportOptions = (
  opts: BisectOptions,
  runtime: BisectCommandRuntime,
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

const runSignalBisect = (
  opts: SignalBisectOptions,
  runtime: BisectCommandRuntime,
): Effect.Effect<void, unknown, never> =>
  Effect.gen(function* () {
    const started = Date.now()
    const commits = yield* resolveBisectCommits(runtime.repoPath, opts.fromSha, opts.toSha)
    const sampled = yield* sampleSignalTrajectory(
      commits,
      opts.sampling,
      opts.firstCrossing !== undefined,
      opts.concurrency,
      (sha) => runtime.engine.scoreCommit(runtime.repoPath, sha, opts.signalId),
    )
    const report = buildSignalBisectReport(opts, runtime.repoPath, sampled)
    if (opts.json) return printJsonReport(report)
    printHumanReport(report, Date.now() - started)
  })

const buildSignalBisectReport = (
  opts: SignalBisectOptions,
  repoPath: string,
  sampled: {
    readonly trajectory: ReadonlyArray<CommitScore>
    readonly sampling: BisectSamplingSummary
  },
): BisectReport => {
  const scores = summarizeScores(sampled.trajectory.map((t) => t.score))
  return {
    schemaVersion: "signal-bisect/v2",
    signalId: opts.signalId,
    repoPath,
    fromSha: opts.fromSha,
    toSha: opts.toSha,
    trajectory: sampled.trajectory,
    culprits: findCulprits(sampled.trajectory, opts.topCulprits),
    driftCulprits: findDriftCulprits(sampled.trajectory, opts.topCulprits),
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
}

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
