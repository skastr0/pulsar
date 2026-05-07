import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { InMemoryCacheLayer, SignalCacheTag, cacheKeyString } from "../cache.js"

describe("SignalCache (in-memory)", () => {
  test("round-trips values by composite key", async () => {
    const program = Effect.gen(function* () {
      const cache = yield* SignalCacheTag
      const key = { signalId: "MOCK-01", contentHash: "abc", configHash: "def" }
      const miss = yield* cache.get<{ count: number }>(key)
      expect(Option.isNone(miss)).toBe(true)

      yield* cache.set(key, { count: 5 })
      const hit = yield* cache.get<{ count: number }>(key)
      expect(Option.isSome(hit)).toBe(true)
      if (Option.isSome(hit)) expect(hit.value.count).toBe(5)
      expect(yield* cache.size).toBe(1)
    })
    await Effect.runPromise(program.pipe(Effect.provide(InMemoryCacheLayer)))
  })

  test("cacheKeyString combines all three parts", () => {
    expect(cacheKeyString({ signalId: "A", contentHash: "B", configHash: "C" })).toBe("A::B::C")
  })

  test("differs by configHash — changing thresholds invalidates score cache", async () => {
    const program = Effect.gen(function* () {
      const cache = yield* SignalCacheTag
      yield* cache.set({ signalId: "S", contentHash: "c1", configHash: "v1" }, 1)
      const other = yield* cache.get({ signalId: "S", contentHash: "c1", configHash: "v2" })
      expect(Option.isNone(other)).toBe(true)
    })
    await Effect.runPromise(program.pipe(Effect.provide(InMemoryCacheLayer)))
  })
})
