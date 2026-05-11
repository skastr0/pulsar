import { type Registry } from "@skastr0/pulsar-core/scoring"
import { type Category } from "@skastr0/pulsar-core/signal"
import {
  findCulprits,
  findDriftCulprits,
  findFirstCrossing,
  summarizeScores,
} from "./bisect-signal-report.js"
import {
  resolveCrossingPoints,
} from "./bisect-observer-shape.js"
import {
  observerCulpritPayload,
  observerTrajectoryPayload,
  resolveObserverReportScope,
  summarizeReadinessTrajectory,
} from "./bisect-observer-report-payload.js"
import type {
  FirstCrossingQuery,
  ObserverBisectReport,
  ObserverCurveSample,
} from "./bisect-types.js"
import type { BisectSamplingSummary } from "./bisect-sampling.js"

export type ObserverReportOptions = {
  readonly repoPath: string
  readonly fromSha: string
  readonly toSha: string
  readonly topCulprits: number
  readonly vectorName: string | null
  readonly sampling: BisectSamplingSummary
  readonly selectedSignals: ReadonlyArray<string>
  readonly selectedCategories: ReadonlyArray<Category>
  readonly firstCrossing: FirstCrossingQuery | undefined
}

export const buildObserverReport = (
  results: ReadonlyArray<ObserverCurveSample>,
  opts: ObserverReportOptions,
): ObserverBisectReport => {
  const scope = resolveObserverReportScope(results, opts)
  const weightedMeanScores = summarizeScores(scope.trajectory.map((entry) => entry.weightedMean))
  const readiness = summarizeReadinessTrajectory(scope.trajectory)
  const finalEntry = scope.trajectory[scope.trajectory.length - 1]

  return {
    schemaVersion: "observer-bisect/v2",
    repoPath: opts.repoPath,
    fromSha: opts.fromSha,
    toSha: opts.toSha,
    vectorName: opts.vectorName,
    ...observerTrajectoryPayload(scope),
    ...observerCulpritPayload(scope, opts.topCulprits),
    readinessCulprits: findCulprits(readiness.trajectory, opts.topCulprits),
    readinessDriftCulprits: findDriftCulprits(readiness.trajectory, opts.topCulprits),
    sampling: opts.sampling,
    finalReadinessScore: readiness.scores?.final,
    minReadinessScore: readiness.scores?.min,
    maxReadinessScore: readiness.scores?.max,
    readinessDrift: readiness.scores?.drift,
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
        : findFirstCrossing(resolveCrossingPoints(scope.trajectory, opts.firstCrossing.target), opts.firstCrossing),
    selectedSignals: [...scope.selectedSignalSet],
    selectedCategories: scope.selectedCategories,
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
): ObserverReportOptions => ({
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

const canonicalizeFirstCrossingQuery = (
  query: FirstCrossingQuery | undefined,
  registry: Registry,
): FirstCrossingQuery | undefined => query === undefined
  ? undefined
  : { ...query, target: registry.canonicalIdOf(query.target) ?? query.target }
