import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  DEFAULT_HALF_LIFE_DAYS,
  computeEffectiveConfidence,
  type CacheKey,
} from "../cache.js"
import { makeDiskBackedCache } from "../cache-disk.js"

describe("tiered disk cache", () => {
  test("round-trips tiered entries through JSONL persistence", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "taste-codec-cache-"))
    const key: CacheKey = { signalId: "TEST-T2", contentHash: "content", configHash: "config" }

    try {
      const cache = await Effect.runPromise(makeDiskBackedCache({ cacheDir }))
      await Effect.runPromise(
        cache.setTiered(key, { score: 0.8 }, { tier: 2, refVersionHash: "ref-v1" }),
      )

      const reloaded = await Effect.runPromise(makeDiskBackedCache({ cacheDir }))
      const hit = await Effect.runPromise(
        reloaded.getTiered<{ score: number }>(key, { tier: 2, refVersionHash: "ref-v1" }),
      )

      expect(hit.status).toBe("hit")
      expect(hit.value?.score).toBe(0.8)
      expect(await Effect.runPromise(reloaded.size)).toBe(1)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("invalidates tier 2 entries when reference version changes", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "taste-codec-cache-ref-"))
    const key: CacheKey = { signalId: "TEST-T2", contentHash: "content", configHash: "config" }

    try {
      const cache = await Effect.runPromise(makeDiskBackedCache({ cacheDir }))
      await Effect.runPromise(
        cache.setTiered(key, { score: 1 }, { tier: 2, refVersionHash: "ref-v1" }),
      )

      const miss = await Effect.runPromise(
        cache.getTiered(key, { tier: 2, refVersionHash: "ref-v2" }),
      )
      expect(miss.status).toBe("miss")
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("invalidates tier 3 entries on model change and confidence decay", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "taste-codec-cache-tier3-"))
    const key: CacheKey = { signalId: "TEST-T3", contentHash: "content", configHash: "config" }
    const computedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    try {
      const cache = await Effect.runPromise(makeDiskBackedCache({ cacheDir }))
      await Effect.runPromise(
        cache.setTiered(
          key,
          { score: 0.5 },
          {
            tier: 3,
            modelId: "gpt-test-v1",
            baseConfidence: 0.9,
            halfLifeDays: 30,
            computedAt,
          },
        ),
      )

      const stale = await Effect.runPromise(
        cache.getTiered<{ score: number }>(key, {
          tier: 3,
          modelId: "gpt-test-v1",
          confidenceThreshold: 0.5,
          staleMode: "mark-stale",
        }),
      )
      expect(stale.status).toBe("stale")
      expect(stale.effectiveConfidence).toBeLessThan(0.5)

      const modelMiss = await Effect.runPromise(
        cache.getTiered(key, { tier: 3, modelId: "gpt-test-v2" }),
      )
      expect(modelMiss.status).toBe("miss")

      const entryConfidence = computeEffectiveConfidence(
        {
          value: { score: 0.5 },
          computedAt,
          tier: 3,
          refVersionHash: undefined,
          modelId: "gpt-test-v1",
          baseConfidence: 0.9,
          halfLifeDays: DEFAULT_HALF_LIFE_DAYS,
        },
        new Date(),
      )
      expect(entryConfidence).toBeLessThan(0.5)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("evicts least-recently-used entries under a size budget", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "taste-codec-cache-lru-"))

    try {
      const warmCache = await Effect.runPromise(
        makeDiskBackedCache({ cacheDir, maxSizeBytes: 10_000_000 }),
      )
      const makeKey = (name: string): CacheKey => ({
        signalId: "TEST-LRU",
        contentHash: name,
        configHash: name,
      })

      await Effect.runPromise(
        warmCache.setTiered(makeKey("a"), { payload: "x".repeat(50) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:00.000Z",
        }),
      )
      await Effect.runPromise(
        warmCache.setTiered(makeKey("b"), { payload: "x".repeat(50) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:01.000Z",
        }),
      )
      const twoEntryBytes = await Effect.runPromise(warmCache.totalBytes)
      await Effect.runPromise(
        warmCache.setTiered(makeKey("c"), { payload: "x".repeat(50) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:02.000Z",
        }),
      )

      const threeEntryBytes = await Effect.runPromise(
        makeDiskBackedCache({ cacheDir, maxSizeBytes: 10_000_000 }).pipe(
          Effect.flatMap((cache) => cache.totalBytes),
        ),
      )
      const constrainedCache = await Effect.runPromise(
        makeDiskBackedCache({
          cacheDir,
          maxSizeBytes: Math.floor((twoEntryBytes + threeEntryBytes) / 2),
        }),
      )

      await Effect.runPromise(
        constrainedCache.setTiered(makeKey("b"), { payload: "x".repeat(50) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:10.000Z",
        }),
      )
      await Effect.runPromise(
        constrainedCache.setTiered(makeKey("d"), { payload: "x".repeat(50) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:11.000Z",
        }),
      )

      const a = await Effect.runPromise(constrainedCache.getTiered(makeKey("a"), { tier: 1 }))
      const b = await Effect.runPromise(constrainedCache.getTiered(makeKey("b"), { tier: 1 }))
      const c = await Effect.runPromise(constrainedCache.getTiered(makeKey("c"), { tier: 1 }))
      const d = await Effect.runPromise(constrainedCache.getTiered(makeKey("d"), { tier: 1 }))

      expect(a.status).toBe("miss")
      expect(b.status).toBe("hit")
      expect(c.status).toBe("miss")
      expect(d.status).toBe("hit")
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("serves 1k concurrent gets across 10k entries within the indexed-read budget", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "taste-codec-cache-bench-"))
    const signalDir = join(cacheDir, "BENCH")
    const filePath = join(signalDir, "entries.jsonl")

    try {
      await mkdir(signalDir, { recursive: true })
      const lines: Array<string> = []
      for (let i = 9_999; i >= 0; i -= 1) {
        lines.push(
          JSON.stringify({
            key: {
              signalId: "BENCH",
              contentHash: `content-${i}`,
              configHash: `config-${i}`,
            },
            entry: {
              value: { value: i },
              computedAt: "2026-04-19T00:00:00.000Z",
              tier: 1,
              refVersionHash: undefined,
              modelId: undefined,
              baseConfidence: 1,
              halfLifeDays: undefined,
            },
            lastAccessedAt: `2026-04-19T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
          }),
        )
      }
      await writeFile(filePath, lines.join("\n"))

      const cache = await Effect.runPromise(makeDiskBackedCache({ cacheDir }))
      const keys = Array.from({ length: 1000 }, (_, index) => ({
        signalId: "BENCH",
        contentHash: `content-${index}`,
        configHash: `config-${index}`,
      }))

      const startedAt = Date.now()
      await Effect.runPromise(
        Effect.forEach(keys, (key) => cache.getTiered(key, { tier: 1 }), {
          concurrency: 1000,
        }),
      )
      const elapsedMs = Date.now() - startedAt
      expect(elapsedMs).toBeLessThan(250)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  }, 120_000)
})
