import { Effect, Option, Schema } from "effect"
import { Diagnostic as DiagnosticSchema } from "./diagnostic.js"
import {
  ObserverOutput as ObserverOutputSchema,
  type ObserverOutput,
} from "./observer.js"

export const TIME_SERIES_DIRECTORY = ".pulsar/time-series" as const
export const DEFAULT_TIME_SERIES_COMPACTION_THRESHOLD = 10_000
export const DEFAULT_TIME_SERIES_RAW_RETENTION_DAYS = 90

export class TimeSeriesReadFailed extends Schema.TaggedError<TimeSeriesReadFailed>()(
  "TimeSeriesReadFailed",
  {
    repoPath: Schema.String,
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

export class TimeSeriesWriteFailed extends Schema.TaggedError<TimeSeriesWriteFailed>()(
  "TimeSeriesWriteFailed",
  {
    repoPath: Schema.String,
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

export class TimeSeriesLockFailed extends Schema.TaggedError<TimeSeriesLockFailed>()(
  "TimeSeriesLockFailed",
  {
    repoPath: Schema.String,
    filePath: Schema.String,
    message: Schema.String,
  },
) {}

export type TimeSeriesError =
  | TimeSeriesReadFailed
  | TimeSeriesWriteFailed
  | TimeSeriesLockFailed

export const TimeSeriesAggregate = Schema.Struct({
  kind: Schema.Literal("weekly-average"),
  from: Schema.String,
  to: Schema.String,
  sample_count: Schema.Number,
  commit_shas: Schema.Array(Schema.String),
  observer_semantics: Schema.optional(
    Schema.Literal("readiness-aware", "legacy-compatibility"),
  ),
  readiness_sample_count: Schema.optional(Schema.Number),
  compatibility_reason: Schema.optional(Schema.String),
})
export type TimeSeriesAggregate = typeof TimeSeriesAggregate.Type

const SignalDiagnostics = Schema.Record({
  key: Schema.String,
  value: Schema.Array(DiagnosticSchema),
})
type SignalDiagnostics = typeof SignalDiagnostics.Type

export const TimeSeriesEntry = Schema.Struct({
  sha: Schema.String,
  timestamp: Schema.String,
  observerOutput: ObserverOutputSchema,
  signalDiagnostics: Schema.optional(SignalDiagnostics),
  inactiveSignals: Schema.optional(Schema.Array(Schema.String)),
  source: Schema.Literal("raw", "weekly-average"),
  aggregate: Schema.optional(TimeSeriesAggregate),
})
export type TimeSeriesEntry = typeof TimeSeriesEntry.Type

export interface TimeSeriesRange {
  readonly from?: string
  readonly to?: string
}

export interface TimeSeriesReader {
  readonly entries: (
    range?: TimeSeriesRange,
  ) => Effect.Effect<ReadonlyArray<TimeSeriesEntry>, TimeSeriesError>
  readonly latest: Effect.Effect<Option.Option<TimeSeriesEntry>, TimeSeriesError>
  readonly atSha: (
    sha: string,
  ) => Effect.Effect<Option.Option<TimeSeriesEntry>, TimeSeriesError>
}

export interface TimeSeriesAppendResult {
  readonly status: "written" | "duplicate"
  readonly entry: TimeSeriesEntry
}

export type TimeSeriesEntrySubscriber = (
  entry: TimeSeriesEntry,
) => void | Promise<void>

export interface TimeSeriesWriter {
  readonly append: (
    entry: TimeSeriesEntry,
  ) => Effect.Effect<TimeSeriesAppendResult, TimeSeriesError>
  readonly appendObservation: (
    sha: string,
    observerOutput: ObserverOutput,
  ) => Effect.Effect<TimeSeriesAppendResult, TimeSeriesError>
  readonly onEntry: (subscriber: TimeSeriesEntrySubscriber) => void
}

export interface TimeSeriesServices {
  readonly repoId: string
  readonly filePath: string
  readonly reader: TimeSeriesReader
  readonly writer: TimeSeriesWriter
}

export interface TimeSeriesOptions {
  readonly repoId?: string
  readonly compactionThreshold?: number
  readonly rawRetentionDays?: number
  readonly lockTimeoutMs?: number
  readonly lockRetryMs?: number
}

export const signalDiagnosticsFromObserver = (
  observerOutput: ObserverOutput,
): SignalDiagnostics =>
  Object.fromEntries(
    [...observerOutput.signalResults.entries()]
      .filter(([, result]) => result.diagnostics.length > 0)
      .map(([signalId, result]) => [signalId, result.diagnostics]),
  )
