import type { BisectSamplingSummary } from "./bisect-sampling.js"
import type {
  BisectOptions,
  FirstCrossingQuery,
} from "./bisect-types.js"

export interface ScorePoint {
  readonly sha: string
  readonly score: number
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

export type SignalBisectOptions = BisectOptions & { readonly signalId: string }
