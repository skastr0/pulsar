import { Schema } from "effect"
import type {
  TimeSeriesLockFailed,
  TimeSeriesReadFailed,
  TimeSeriesWriteFailed,
} from "./time-series.js"

export class DuplicateSignalIdError extends Schema.TaggedError<DuplicateSignalIdError>()(
  "DuplicateSignalIdError",
  { id: Schema.String },
) {}

export class MissingDependencyError extends Schema.TaggedError<MissingDependencyError>()(
  "MissingDependencyError",
  {
    signalId: Schema.String,
    missingInputId: Schema.String,
  },
) {}

export class CycleDetectedError extends Schema.TaggedError<CycleDetectedError>()(
  "CycleDetectedError",
  { chain: Schema.Array(Schema.String) },
) {}

export class CompositionTooDeepError extends Schema.TaggedError<CompositionTooDeepError>()(
  "CompositionTooDeepError",
  {
    signalId: Schema.String,
    depth: Schema.Number,
    max: Schema.Number,
  },
) {}

export class UnknownSignalIdError extends Schema.TaggedError<UnknownSignalIdError>()(
  "UnknownSignalIdError",
  { id: Schema.String },
) {}

export class UnknownSignalFactorError extends Schema.TaggedError<UnknownSignalFactorError>()(
  "UnknownSignalFactorError",
  {
    signalId: Schema.String,
    factorPath: Schema.String,
  },
) {}

export class ConfigValidationError extends Schema.TaggedError<ConfigValidationError>()(
  "ConfigValidationError",
  {
    signalId: Schema.String,
    message: Schema.String,
  },
) {}

export class ReferenceDataMissingError extends Schema.TaggedError<ReferenceDataMissingError>()(
  "ReferenceDataMissingError",
  {
    signalId: Schema.String,
    key: Schema.String,
  },
) {}

export class ReferenceDataLoadFailed extends Schema.TaggedError<ReferenceDataLoadFailed>()(
  "ReferenceDataLoadFailed",
  {
    repoPath: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class RoutingPatternLoadFailed extends Schema.TaggedError<RoutingPatternLoadFailed>()(
  "RoutingPatternLoadFailed",
  {
    repoPath: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class SignalComputeError extends Schema.TaggedError<SignalComputeError>()(
  "SignalComputeError",
  {
    signalId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class WorktreeCreateFailed extends Schema.TaggedError<WorktreeCreateFailed>()(
  "WorktreeCreateFailed",
  {
    repoPath: Schema.String,
    sha: Schema.String,
    message: Schema.String,
  },
) {}

export class WorktreeRemoveFailed extends Schema.TaggedError<WorktreeRemoveFailed>()(
  "WorktreeRemoveFailed",
  {
    worktreePath: Schema.String,
    message: Schema.String,
  },
) {}

export class CommitNotFound extends Schema.TaggedError<CommitNotFound>()(
  "CommitNotFound",
  {
    repoPath: Schema.String,
    sha: Schema.String,
    message: Schema.String,
  },
) {}

export class GitRevListFailed extends Schema.TaggedError<GitRevListFailed>()(
  "GitRevListFailed",
  {
    repoPath: Schema.String,
    fromSha: Schema.String,
    toSha: Schema.String,
    message: Schema.String,
  },
) {}

export type RegistryError =
  | DuplicateSignalIdError
  | MissingDependencyError
  | CycleDetectedError
  | CompositionTooDeepError

export type SignalError =
  | UnknownSignalIdError
  | UnknownSignalFactorError
  | ConfigValidationError
  | ReferenceDataMissingError
  | SignalComputeError

export type ScoringEngineError =
  | WorktreeCreateFailed
  | WorktreeRemoveFailed
  | CommitNotFound
  | GitRevListFailed
  | ReferenceDataLoadFailed
  | TimeSeriesReadFailed
  | TimeSeriesWriteFailed
  | TimeSeriesLockFailed
