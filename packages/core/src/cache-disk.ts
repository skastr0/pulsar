import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
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

const recordPathFor = (cacheDir: string, signalId: string): string =>
  join(cacheDir, signalId, RECORD_FILE)

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

const loadBucket = async (
  cacheDir: string,
  signalId: string,
): Promise<LoadedSignalBucket> => {
  const path = recordPathFor(cacheDir, signalId)
  let raw = ""
  try {
    raw = await readFile(path, "utf8")
  } catch {
    return { signalId, records: new Map() }
  }

  const records = new Map<string, LoadedCacheRecord>()
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      const parsed = JSON.parse(trimmed) as PersistedCacheRecord
      const keyString = cacheKeyString(parsed.key)
      if (!records.has(keyString)) {
        records.set(keyString, toLoadedRecord(parsed))
      }
    } catch {
      // Ignore malformed lines rather than failing the entire cache.
    }
  }
  return { signalId, records }
}

const bucketBytes = (bucket: LoadedSignalBucket): number =>
  [...bucket.records.values()].reduce((sum, record) => sum + record.bytes, 0)

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

export const makeDiskBackedCache = (config?: CacheConfig): Effect.Effect<SignalCache> =>
  Effect.tryPromise(async () => {
    const cacheDir = config?.cacheDir ?? join(process.cwd(), ".pulsar", "cache")
    const maxSizeBytes = config?.maxSizeBytes ?? DEFAULT_CACHE_MAX_SIZE_BYTES
    const knownSignalIds = await loadKnownSignalIds(cacheDir)
    const buckets = new Map<string, LoadedSignalBucket>()
    const loadingBuckets = new Map<string, Promise<LoadedSignalBucket>>()
    let totalBytes = 0
    let totalBytesKnown = false
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

    const ensureBucket = async (signalId: string): Promise<LoadedSignalBucket> => {
      const existing = buckets.get(signalId)
      if (existing !== undefined) return existing

      const inFlight = loadingBuckets.get(signalId)
      if (inFlight !== undefined) return inFlight

      const load = (async () => {
        const created = knownSignalIds.has(signalId)
          ? await loadBucket(cacheDir, signalId)
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

    const ensureFullIndex = async (): Promise<void> => {
      if (totalBytesKnown) return
      for (const signalId of knownSignalIds) {
        await ensureBucket(signalId)
      }
      totalBytes = totalBytesOf(buckets)
      totalBytesKnown = true
    }

    return {
      get: <A>(key: CacheKey) =>
        Effect.tryPromise(async () => {
          const bucket = await ensureBucket(key.signalId)
          const entry = bucket?.records.get(cacheKeyString(key))
          if (entry === undefined) return Option.none<A>()
          const next = updateRecordTimestamp(entry, new Date().toISOString())
          bucket.records.set(cacheKeyString(key), next)
          return Option.some(next.entry.value as A)
        }).pipe(Effect.catchAllCause((cause) => Effect.die(cause))),
      set: <A>(key: CacheKey, value: A) =>
        Effect.tryPromise(() =>
          withWriteQueue(async () => {
            await ensureFullIndex()
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
        ).pipe(Effect.catchAllCause((cause) => Effect.die(cause))),
      getTiered: <A>(key: CacheKey, options?: CacheReadOptions) =>
        Effect.tryPromise(async () => {
          const bucket = await ensureBucket(key.signalId)
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
        }).pipe(Effect.catchAllCause((cause) => Effect.die(cause))),
      setTiered: <A>(key: CacheKey, value: A, options?: CacheWriteOptions) =>
        Effect.tryPromise(() =>
          withWriteQueue(async () => {
            await ensureFullIndex()
            const bucket = await ensureBucket(key.signalId)
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
        ).pipe(Effect.catchAllCause((cause) => Effect.die(cause))),
      size: Effect.tryPromise(async () => {
        await ensureFullIndex()
        return [...buckets.values()].reduce((sum, bucket) => sum + bucket.records.size, 0)
      }).pipe(Effect.catchAllCause((cause) => Effect.die(cause))),
      totalBytes: Effect.tryPromise(async () => {
        await ensureFullIndex()
        return totalBytes
      }).pipe(Effect.catchAllCause((cause) => Effect.die(cause))),
    }
  }).pipe(Effect.catchAllCause((cause) => Effect.die(cause)))

export const DiskBackedCacheLayer = (config?: CacheConfig): Layer.Layer<SignalCacheTag> =>
  Layer.effect(SignalCacheTag, makeDiskBackedCache(config))
