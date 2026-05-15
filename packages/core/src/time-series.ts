import { execFile } from "node:child_process"
import { realpathSync } from "node:fs"
import { basename } from "node:path"
import { promisify } from "node:util"
import { Effect, Option, Schema } from "effect"
import { toObserverJson } from "./observer.js"
import {
  DEFAULT_TIME_SERIES_COMPACTION_THRESHOLD,
  DEFAULT_TIME_SERIES_RAW_RETENTION_DAYS,
  TIME_SERIES_DIRECTORY,
  TimeSeriesEntry,
  TimeSeriesWriteFailed,
  signalDiagnosticsFromObserver,
  type TimeSeriesEntrySubscriber,
  type TimeSeriesOptions,
  type TimeSeriesRange,
  type TimeSeriesReader,
  type TimeSeriesServices,
  type TimeSeriesWriter,
} from "./time-series-model.js"
export * from "./time-series-model.js"
import { applyTimeRange } from "./time-series-dates.js"
import { resolvePulsarRepoStatePath } from "./state-paths.js"
import {
  appendTimeSeriesEntry,
  DEFAULT_LOCK_RETRY_MS,
  DEFAULT_LOCK_TIMEOUT_MS,
  normalizeTimeSeriesError,
  readTimeSeriesEntries,
} from "./time-series-storage.js"

const execFileAsync = promisify(execFile)

export const defaultTimeSeriesRepoId = (repoPath: string): string =>
  basename(repoPath).replace(/[^A-Za-z0-9._-]+/g, "-") || "repo"

export const resolveTimeSeriesPath = (repoPath: string, repoId: string): string =>
  resolvePulsarRepoStatePath(repoPath, TIME_SERIES_DIRECTORY, `${repoId}.jsonl`)

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
