import { mkdir, appendFile, open, readdir, rename, rm, stat } from "node:fs/promises"
import { join } from "node:path"
import { Effect, Layer, Option } from "effect"
import {
  DEFAULT_CACHE_MAX_SIZE_BYTES,
  SignalCacheTag,
  buildTieredCacheEntry,
  cacheKeyString,
  evaluateTieredCacheEntry,
  type CacheConfig,
  type CacheKey,
  type CacheReadOptions,
  type CacheWriteOptions,
  type SignalCache,
  type TieredCacheEntry,
} from "./cache.js"
import { hasNodeErrorCode } from "./node-error.js"
import { resolvePulsarRepoStatePath } from "./state-paths.js"

interface IndexedCacheRecordBase {
  readonly key: CacheKey
  readonly lastAccessedAt: string
  bytes: number
}

/**
 * A record whose line is still on disk and whose entry has not been parsed.
 * Retaining the serialized line instead of the parsed entry keeps the bucket's
 * object graph flat until a specific record is actually requested.
 */
interface IndexedDiskRecord extends IndexedCacheRecordBase {
  readonly line: string
  readonly entry?: never
}

/**
 * A record that has been written, or read and parsed at least once. The parsed
 * entry replaces the line so a record is only ever held in one representation.
 */
interface IndexedLoadedRecord extends IndexedCacheRecordBase {
  readonly entry: TieredCacheEntry<unknown>
  readonly line?: never
}

type IndexedCacheRecord = IndexedDiskRecord | IndexedLoadedRecord

interface LoadedSignalBucket {
  readonly signalId: string
  readonly records: Map<string, IndexedCacheRecord>
  /** Exact byte size of the persisted file this bucket was loaded from or wrote. */
  savedBytes: number | undefined
  /**
   * Set whenever the in-memory records may diverge from the persisted file. A
   * pending trim, insertion, or eviction can coincidentally produce the same
   * total byte size as the file, so byte equality alone cannot prove the file
   * is current.
   */
  dirty: boolean
}

const RECORD_FILE = "entries.jsonl"
const READ_CHUNK_BYTES = 256 * 1024
/** Records are accumulated up to this many bytes before each stream write. */
const WRITE_BATCH_BYTES = 2 * 1024 * 1024

class DiskBackedCacheError extends Error {
  override readonly name = "DiskBackedCacheError"

  constructor(operation: string, cause: unknown) {
    super(`Disk cache ${operation} failed: ${String(cause)}`)
  }
}

const recordPathFor = (cacheDir: string, signalId: string): string =>
  join(cacheDir, signalId, RECORD_FILE)

let tempSequence = 0

const recordTempPathFor = (cacheDir: string, signalId: string): string =>
  join(
    cacheDir,
    signalId,
    `.${RECORD_FILE}.${process.pid}.${(tempSequence += 1)}.tmp`,
  )

const createInitialBucket = (signalId: string): LoadedSignalBucket => ({
  signalId,
  records: new Map(),
  savedBytes: undefined,
  dirty: false,
})

const normalizeSignalByteBudget = (
  maxSignalBytes: number | undefined,
): number | undefined =>
  maxSignalBytes !== undefined && Number.isFinite(maxSignalBytes)
    ? Math.max(0, Math.floor(maxSignalBytes))
    : undefined

interface SerializedRecord {
  readonly key: CacheKey
  readonly entry: TieredCacheEntry<unknown>
  readonly lastAccessedAt: string
}

const serializeRecord = (record: SerializedRecord): string => JSON.stringify(record)

const recordLineBytes = (record: SerializedRecord): number =>
  Buffer.byteLength(`${serializeRecord(record)}\n`, "utf8")

/** Exact serialized size of an indexed record, regardless of representation. */
const indexedRecordBytes = (record: IndexedCacheRecord): number =>
  record.entry === undefined
    ? record.bytes
    : recordLineBytes({
        key: record.key,
        entry: record.entry,
        lastAccessedAt: record.lastAccessedAt,
      })

