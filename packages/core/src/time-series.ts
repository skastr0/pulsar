import { execFile } from "node:child_process"
import { realpathSync } from "node:fs"
import { appendFile, mkdir, open, readFile, rm, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { promisify } from "node:util"
import { Effect, Option, Schema } from "effect"
import {
  Diagnostic as DiagnosticSchema,
  type Diagnostic,
} from "./diagnostic.js"
import {
  ObserverOutput as ObserverOutputSchema,
  toObserverJson,
  type ObserverOutput,
} from "./observer.js"
import { compactTimeSeriesEntries } from "./time-series-compaction.js"
import {
  applyTimeRange,
  compareTimeSeriesEntries,
} from "./time-series-dates.js"

const execFileAsync = promisify(execFile)

export const TIME_SERIES_DIRECTORY = ".pulsar/time-series" as const
export const DEFAULT_TIME_SERIES_COMPACTION_THRESHOLD = 10_000
export const DEFAULT_TIME_SERIES_RAW_RETENTION_DAYS = 90
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_LOCK_RETRY_MS = 25

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
  readonly atSha: (sha: string) => Effect.Effect<Option.Option<TimeSeriesEntry>, TimeSeriesError>
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

export const defaultTimeSeriesRepoId = (repoPath: string): string =>
  basename(repoPath).replace(/[^A-Za-z0-9._-]+/g, "-") || "repo"

export const resolveTimeSeriesPath = (repoPath: string, repoId: string): string =>
  join(repoPath, TIME_SERIES_DIRECTORY, `${repoId}.jsonl`)

export const createTimeSeriesServices = (
  repoPath: string,
  options?: TimeSeriesOptions,
): TimeSeriesServices => {
  const canonicalRepoPath = normalizeRepoPath(repoPath)
  const repoId = options?.repoId ?? defaultTimeSeriesRepoId(canonicalRepoPath)
  const filePath = resolveTimeSeriesPath(canonicalRepoPath, repoId)
  const subscribers: Array<TimeSeriesEntrySubscriber> = []

  const readEntriesEffect = (range?: TimeSeriesRange) =>
    Effect.tryPromise({
      try: async () => {
        const entries = await readTimeSeriesEntries(canonicalRepoPath, filePath)
        return applyTimeRange(entries, range)
      },
      catch: (cause) =>
        normalizeTimeSeriesError(canonicalRepoPath, filePath, cause, "read"),
    })

  const reader: TimeSeriesReader = {
    entries: (range) => readEntriesEffect(range),
    latest: readEntriesEffect().pipe(
      Effect.map((entries) => Option.fromNullable(entries.at(-1))),
    ),
    atSha: (sha) =>
      readEntriesEffect().pipe(
        Effect.map((entries) =>
          Option.fromNullable(
            entries.find(
              (entry) =>
                entry.sha === sha ||
                entry.aggregate?.commit_shas.includes(sha) === true,
            ),
          ),
        ),
      ),
  }

  const writer: TimeSeriesWriter = {
    append: (entry) =>
      Effect.tryPromise({
        try: async () => {
          const normalized = Schema.decodeUnknownSync(TimeSeriesEntry)(entry)
          const result = await appendTimeSeriesEntry({
            repoPath: canonicalRepoPath,
            filePath,
            entry: normalized,
            compactionThreshold:
              options?.compactionThreshold ?? DEFAULT_TIME_SERIES_COMPACTION_THRESHOLD,
            rawRetentionDays:
              options?.rawRetentionDays ?? DEFAULT_TIME_SERIES_RAW_RETENTION_DAYS,
            lockTimeoutMs: options?.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
            lockRetryMs: options?.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS,
          })
          if (result.status === "written") {
            for (const subscriber of subscribers) {
              await subscriber(result.entry)
            }
          }
          return result
        },
        catch: (cause) =>
          normalizeTimeSeriesError(canonicalRepoPath, filePath, cause, "write"),
      }),
    appendObservation: (sha, observerOutput) =>
      Effect.tryPromise({
        try: async () => {
          const timestamp = await readCommitTimestamp(canonicalRepoPath, filePath, sha)
          return await Effect.runPromise(
            writer.append({
              sha,
              timestamp,
              observerOutput: toObserverJson(observerOutput),
              signalDiagnostics: signalDiagnosticsFromObserver(observerOutput),
              inactiveSignals: [...observerOutput.inactiveSignals],
              source: "raw",
            }),
          )
        },
        catch: (cause) =>
          normalizeTimeSeriesError(canonicalRepoPath, filePath, cause, "write"),
      }),
    onEntry: (subscriber) => {
      subscribers.push(subscriber)
    },
  }

  return { repoId, filePath, reader, writer }
}

const normalizeRepoPath = (repoPath: string): string => {
  try {
    return realpathSync.native(repoPath)
  } catch {
    return repoPath
  }
}

const readCommitTimestamp = async (
  repoPath: string,
  filePath: string,
  sha: string,
): Promise<string> => {
  try {
    const result = await execFileAsync("git", ["show", "-s", "--format=%cI", sha], {
      cwd: repoPath,
    })
    return result.stdout.trim()
  } catch (error) {
    throw new TimeSeriesWriteFailed({
      repoPath,
      filePath,
      message: `git show failed for ${sha}: ${String(error)}`,
    })
  }
}

const signalDiagnosticsFromObserver = (
  observerOutput: ObserverOutput,
): Record<string, ReadonlyArray<Diagnostic>> =>
  Object.fromEntries(
    [...observerOutput.signalResults.entries()]
      .filter(([, result]) => result.diagnostics.length > 0)
      .map(([signalId, result]) => [signalId, result.diagnostics]),
  )

const appendTimeSeriesEntry = async (args: {
  readonly repoPath: string
  readonly filePath: string
  readonly entry: TimeSeriesEntry
  readonly compactionThreshold: number
  readonly rawRetentionDays: number
  readonly lockTimeoutMs: number
  readonly lockRetryMs: number
}): Promise<TimeSeriesAppendResult> => {
  await mkdir(join(args.repoPath, TIME_SERIES_DIRECTORY), { recursive: true })
  return withTimeSeriesLock(
    args.repoPath,
    args.filePath,
    args.lockTimeoutMs,
    args.lockRetryMs,
    async () => {
      const existing = await readTimeSeriesEntries(args.repoPath, args.filePath)
      const duplicate = existing.find(
        (entry) =>
          entry.sha === args.entry.sha ||
          entry.aggregate?.commit_shas.includes(args.entry.sha) === true,
      )
      if (duplicate !== undefined) {
        return { status: "duplicate", entry: duplicate }
      }

      const next = [...existing, args.entry].sort(compareTimeSeriesEntries)
      if (next.length > args.compactionThreshold) {
        const compacted = compactTimeSeriesEntries(next, args.rawRetentionDays)
        await writeTimeSeriesEntries(args.filePath, compacted)
      } else {
        await appendFile(args.filePath, `${JSON.stringify(args.entry)}\n`, "utf8")
      }

      return { status: "written", entry: args.entry }
    },
  )
}

const withTimeSeriesLock = async <A>(
  repoPath: string,
  filePath: string,
  timeoutMs: number,
  retryMs: number,
  run: () => Promise<A>,
): Promise<A> => {
  const lockPath = `${filePath}.lock`
  const start = Date.now()

  while (true) {
    let handle: Awaited<ReturnType<typeof open>> | undefined
    try {
      handle = await open(lockPath, "wx")
      await handle.close()
      break
    } catch (error) {
      const code = errorCodeOf(error)
      if (code !== "EEXIST") {
        throw new TimeSeriesLockFailed({
          repoPath,
          filePath,
          message: String(error),
        })
      }
      if (Date.now() - start >= timeoutMs) {
        throw new TimeSeriesLockFailed({
          repoPath,
          filePath,
          message: `Timed out waiting for ${lockPath}`,
        })
      }
      await sleep(retryMs)
      continue
    }
  }

  try {
    return await run()
  } finally {
    await rm(lockPath, { force: true }).catch(() => undefined)
  }
}

const readTimeSeriesEntries = async (
  repoPath: string,
  filePath: string,
): Promise<ReadonlyArray<TimeSeriesEntry>> => {
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return []
    throw new TimeSeriesReadFailed({
      repoPath,
      filePath,
      message: String(error),
    })
  }

  const entries: Array<TimeSeriesEntry> = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      entries.push(Schema.decodeUnknownSync(TimeSeriesEntry)(JSON.parse(trimmed)))
    } catch (error) {
      throw new TimeSeriesReadFailed({
        repoPath,
        filePath,
        message: `Invalid JSONL entry: ${String(error)}`,
      })
    }
  }
  return entries.sort(compareTimeSeriesEntries)
}

const writeTimeSeriesEntries = async (
  filePath: string,
  entries: ReadonlyArray<TimeSeriesEntry>,
): Promise<void> => {
  await writeFile(
    filePath,
    entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
    "utf8",
  )
}

const normalizeTimeSeriesError = (
  repoPath: string,
  filePath: string,
  cause: unknown,
  phase: "read" | "write",
): TimeSeriesError => {
  if (
    cause instanceof TimeSeriesReadFailed ||
    cause instanceof TimeSeriesWriteFailed ||
    cause instanceof TimeSeriesLockFailed
  ) {
    return cause
  }
  if (phase === "read") {
    return new TimeSeriesReadFailed({
      repoPath,
      filePath,
      message: String(cause),
    })
  }
  return new TimeSeriesWriteFailed({
    repoPath,
    filePath,
    message: String(cause),
  })
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
