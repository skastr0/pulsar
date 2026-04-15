import { Context, Effect, Layer, Option, Ref } from "effect"

export interface CacheKey {
  readonly signalId: string
  readonly contentHash: string
  readonly configHash: string
}

export const cacheKeyString = (key: CacheKey): string =>
  `${key.signalId}::${key.contentHash}::${key.configHash}`

export interface SignalCache {
  readonly get: <A>(key: CacheKey) => Effect.Effect<Option.Option<A>>
  readonly set: <A>(key: CacheKey, value: A) => Effect.Effect<void>
  readonly size: Effect.Effect<number>
}

export class SignalCacheTag extends Context.Tag("@taste-codec/core/SignalCache")<
  SignalCacheTag,
  SignalCache
>() {}

/**
 * In-memory cache. Persistent backends land later (scoring engine, TC-017).
 */
export const makeInMemoryCache: Effect.Effect<SignalCache> = Effect.gen(function* () {
  const store = yield* Ref.make(new Map<string, unknown>())
  return {
    get: <A>(key: CacheKey) =>
      Ref.get(store).pipe(
        Effect.map((m) => Option.fromNullable(m.get(cacheKeyString(key)) as A | undefined)),
      ),
    set: <A>(key: CacheKey, value: A) =>
      Ref.update(store, (m) => {
        const next = new Map(m)
        next.set(cacheKeyString(key), value)
        return next
      }),
    size: Ref.get(store).pipe(Effect.map((m) => m.size)),
  }
})

export const InMemoryCacheLayer = Layer.effect(SignalCacheTag, makeInMemoryCache)