const cacheKeyOf = (value: unknown): CacheKey | undefined => {
  if (value === null || typeof value !== "object") return undefined
  const candidate = value as { signalId?: unknown; contentHash?: unknown; configHash?: unknown }
  return typeof candidate.signalId === "string" &&
    typeof candidate.contentHash === "string" &&
    typeof candidate.configHash === "string"
    ? {
        signalId: candidate.signalId,
        contentHash: candidate.contentHash,
        configHash: candidate.configHash,
      }
    : undefined
}

const loadKnownSignalIds = async (cacheDir: string): Promise<Set<string>> => {
  await mkdir(cacheDir, { recursive: true })
  const dirEntries = await readdir(cacheDir, { withFileTypes: true })
  return new Set(
    dirEntries
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name),
  )
}

const statBucketBytes = async (path: string): Promise<number | undefined> => {
  try {
    return (await stat(path)).size
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) return undefined
    throw new DiskBackedCacheError("stat bucket file", error)
  }
}

const removeTempFile = async (tempPath: string): Promise<void> => {
  try {
    await rm(tempPath, { force: true })
  } catch {
    // Best-effort cleanup: the write error is the one worth surfacing.
  }
}

interface ScannedRecord {
  readonly bytes: number
  readonly line: string
}

/**
 * Reads a bucket file in bounded chunks and reports each newline-delimited
 * record with its exact byte size. Line boundaries are found on the raw UTF-8
 * bytes, so a partial record is copied chunk-by-chunk and decoded exactly once
 * when complete; a multi-byte UTF-8 sequence split across a chunk boundary is
 * therefore never mis-decoded, and large records never force repeated
 * flattening of a growing string.
 */
const scanBucketFile = async (
  path: string,
  visit: (record: ScannedRecord) => void,
): Promise<number | undefined> => {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, "r")
    const chunk = Buffer.allocUnsafe(READ_CHUNK_BYTES)
    let pending: Buffer[] = []
    let pendingBytes = 0
    let position = 0

    const emitPending = (): void => {
      if (pendingBytes === 0) return
      const line = Buffer.concat(pending, pendingBytes).toString("utf8")
      // Every record reports its line plus the newline that separates it, the
      // same convention the writer uses, so byte budgets stay exact.
      visit({ bytes: pendingBytes + 1, line })
      pending = []
      pendingBytes = 0
    }

    while (true) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (bytesRead === 0) break
      const view = chunk.subarray(0, bytesRead)
      position += bytesRead
      let start = 0
      while (true) {
        const newline = view.indexOf(0x0a, start)
        if (newline === -1) break
        const tailBytes = newline - start
        if (tailBytes > 0) {
          pending.push(Buffer.from(view.subarray(start, newline)))
          pendingBytes += tailBytes
        }
        emitPending()
        start = newline + 1
      }
      if (start < view.length) {
        pending.push(Buffer.from(view.subarray(start)))
        pendingBytes += view.length - start
      }
    }
    emitPending()
    return position
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) return undefined
    throw new DiskBackedCacheError("read bucket file", error)
  } finally {
    await handle?.close()
  }
}

/**
 * Writes records to a temp file in bounded batches instead of joining the
 * whole bucket into one string, then atomically renames it into place. A
 * failed or interrupted write removes the temp file, so a partial bucket
 * never lingers.
 */
