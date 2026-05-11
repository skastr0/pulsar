import type {
  Category,
  ObserverOutput,
  PulsarVector,
  Registry,
  SignalRunResult,
} from "@skastr0/pulsar-core"
import type { Effect } from "effect"
import type {
  BisectSamplingMode,
  BisectSamplingSummary,
} from "./bisect-sampling.js"

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

export interface ScorePoint {
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

export interface BisectCommandRuntime {
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

export type SignalBisectOptions = BisectOptions & { readonly signalId: string }
