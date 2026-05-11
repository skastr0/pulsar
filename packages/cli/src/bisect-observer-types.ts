import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type { Category } from "@skastr0/pulsar-core/signal"
import type { BisectSamplingSummary } from "./bisect-sampling.js"
import type { FirstCrossingResult } from "./bisect-signal-types.js"
import type { Culprit } from "./bisect-signal-types.js"

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

export interface ObserverCurveSample extends ObserverCommitEntry {
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
