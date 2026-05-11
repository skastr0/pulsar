import type { PulsarVector } from "@skastr0/pulsar-core/vector"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import type {
  Registry,
  SignalRunResult,
} from "@skastr0/pulsar-core/scoring"
import type { Category } from "@skastr0/pulsar-core/signal"
import type { Effect } from "effect"
import type { BisectSamplingMode } from "./bisect-sampling.js"

export type {
  BisectReport,
  CommitScore,
  Culprit,
  FirstCrossingResult,
  ScorePoint,
  SignalBisectOptions,
} from "./bisect-signal-types.js"
export type {
  CategoryTrajectory,
  ObserverBisectReport,
  ObserverCommitEntry,
  ObserverCommitMinimum,
  ObserverCurveSample,
  ObserverCurveSet,
  SignalTrajectory,
} from "./bisect-observer-types.js"

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

export interface FirstCrossingQuery {
  readonly target: string
  readonly op: "<" | "<=" | ">" | ">="
  readonly threshold: number
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