const persistBucket = async (
  tempPath: string,
  path: string,
  records: ReadonlyArray<IndexedCacheRecord>,
): Promise<void> => {
  try {
    if (records.length === 0) {
      const handle = await open(tempPath, "w")
      await handle.close()
      await rename(tempPath, path)
      return
    }

    let batch: string[] = []
    let batchBytes = 0
    const flushBatch = async (): Promise<void> => {
      if (batch.length === 0) return
      await appendFile(tempPath, batch.join(""), "utf8")
      batch = []
      batchBytes = 0
    }
    for (const record of records) {
      const line =
        record.entry === undefined
          ? `${record.line}\n`
          : `${serializeRecord({
              key: record.key,
              entry: record.entry,
              lastAccessedAt: record.lastAccessedAt,
            })}\n`
      batch.push(line)
      batchBytes += record.bytes
      if (batchBytes >= WRITE_BATCH_BYTES) await flushBatch()
    }
    await flushBatch()
    await rename(tempPath, path)
  } catch (error) {
    await removeTempFile(tempPath)
    throw new DiskBackedCacheError("write bucket file", error)
  }
}

const runDiskCacheOperation = <A>(
  operation: string,
  evaluate: () => Promise<A>,
): Effect.Effect<A> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DiskBackedCacheError(operation, cause),
  }).pipe(Effect.catchCause((cause) => Effect.die(cause)))

const parseRecordLine = (line: string): SerializedRecord => {
  const parsed = JSON.parse(line) as {
    key?: unknown
    entry?: unknown
    lastAccessedAt?: unknown
  }
  const key = cacheKeyOf(parsed.key)
  if (
    key === undefined ||
    parsed.entry === null ||
    typeof parsed.entry !== "object" ||
    typeof parsed.lastAccessedAt !== "string"
  ) {
    throw new Error("malformed record line")
  }
  return {
    key,
    entry: parsed.entry as TieredCacheEntry<unknown>,
    lastAccessedAt: parsed.lastAccessedAt,
  }
}

const bucketBytes = (bucket: LoadedSignalBucket): number => {
  let bytes = 0
  for (const record of bucket.records.values()) bytes += record.bytes
  return bytes
}

const dropBucketRecords = (bucket: LoadedSignalBucket): number => {
  const bytes = bucketBytes(bucket)
  if (bucket.records.size > 0) {
    bucket.records.clear()
    bucket.dirty = true
  }
  return bytes
}

const trimBucketToBudget = (
  bucket: LoadedSignalBucket,
  protectedKey: string,
  maxSignalBytes: number | undefined,
): number => {
  const budget = normalizeSignalByteBudget(maxSignalBytes)
  if (budget === undefined) return 0

  let bytes = bucketBytes(bucket)
  if (bytes <= budget) return 0

  let removedBytes = 0
  const evictionCandidates = [...bucket.records.entries()]
    .filter(([keyString]) => keyString !== protectedKey)
    .sort(([, left], [, right]) =>
      left.lastAccessedAt.localeCompare(right.lastAccessedAt),
    )
  for (const [keyString, record] of evictionCandidates) {
    if (bytes <= budget) break
    bucket.records.delete(keyString)
    bytes -= record.bytes
    removedBytes += record.bytes
  }
  if (bytes > budget) {
    const protectedRecord = bucket.records.get(protectedKey)
    if (protectedRecord !== undefined) {
      bucket.records.delete(protectedKey)
      removedBytes += protectedRecord.bytes
    }
  }
  if (removedBytes > 0) bucket.dirty = true
  return removedBytes
}

const findOldestRecord = (
  buckets: ReadonlyMap<string, LoadedSignalBucket>,
): { readonly signalId: string; readonly keyString: string; readonly record: IndexedCacheRecord } | undefined => {
  let oldest:
    | { readonly signalId: string; readonly keyString: string; readonly record: IndexedCacheRecord }
    | undefined

  for (const [signalId, bucket] of buckets) {
    for (const [keyString, record] of bucket.records) {
      if (
        oldest === undefined ||
        record.lastAccessedAt.localeCompare(oldest.record.lastAccessedAt) < 0
      ) {
        oldest = { signalId, keyString, record }
      }
    }
  }

  return oldest
}

const makeDiskBackedCache = (config?: CacheConfig): Effect.Effect<SignalCache> =>
  runDiskCacheOperation("initialize", async () => {
    const cacheDir = config?.cacheDir ?? resolvePulsarRepoStatePath(process.cwd(), "cache")
    const maxSizeBytes = config?.maxSizeBytes ?? DEFAULT_CACHE_MAX_SIZE_BYTES
    const knownSignalIds = await loadKnownSignalIds(cacheDir)
    const buckets = new Map<string, LoadedSignalBucket>()
    const loadingBuckets = new Map<string, Promise<LoadedSignalBucket>>()
    const countedSignalIds = new Set<string>()
    let unindexedSignalIds = new Set(knownSignalIds)
    let totalBytes = 0
    let fullIndex: Promise<void> | undefined
    let writeQueue = Promise.resolve()

    const withWriteQueue = async <T>(operation: () => Promise<T>): Promise<T> => {
      const prior = writeQueue
      let release!: () => void
      writeQueue = new Promise<void>((resolve) => {
        release = resolve
      })
      await prior
      try {
        return await operation()
      } finally {
        release()
      }
    }

    const discardLoadedBucketBeyondBudget = (
      bucket: LoadedSignalBucket,
      maxSignalBytes: number | undefined,
    ): LoadedSignalBucket => {
      const budget = normalizeSignalByteBudget(maxSignalBytes)
      if (budget === undefined) return bucket
      if (bucketBytes(bucket) <= budget) return bucket
      totalBytes -= dropBucketRecords(bucket)
      return bucket
    }

    /**
     * Reads and indexes a bucket. The manager holds each signal under its own
     * byte budget, and a bucket larger than the budget being asked for is
     * never parsed: the size guard returns before any record line is read.
     * Byte accounting stays with the caller so bytes are added exactly once.
     */
    const indexBucket = async (
      signalId: string,
      maxSignalBytes: number | undefined,
    ): Promise<LoadedSignalBucket> => {
      const bucket = createInitialBucket(signalId)
      const budget = normalizeSignalByteBudget(maxSignalBytes)
      const path = recordPathFor(cacheDir, signalId)
      const onDiskBytes = await statBucketBytes(path)
      if (onDiskBytes === undefined || onDiskBytes === 0) return bucket
      bucket.savedBytes = onDiskBytes
      if (budget !== undefined && onDiskBytes > budget) return bucket

      await scanBucketFile(path, (scanned) => {
        let parsed: unknown
        try {
          parsed = JSON.parse(scanned.line)
        } catch {
          return
        }
        if (parsed === null || typeof parsed !== "object") return
        const candidate = parsed as { key?: unknown; lastAccessedAt?: unknown }
        const key = cacheKeyOf(candidate.key)
        if (key === undefined || typeof candidate.lastAccessedAt !== "string") return
        const keyString = cacheKeyString(key)
        // First line for a key wins, matching the previous loader semantics.
        if (bucket.records.has(keyString)) return
        bucket.records.set(keyString, {
          key,
          lastAccessedAt: candidate.lastAccessedAt,
          bytes: scanned.bytes,
          line: scanned.line,
        })
      })
      if (budget !== undefined && bucketBytes(bucket) > budget) {
        bucket.records.clear()
      }
      // The transient parsed object is dropped here: only the retained line,
      // key, timestamp and byte size survive indexing.
      return bucket
    }

    /**
     * Returns the bucket index, loading it at most once per signal. The
     * in-flight promise is shared so concurrent first accesses cannot observe
     * a half-initialized bucket and report a false miss. A load that started
     * without a budget cannot promise a narrower caller that the file was
     * skipped, so the narrow budget is applied as a post-load discard.
     */
    const ensureBucketIndex = async (
      signalId: string,
      maxSignalBytes?: number,
    ): Promise<LoadedSignalBucket> => {
      const existing = buckets.get(signalId)
      if (existing !== undefined) {
        return discardLoadedBucketBeyondBudget(existing, maxSignalBytes)
      }
      const budget = normalizeSignalByteBudget(maxSignalBytes)
      const inFlight = loadingBuckets.get(signalId)
      if (inFlight !== undefined) {
        // A load that started without a budget cannot promise a narrower
        // caller that the file was skipped; the caller's budget is applied as
        // a post-load discard either way.
        return discardLoadedBucketBeyondBudget(await inFlight, budget)
      }
      const load = (async (): Promise<LoadedSignalBucket> => {
        const loaded = await indexBucket(signalId, budget)
        buckets.set(signalId, loaded)
        knownSignalIds.add(signalId)
        unindexedSignalIds.delete(signalId)
        if (!countedSignalIds.has(signalId)) {
          countedSignalIds.add(signalId)
          totalBytes += bucketBytes(loaded)
        }
        if (budget !== undefined && bucketBytes(loaded) > budget) {
          totalBytes -= dropBucketRecords(loaded)
        }
        return loaded
      })()
      loadingBuckets.set(signalId, load)
      try {
        return await load
      } finally {
        loadingBuckets.delete(signalId)
      }
    }

    /**
     * Indexes every known bucket at most once, sharing a single in-flight
     * promise so a concurrent `size`/`totalBytes` cannot observe a partially
     * loaded index. Loads run with bounded concurrency: reading every bucket
     * at once multiplies parser and line-buffer memory.
     */
    const loadFullIndex = async (): Promise<void> => {
      if (fullIndex !== undefined) return fullIndex
      if (unindexedSignalIds.size === 0) return
      fullIndex = (async () => {
        const pending = [...unindexedSignalIds]
        let cursor = 0
        const worker = async (): Promise<void> => {
          while (true) {
            const index = cursor
            cursor += 1
            if (index >= pending.length) return
            const signalId = pending[index]!
            if (buckets.has(signalId)) continue
            await ensureBucketIndex(signalId)
          }
        }
        await Promise.all(
          Array.from({ length: Math.min(2, pending.length) }, () => worker()),
        )
      })()
      try {
        await fullIndex
      } finally {
        fullIndex = undefined
      }
    }

    const loadedRecordFor = (
      bucket: LoadedSignalBucket,
      keyString: string,
    ): IndexedCacheRecord | undefined => {
      const record = bucket.records.get(keyString)
      if (record === undefined) return undefined
      if (record.entry !== undefined) return record
      const parsed = parseRecordLine(record.line)
      const bytes = recordLineBytes(parsed)
      totalBytes += bytes - record.bytes
      const loaded: IndexedLoadedRecord = {
        key: record.key,
        lastAccessedAt: record.lastAccessedAt,
        bytes,
        entry: parsed.entry,
      }
      bucket.records.set(keyString, loaded)
      return loaded
    }

    const storeRecord = <A>(
      bucket: LoadedSignalBucket,
      key: CacheKey,
      value: A,
      options: CacheWriteOptions | undefined,
    ): void => {
      const keyString = cacheKeyString(key)
      const existing = bucket.records.get(keyString)
      if (existing !== undefined) totalBytes -= existing.bytes
      const lastAccessedAt = options?.computedAt ?? new Date().toISOString()
      const entry = buildTieredCacheEntry(value, options)
      const serialized: SerializedRecord = { key, entry, lastAccessedAt }
      const bytes = recordLineBytes(serialized)
      totalBytes += bytes
      bucket.records.set(keyString, { key, lastAccessedAt, bytes, entry })
      bucket.dirty = true
    }

    const flushBucket = async (bucket: LoadedSignalBucket): Promise<void> => {
      if (!bucket.dirty) return
      const records = [...bucket.records.values()].sort((left, right) =>
        right.lastAccessedAt.localeCompare(left.lastAccessedAt),
      )
      let projectedBytes = 0
      for (const record of records) projectedBytes += indexedRecordBytes(record)

      await mkdir(join(cacheDir, bucket.signalId), { recursive: true })
      const path = recordPathFor(cacheDir, bucket.signalId)
      const tempPath = recordTempPathFor(cacheDir, bucket.signalId)
      await persistBucket(tempPath, path, records)
      // Every record's `bytes` is kept exact, so the projected total is what
      // was written.
      totalBytes += projectedBytes - bucketBytes(bucket)
      for (const record of records) record.bytes = indexedRecordBytes(record)
      bucket.savedBytes = projectedBytes
      bucket.dirty = false
    }

    const touchRecord = (
      bucket: LoadedSignalBucket,
      keyString: string,
      record: IndexedCacheRecord,
    ): void => {
      bucket.records.set(keyString, {
        ...record,
        lastAccessedAt: new Date().toISOString(),
      })
      bucket.dirty = true
    }

    return {
      get: <A>(key: CacheKey) =>
        runDiskCacheOperation("get", async () => {
          const bucket = await ensureBucketIndex(key.signalId)
          const keyString = cacheKeyString(key)
          const record = loadedRecordFor(bucket, keyString)
          if (record === undefined) return Option.none<A>()
          touchRecord(bucket, keyString, record)
          return Option.some((record.entry as TieredCacheEntry<A>).value)
        }),
      set: <A>(key: CacheKey, value: A) =>
        runDiskCacheOperation("set", () =>
          withWriteQueue(async () => {
            const bucket = await ensureBucketIndex(key.signalId)
            storeRecord(bucket, key, value, undefined)
            await flushBucket(bucket)
          }),
        ),
      getTiered: <A>(key: CacheKey, options?: CacheReadOptions) =>
        runDiskCacheOperation("getTiered", async () => {
          const bucket = await ensureBucketIndex(key.signalId, options?.maxSignalBytes)
          const keyString = cacheKeyString(key)
          const record = loadedRecordFor(bucket, keyString)
          if (record === undefined) {
            return evaluateTieredCacheEntry<A>(undefined, options)
          }
          const evaluated = evaluateTieredCacheEntry<A>(
            record.entry as TieredCacheEntry<A>,
            options,
          )
          touchRecord(bucket, keyString, record)
          return evaluated
        }),
      setTiered: <A>(key: CacheKey, value: A, options?: CacheWriteOptions) =>
        runDiskCacheOperation("setTiered", () =>
          withWriteQueue(async () => {
            // The budgeted load happens before the index walk so a bounded set
            // against an oversized legacy bucket never parses it.
            const bucket = await ensureBucketIndex(key.signalId, options?.maxSignalBytes)
            await loadFullIndex()
            const keyString = cacheKeyString(key)
            storeRecord(bucket, key, value, options)

            const dirtyBuckets = new Set<string>([key.signalId])
            totalBytes -= trimBucketToBudget(
              bucket,
              keyString,
              options?.maxSignalBytes,
            )
            while (totalBytes > maxSizeBytes) {
              const oldest = findOldestRecord(buckets)
              if (oldest === undefined) break
              const oldestBucket = buckets.get(oldest.signalId)
              if (oldestBucket === undefined) break
              oldestBucket.records.delete(oldest.keyString)
              // Global eviction is a mutation: without the dirty flag the
              // flush would skip the bucket and the record would reappear on
              // the next open.
              oldestBucket.dirty = true
              dirtyBuckets.add(oldest.signalId)
              totalBytes -= oldest.record.bytes
            }

            await Promise.all(
              [...dirtyBuckets].map(async (signalId) => {
                const dirty = buckets.get(signalId)
                if (dirty !== undefined) await flushBucket(dirty)
              }),
            )
          }),
        ),
      size: runDiskCacheOperation("size", async () => {
        await loadFullIndex()
        return [...buckets.values()].reduce(
          (sum, bucket) => sum + bucket.records.size,
          0,
        )
      }),
      totalBytes: runDiskCacheOperation("totalBytes", async () => {
        await loadFullIndex()
        return totalBytes
      }),
    }
  })

export const DiskBackedCacheLayer = (config?: CacheConfig): Layer.Layer<SignalCacheTag> =>
  Layer.effect(SignalCacheTag, makeDiskBackedCache(config))
