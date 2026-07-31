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

  test("tiered signal budgets evict only older entries from the same signal", async () => {
    const program = Effect.gen(function* () {
      const cache = yield* SignalCacheTag
      const oldKey = { signalId: "BOUNDED", contentHash: "old", configHash: "v1" }
      const newKey = { signalId: "BOUNDED", contentHash: "new", configHash: "v1" }
      const otherKey = { signalId: "OTHER", contentHash: "stable", configHash: "v1" }

      yield* cache.setTiered(oldKey, { payload: "x".repeat(1_000) }, {
        tier: 1,
        computedAt: "2026-04-19T00:00:00.000Z",
      })
      yield* cache.setTiered(otherKey, { payload: "stable" }, { tier: 1 })
      yield* cache.setTiered(newKey, { payload: "new" }, {
        tier: 1,
        computedAt: "2026-04-19T00:00:01.000Z",
        maxSignalBytes: 400,
      })

      expect((yield* cache.getTiered(oldKey, { tier: 1 })).status).toBe("miss")
      expect((yield* cache.getTiered(newKey, { tier: 1 })).status).toBe("hit")
      expect((yield* cache.getTiered(otherKey, { tier: 1 })).status).toBe("hit")
      expect(yield* cache.size).toBe(2)
    })
    await Effect.runPromise(program.pipe(Effect.provide(InMemoryCacheLayer)))
  })
})
