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

export type TimeSeriesFileFingerprint = {
  readonly dev: bigint
  readonly ino: bigint
  readonly size: bigint
  readonly mtimeNs: bigint
  readonly ctimeNs: bigint
}

export type TimeSeriesEntriesState = {
  readonly entries: ReadonlyArray<TimeSeriesEntry>
  readonly fingerprint: TimeSeriesFileFingerprint | undefined
}

export type OnEntriesRead = (state: TimeSeriesEntriesState) => void

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
  readonly getExistingState?: () => TimeSeriesEntriesState | undefined
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
      const existingState = await readTimeSeriesEntriesUsingState(
        args.repoPath,
        args.filePath,
        args.getExistingState?.(),
        args.onEntriesRead === undefined
          ? undefined
          : { onEntriesRead: args.onEntriesRead },
      )
      const existing = existingState.entries
      const duplicate = existing.find(
        (entry) =>
          entry.sha === args.entry.sha ||
          entry.aggregate?.commit_shas.includes(args.entry.sha) === true,
      )
      if (duplicate !== undefined) {
        return { status: "duplicate", entry: duplicate }
      }

      const cacheOwnedEntry = freezeTimeSeriesEntry(args.entry)
      const next = [...existing, cacheOwnedEntry].sort(compareTimeSeriesEntries)
      let nextStored: ReadonlyArray<TimeSeriesEntry> = Object.freeze(next)
      let expectedSize: bigint
      if (next.length > args.compactionThreshold) {
        const compacted = compactTimeSeriesEntries(next, args.rawRetentionDays)
        nextStored = freezeTimeSeriesEntries(compacted)
        const nextRaw = encodeTimeSeriesEntries(compacted)
        await writeFile(args.filePath, nextRaw, "utf8")
        expectedSize = BigInt(Buffer.byteLength(nextRaw, "utf8"))
      } else {
        const appendedRaw = `${JSON.stringify(args.entry)}\n`
        await appendFile(args.filePath, appendedRaw, "utf8")
        expectedSize =
          (existingState.fingerprint?.size ?? 0n) + BigInt(Buffer.byteLength(appendedRaw, "utf8"))
      }

      args.onPersistedState?.(
        await stateForPersistedEntries(args.repoPath, args.filePath, nextStored, expectedSize),
      )

      return { status: "written", entry: args.entry }
    },
  )
}

export const readTimeSeriesEntriesWithState = async (
  repoPath: string,
  filePath: string,
  existingState?: TimeSeriesEntriesState,
): Promise<TimeSeriesEntriesState> => {
  return readTimeSeriesEntriesUsingState(repoPath, filePath, existingState)
}

const statTimeSeriesFile = async (
  repoPath: string,
  filePath: string,
): Promise<TimeSeriesFileFingerprint | undefined> => {
  try {
    const stats = await stat(filePath, { bigint: true })
    return {
      dev: stats.dev,
      ino: stats.ino,
      size: stats.size,
      mtimeNs: stats.mtimeNs,
      ctimeNs: stats.ctimeNs,
    }
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return undefined
    throw new TimeSeriesReadFailed({
      repoPath,
      filePath,
      message: String(error),
    })
  }
}

const timeSeriesFingerprintsEqual = (
  left: TimeSeriesFileFingerprint | undefined,
  right: TimeSeriesFileFingerprint | undefined,
): boolean => {
  if (left === undefined || right === undefined) return left === right
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

const stateForPersistedEntries = async (
  repoPath: string,
  filePath: string,
  entries: ReadonlyArray<TimeSeriesEntry>,
  expectedSize: bigint,
): Promise<TimeSeriesEntriesState> => {
  const fingerprint = await statTimeSeriesFile(repoPath, filePath)
  // A size mismatch means a non-cooperative writer interleaved with our write;
  // rebuild from disk instead of caching entries for bytes we never saw.
  // Accepted limit: a same-size rewrite landing between our write and this
  // stat is indistinguishable from our own bytes; it surfaces on the next
  // fingerprint-changing write.
  if (fingerprint !== undefined && fingerprint.size === expectedSize) {
    return { entries, fingerprint }
  }
  return readTimeSeriesEntriesUncached(repoPath, filePath)
}

const readTimeSeriesEntriesUsingState = async (
  repoPath: string,
  filePath: string,
  existingState: TimeSeriesEntriesState | undefined,
  options?: {
    readonly onEntriesRead?: OnEntriesRead
  },
): Promise<TimeSeriesEntriesState> => {
  const fingerprint = await statTimeSeriesFile(repoPath, filePath)
  if (
    existingState !== undefined &&
    timeSeriesFingerprintsEqual(existingState.fingerprint, fingerprint)
  ) {
    return existingState
  }

  const nextState = await readTimeSeriesEntriesUncached(repoPath, filePath)
  options?.onEntriesRead?.(nextState)
  return nextState
}

const readTimeSeriesEntriesUncached = async (
  repoPath: string,
  filePath: string,
): Promise<TimeSeriesEntriesState> => {
  // Pair the decoded bytes with the stat observed around the read; if an
  // external write lands mid-read, retry once so the cache never pairs a
  // fingerprint with content it did not consistently observe. A ledger that
  // keeps changing across both attempts fails instead of blessing torn bytes.
  for (let attempt = 0; attempt < 2; attempt++) {
    const before = await statTimeSeriesFile(repoPath, filePath)
    const raw = await readTimeSeriesRaw(repoPath, filePath)
    const after = await statTimeSeriesFile(repoPath, filePath)
    if (timeSeriesFingerprintsEqual(before, after)) {
      return { entries: decodeTimeSeriesEntries(repoPath, filePath, raw), fingerprint: after }
    }
  }
  throw new TimeSeriesReadFailed({
    repoPath,
    filePath,
    message: `Ledger changed while reading ${filePath}`,
  })
}

const readTimeSeriesRaw = async (
  repoPath: string,
  filePath: string,
): Promise<string> => {
  let raw: string
  try {
    raw = await readFile(filePath, "utf8")
  } catch (error) {
    if (errorCodeOf(error) === "ENOENT") return ""
    throw new TimeSeriesReadFailed({
      repoPath,
      filePath,
      message: String(error),
    })
  }
  return raw
}

const decodeTimeSeriesEntries = (
  repoPath: string,
  filePath: string,
  raw: string,
): ReadonlyArray<TimeSeriesEntry> => {
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
  return freezeTimeSeriesEntries(entries.sort(compareTimeSeriesEntries))
}

const freezeTimeSeriesEntries = (
  entries: ReadonlyArray<TimeSeriesEntry>,
): ReadonlyArray<TimeSeriesEntry> =>
  Object.freeze(entries.map(freezeTimeSeriesEntry))

const freezeTimeSeriesEntry = (entry: TimeSeriesEntry): TimeSeriesEntry =>
  freezeJsonValue(entry) as TimeSeriesEntry

const freezeJsonValue = (value: unknown): unknown => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) freezeJsonValue(child)
  return Object.freeze(value)
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

const encodeTimeSeriesEntries = (entries: ReadonlyArray<TimeSeriesEntry>): string =>
  entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n"

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

const errorCodeOf = (error: unknown): string | undefined =>
  typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined
