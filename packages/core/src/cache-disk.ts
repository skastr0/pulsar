import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
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

interface PersistedCacheRecord {
  readonly key: CacheKey
  readonly entry: TieredCacheEntry<unknown>
  readonly lastAccessedAt: string
}

interface LoadedCacheRecord {
  readonly key: CacheKey
  readonly entry: TieredCacheEntry<unknown>
  readonly lastAccessedAt: string
  readonly bytes: number
}

interface LoadedSignalBucket {
  readonly signalId: string
  readonly records: Map<string, LoadedCacheRecord>
}

const RECORD_FILE = "entries.jsonl"

class DiskBackedCacheError extends Error {
  override readonly name = "DiskBackedCacheError"

  constructor(operation: string, cause: unknown) {
    super(`Disk cache ${operation} failed: ${String(cause)}`)
  }
}

type CacheRecordLineRead =
  | {
      readonly status: "loaded"
      readonly record: LoadedCacheRecord
    }
  | {
      readonly status: "malformed"
      readonly error: DiskBackedCacheError
    }

const recordPathFor = (cacheDir: string, signalId: string): string =>
  join(cacheDir, signalId, RECORD_FILE)

const createInitialBucket = (signalId: string): LoadedSignalBucket => ({
  signalId,
  records: new Map(),
})

const normalizeSignalByteBudget = (
  maxSignalBytes: number | undefined,
): number | undefined =>
  maxSignalBytes !== undefined && Number.isFinite(maxSignalBytes)
    ? Math.max(0, Math.floor(maxSignalBytes))
    : undefined

const serializeRecord = (record: PersistedCacheRecord): string => JSON.stringify(record)

const toLoadedRecord = (record: PersistedCacheRecord): LoadedCacheRecord => ({
  ...record,
  bytes: Buffer.byteLength(`${serializeRecord(record)}\n`, "utf8"),
})

const loadKnownSignalIds = async (cacheDir: string): Promise<Set<string>> => {
  await mkdir(cacheDir, { recursive: true })
  const dirEntries = await readdir(cacheDir, { withFileTypes: true })
  return new Set(
    dirEntries
      .filter((dirEntry) => dirEntry.isDirectory())
      .map((dirEntry) => dirEntry.name),
  )
}

const malformedCacheRecordLine = (line: string, cause: unknown): CacheRecordLineRead => ({
  status: "malformed",
  error: new DiskBackedCacheError(`read malformed record line (${line.length} bytes)`, cause),
})

const parseCacheRecordLine = (line: string): CacheRecordLineRead => {
  try {
    const parsed = JSON.parse(line) as PersistedCacheRecord
    return {
      status: "loaded",
      record: toLoadedRecord(parsed),
    }
  } catch (error) {
    return malformedCacheRecordLine(line, error)
  }
}

const loadBucket = async (
  cacheDir: string,
  signalId: string,
  maxSignalBytes?: number,
): Promise<LoadedSignalBucket> => {
  const path = recordPathFor(cacheDir, signalId)
  const budget = normalizeSignalByteBudget(maxSignalBytes)
  if (budget !== undefined) {
    try {
      const file = await stat(path)
      if (file.size > budget) {
        return createInitialBucket(signalId)
      }
    } catch (error) {
      if (hasNodeErrorCode(error, "ENOENT")) return createInitialBucket(signalId)
      throw new DiskBackedCacheError("stat bucket file", error)
    }
  }

  let raw = ""
  try {
    raw = await readFile(path, "utf8")
  } catch (error) {
    if (hasNodeErrorCode(error, "ENOENT")) return createInitialBucket(signalId)
    throw new DiskBackedCacheError("read bucket file", error)
  }

  const records = new Map<string, LoadedCacheRecord>()
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const loaded = parseCacheRecordLine(trimmed)
    if (loaded.status === "malformed") {
      continue
    }
    const keyString = cacheKeyString(loaded.record.key)
    if (!records.has(keyString)) {
      records.set(keyString, loaded.record)
    }
  }
  return { signalId, records }
}

