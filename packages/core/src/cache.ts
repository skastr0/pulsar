import { Context, Effect, Layer, Option, Ref } from "effect"
import type { Tier } from "./tier.js"

export interface CacheKey {
  readonly signalId: string
  readonly contentHash: string
  readonly configHash: string
}

export interface CacheConfig {
  readonly cacheDir?: string
  readonly maxSizeBytes?: number
  readonly confidenceThreshold?: number
  readonly staleMode?: "miss" | "mark-stale"
}

export interface CacheReadOptions {
  readonly tier?: Tier
  readonly refVersionHash?: string
  readonly modelId?: string
  readonly confidenceThreshold?: number
  readonly staleMode?: "miss" | "mark-stale"
  readonly now?: Date
}

export interface CacheWriteOptions {
  readonly tier?: Tier
  readonly refVersionHash?: string
  readonly modelId?: string
  readonly baseConfidence?: number
  readonly halfLifeDays?: number
  readonly computedAt?: string
}

export interface TieredCacheEntry<T> {
  readonly value: T
  readonly computedAt: string
  readonly tier: Tier
  readonly refVersionHash: string | undefined
  readonly modelId: string | undefined
  readonly baseConfidence: number
  readonly halfLifeDays: number | undefined
}

interface CacheLookupResult<T> {
  readonly status: "hit" | "miss" | "stale"
  readonly entry?: TieredCacheEntry<T>
  readonly value?: T
  readonly effectiveConfidence?: number
}

export const DEFAULT_CACHE_MAX_SIZE_BYTES = 500 * 1024 * 1024
const DEFAULT_CONFIDENCE_THRESHOLD = 0.5
const DEFAULT_HALF_LIFE_DAYS = 30

export const cacheKeyString = (key: CacheKey): string =>
  `${key.signalId}::${key.contentHash}::${key.configHash}`

export const buildTieredCacheEntry = <T>(
  value: T,
  options?: CacheWriteOptions,
): TieredCacheEntry<T> => {
  const tier = options?.tier ?? 1
  return {
    value,
    computedAt: options?.computedAt ?? new Date().toISOString(),
    tier,
    refVersionHash: options?.refVersionHash,
    modelId: options?.modelId,
    baseConfidence: options?.baseConfidence ?? 1,
    halfLifeDays:
      tier === 3 ? (options?.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS) : undefined,
  }
}

const computeEffectiveConfidence = <T>(
  entry: TieredCacheEntry<T>,
  now = new Date(),
): number => {
  if (entry.tier !== 3) return entry.baseConfidence
  const halfLifeDays = entry.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS
  const computedAt = new Date(entry.computedAt)
  const ageDays = Math.max(0, now.getTime() - computedAt.getTime()) / (24 * 60 * 60 * 1000)
  return entry.baseConfidence * Math.exp(-ageDays / halfLifeDays)
}

export const evaluateTieredCacheEntry = <T>(
  entry: TieredCacheEntry<T> | undefined,
  options?: CacheReadOptions,
): CacheLookupResult<T> => {
  if (entry === undefined) return { status: "miss" }

  if (options?.tier !== undefined && entry.tier !== options.tier) {
    return { status: "miss" }
  }
  if (
    options?.refVersionHash !== undefined &&
    entry.refVersionHash !== options.refVersionHash
  ) {
    return { status: "miss" }
  }
  if (options?.modelId !== undefined && entry.modelId !== options.modelId) {
    return { status: "miss" }
  }

  const effectiveConfidence = computeEffectiveConfidence(entry, options?.now)
  if (entry.tier === 3) {
    const threshold = options?.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
    if (effectiveConfidence < threshold) {
      if ((options?.staleMode ?? "miss") === "mark-stale") {
        return {
          status: "stale",
          entry,
          value: entry.value,
          effectiveConfidence,
        }
      }
      return { status: "miss", effectiveConfidence }
    }
  }

  return {
    status: "hit",
    entry,
    value: entry.value,
    effectiveConfidence,
  }
}

export interface SignalCache {
  readonly get: <A>(key: CacheKey) => Effect.Effect<Option.Option<A>>
  readonly set: <A>(key: CacheKey, value: A) => Effect.Effect<void>
  readonly getTiered: <A>(
    key: CacheKey,
    options?: CacheReadOptions,
  ) => Effect.Effect<CacheLookupResult<A>>
  readonly setTiered: <A>(
    key: CacheKey,
    value: A,
    options?: CacheWriteOptions,
  ) => Effect.Effect<void>
  readonly size: Effect.Effect<number>
  readonly totalBytes: Effect.Effect<number>
}

export class SignalCacheTag extends Context.Tag("@skastr0/pulsar-core/SignalCache")<
  SignalCacheTag,
  SignalCache
>() {}

const entryByteSize = (entry: TieredCacheEntry<unknown>): number =>
  Buffer.byteLength(JSON.stringify(entry), "utf8")

const makeInMemoryCache: Effect.Effect<SignalCache> = Effect.gen(function* () {
  const store = yield* Ref.make(new Map<string, TieredCacheEntry<unknown>>())
  return {
    get: <A>(key: CacheKey) =>
      Ref.get(store).pipe(
        Effect.map((map) => {
          const entry = map.get(cacheKeyString(key)) as TieredCacheEntry<A> | undefined
          return Option.fromNullable(entry?.value)
        }),
      ),
    set: <A>(key: CacheKey, value: A) =>
      Ref.update(store, (map) => {
        const next = new Map(map)
        next.set(cacheKeyString(key), buildTieredCacheEntry(value))
        return next
      }),
    getTiered: <A>(key: CacheKey, options?: CacheReadOptions) =>
      Ref.get(store).pipe(
        Effect.map((map) =>
          evaluateTieredCacheEntry(
            map.get(cacheKeyString(key)) as TieredCacheEntry<A> | undefined,
            options,
          ),
        ),
      ),
    setTiered: <A>(key: CacheKey, value: A, options?: CacheWriteOptions) =>
      Ref.update(store, (map) => {
        const next = new Map(map)
        next.set(cacheKeyString(key), buildTieredCacheEntry(value, options))
        return next
      }),
    size: Ref.get(store).pipe(Effect.map((map) => map.size)),
    totalBytes: Ref.get(store).pipe(
      Effect.map((map) =>
        [...map.values()].reduce((sum, entry) => sum + entryByteSize(entry), 0),
      ),
    ),
  }
})

export const InMemoryCacheLayer = Layer.effect(SignalCacheTag, makeInMemoryCache)
