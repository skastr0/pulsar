import { appendFile, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { Schema } from "effect"
import { compactTimeSeriesEntries } from "./time-series-compaction.js"
import {
  compareTimeSeriesEntries,
} from "./time-series-dates.js"
import {
  TimeSeriesEntry,
  TimeSeriesLockFailed,
  TimeSeriesReadFailed,
  TimeSeriesWriteFailed,
  type TimeSeriesAppendResult,
  type TimeSeriesError,
} from "./time-series-model.js"

export type FileFingerprint = {
  readonly size: number | undefined
  readonly mtimeMs: number | undefined
}

export type TimeSeriesEntriesState = {
  readonly entries: ReadonlyArray<TimeSeriesEntry>
  readonly fingerprint: FileFingerprint
}

export type OnEntriesRead = (state: FileFingerprint) => void

export type OnPersistedState = (state: TimeSeriesEntriesState) => void

export const DEFAULT_LOCK_TIMEOUT_MS = 5_000
export const DEFAULT_LOCK_RETRY_MS = 25

export const appendTimeSeriesEntry = async (args: {
  readonly repoPath: string
  readonly filePath: string
  readonly entry: TimeSeriesEntry
  readonly compactionThreshold: number
  readonly rawRetentionDays: number
  readonly lockTimeoutMs: number
  readonly lockRetryMs: number
  readonly existingState?: TimeSeriesEntriesState
  readonly onEntriesRead?: OnEntriesRead
  readonly onPersistedState?: OnPersistedState
}): Promise<TimeSeriesAppendResult> => {
  await mkdir(dirname(args.filePath), { recursive: true })
  return withTimeSeriesLock(
    args.repoPath,
    args.filePath,
    args.lockTimeoutMs,
    args.lockRetryMs,
    async () => {
      const existing = await readTimeSeriesEntriesUsingState(
        args.repoPath,
        args.filePath,
        args.existingState,
        {
          onEntriesRead: args.onEntriesRead,
        },
      )
      const duplicate = existing.find(
        (entry) =>
          entry.sha === args.entry.sha ||
          entry.aggregate?.commit_shas.includes(args.entry.sha) === true,
      )
      if (duplicate !== undefined) {
        return { status: "duplicate", entry: duplicate }
      }

      const next = [...existing, args.entry].sort(compareTimeSeriesEntries)
      let nextStored = next
      if (next.length > args.compactionThreshold) {
        const compacted = compactTimeSeriesEntries(next, args.rawRetentionDays)
        nextStored = compacted
        await writeTimeSeriesEntries(args.filePath, compacted)
      } else {
        await appendFile(args.filePath, `${JSON.stringify(args.entry)}\n`, "utf8")
      }

      const fingerprint = await readFileFingerprint(args.filePath)
      args.onPersistedState?.({ entries: nextStored, fingerprint })

      return { status: "written", entry: args.entry }
    },
  )
}

export const readTimeSeriesEntriesWithState = async (
  repoPath: string,
  filePath: string,
): Promise<TimeSeriesEntriesState> => {
  const entries = await readTimeSeriesEntries(repoPath, filePath)
  const fingerprint = await readFileFingerprint(filePath)
  return { entries, fingerprint }
}

export const readTimeSeriesEntries = async (
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

export const normalizeTimeSeriesError = (
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

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const readFileFingerprint = async (filePath: string): Promise<FileFingerprint> => {
  try {
    const metadata = await stat(filePath)
    return { size: metadata.size, mtimeMs: metadata.mtimeMs }
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return { size: undefined, mtimeMs: undefined }
    throw error
  }
}

const readTimeSeriesEntriesUsingState = async (
  repoPath: string,
  filePath: string,
  existingState: TimeSeriesEntriesState | undefined,
  options?: {
    readonly onEntriesRead?: OnEntriesRead
  },
): Promise<ReadonlyArray<TimeSeriesEntry>> => {
  if (existingState === undefined) {
    const fingerprint = await readFileFingerprint(filePath)
    options?.onEntriesRead?.(fingerprint)
    return readTimeSeriesEntries(repoPath, filePath)
  }

  const fingerprint = await readFileFingerprint(filePath)
  if (
    existingState.fingerprint.size === fingerprint.size &&
    existingState.fingerprint.mtimeMs === fingerprint.mtimeMs
  ) {
    return existingState.entries
  }

  options?.onEntriesRead?.(fingerprint)
  return readTimeSeriesEntries(repoPath, filePath)
}

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