const bucketBytes = (bucket: LoadedSignalBucket): number =>
  [...bucket.records.values()].reduce((sum, record) => sum + record.bytes, 0)

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
  return removedBytes
}

const totalBytesOf = (buckets: ReadonlyMap<string, LoadedSignalBucket>): number =>
  [...buckets.values()].reduce((sum, bucket) => sum + bucketBytes(bucket), 0)

const findOldestRecord = (
  buckets: ReadonlyMap<string, LoadedSignalBucket>,
): { readonly signalId: string; readonly keyString: string; readonly record: LoadedCacheRecord } | undefined => {
  let oldest:
    | { readonly signalId: string; readonly keyString: string; readonly record: LoadedCacheRecord }
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

const flushBucket = async (cacheDir: string, bucket: LoadedSignalBucket): Promise<void> => {
  const bucketDir = join(cacheDir, bucket.signalId)
  await mkdir(bucketDir, { recursive: true })
  const serialized = [...bucket.records.values()]
    .sort((left, right) => right.lastAccessedAt.localeCompare(left.lastAccessedAt))
    .map((record) =>
      serializeRecord({
        key: record.key,
        entry: record.entry,
        lastAccessedAt: record.lastAccessedAt,
      }),
    )
    .join("\n")
  await writeFile(recordPathFor(cacheDir, bucket.signalId), serialized)
}

const updateRecordTimestamp = (
  record: LoadedCacheRecord,
  at: string,
): LoadedCacheRecord => ({
  ...record,
  lastAccessedAt: at,
})

const runDiskCacheOperation = <A>(
  operation: string,
  evaluate: () => Promise<A>,
): Effect.Effect<A> =>
  Effect.tryPromise({
    try: evaluate,
    catch: (cause) => new DiskBackedCacheError(operation, cause),
  }).pipe(Effect.catchAllCause((cause) => Effect.die(cause)))

const makeDiskBackedCache = (config?: CacheConfig): Effect.Effect<SignalCache> =>
  runDiskCacheOperation("initialize", async () => {
    const cacheDir = config?.cacheDir ?? resolvePulsarRepoStatePath(process.cwd(), "cache")
    const maxSizeBytes = config?.maxSizeBytes ?? DEFAULT_CACHE_MAX_SIZE_BYTES
    const knownSignalIds = await loadKnownSignalIds(cacheDir)
    const buckets = new Map<string, LoadedSignalBucket>()
    const loadingBuckets = new Map<string, Promise<LoadedSignalBucket>>()
    let totalBytes = 0
    let totalBytesKnown = false
    let writeQueue = Promise.resolve()

    const discardLoadedBucketBeyondBudget = (
      bucket: LoadedSignalBucket,
      maxSignalBytes: number | undefined,
    ): LoadedSignalBucket => {
      const budget = normalizeSignalByteBudget(maxSignalBytes)
      if (budget === undefined) return bucket

      const bytes = bucketBytes(bucket)
      if (bytes <= budget) return bucket
      bucket.records.clear()
      totalBytes -= bytes
      return bucket
    }

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

    const ensureBucket = async (
      signalId: string,
      maxSignalBytes?: number,
    ): Promise<LoadedSignalBucket> => {
      const existing = buckets.get(signalId)
      if (existing !== undefined) {
        return discardLoadedBucketBeyondBudget(existing, maxSignalBytes)
      }

      const inFlight = loadingBuckets.get(signalId)
      if (inFlight !== undefined) {
        return discardLoadedBucketBeyondBudget(await inFlight, maxSignalBytes)
      }

      const load = (async () => {
        const created = knownSignalIds.has(signalId)
          ? await loadBucket(cacheDir, signalId, maxSignalBytes)
          : { signalId, records: new Map() }
        buckets.set(signalId, created)
        knownSignalIds.add(signalId)
        if (!totalBytesKnown) {
          totalBytes += bucketBytes(created)
        }
        return created
      })()
      loadingBuckets.set(signalId, load)
      const created = await load
      loadingBuckets.delete(signalId)
      return created
    }

    const loadFullIndex = async (): Promise<void> => {
      if (totalBytesKnown) return
      for (const signalId of knownSignalIds) {
        await ensureBucket(signalId)
      }
      totalBytes = totalBytesOf(buckets)
      totalBytesKnown = true
    }

    return {
      get: <A>(key: CacheKey) =>
        runDiskCacheOperation("get", async () => {
          const bucket = await ensureBucket(key.signalId)
          const entry = bucket?.records.get(cacheKeyString(key))
          if (entry === undefined) return Option.none<A>()
          const next = updateRecordTimestamp(entry, new Date().toISOString())
          bucket.records.set(cacheKeyString(key), next)
          return Option.some(next.entry.value as A)
        }),
      set: <A>(key: CacheKey, value: A) =>
        runDiskCacheOperation("set", () =>
          withWriteQueue(async () => {
            await loadFullIndex()
            const now = new Date().toISOString()
            const bucket = await ensureBucket(key.signalId)
            const keyString = cacheKeyString(key)
            const existing = bucket.records.get(keyString)
            if (existing !== undefined) {
              totalBytes -= existing.bytes
            }

            const loaded = toLoadedRecord({
              key,
              entry: buildTieredCacheEntry(value),
              lastAccessedAt: now,
            })
            bucket.records.set(keyString, loaded)
            totalBytes += loaded.bytes
            await flushBucket(cacheDir, bucket)
          }),
        ),
      getTiered: <A>(key: CacheKey, options?: CacheReadOptions) =>
        runDiskCacheOperation("getTiered", async () => {
          const bucket = await ensureBucket(key.signalId, options?.maxSignalBytes)
          const record = bucket?.records.get(cacheKeyString(key))
          if (record === undefined) {
            return evaluateTieredCacheEntry<A>(undefined, options)
          }
          const evaluated = evaluateTieredCacheEntry(
            record.entry as TieredCacheEntry<A>,
            options,
          )
          bucket!.records.set(
            cacheKeyString(key),
            updateRecordTimestamp(record, new Date().toISOString()),
          )
          return evaluated
        }),
      setTiered: <A>(key: CacheKey, value: A, options?: CacheWriteOptions) =>
        runDiskCacheOperation("setTiered", () =>
          withWriteQueue(async () => {
            const bucket = await ensureBucket(key.signalId, options?.maxSignalBytes)
            await loadFullIndex()
            const keyString = cacheKeyString(key)
            const existing = bucket.records.get(keyString)
            if (existing !== undefined) {
              totalBytes -= existing.bytes
            }

            const lastAccessedAt = options?.computedAt ?? new Date().toISOString()
            const loaded = toLoadedRecord({
              key,
              entry: buildTieredCacheEntry(value, options),
              lastAccessedAt,
            })
            bucket.records.set(keyString, loaded)
            totalBytes += loaded.bytes

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
              dirtyBuckets.add(oldest.signalId)
              totalBytes -= oldest.record.bytes
            }

            await Promise.all(
              [...dirtyBuckets].map(async (signalId) =>
                flushBucket(cacheDir, await ensureBucket(signalId)),
              ),
            )
          }),
        ),
      size: runDiskCacheOperation("size", async () => {
        await loadFullIndex()
        return [...buckets.values()].reduce((sum, bucket) => sum + bucket.records.size, 0)
      }),
      totalBytes: runDiskCacheOperation("totalBytes", async () => {
        await loadFullIndex()
        return totalBytes
      }),
    }
  })

export const DiskBackedCacheLayer = (config?: CacheConfig): Layer.Layer<SignalCacheTag> =>
  Layer.effect(SignalCacheTag, makeDiskBackedCache(config))
