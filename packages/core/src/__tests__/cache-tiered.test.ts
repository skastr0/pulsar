import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { describe, expect, spyOn, test } from "bun:test"
import { Effect } from "effect"
import {
  SignalCacheTag,
  type CacheConfig,
  type CacheKey,
  type SignalCache,
} from "../cache.js"
import { DiskBackedCacheLayer } from "../cache-disk.js"

const makeDiskCache = (config?: CacheConfig): Promise<SignalCache> =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* SignalCacheTag
    }).pipe(Effect.provide(DiskBackedCacheLayer(config))),
  )

const persistedTierOneRecord = (
  key: CacheKey,
  value: unknown,
  computedAt = "2026-04-19T00:00:00.000Z",
): string =>
  JSON.stringify({
    key,
    entry: {
      value,
      computedAt,
      tier: 1,
      baseConfidence: 1,
    },
    lastAccessedAt: computedAt,
  })

describe("tiered disk cache", () => {
  test("round-trips tiered entries through JSONL persistence", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-"))
    const key: CacheKey = { signalId: "TEST-T2", contentHash: "content", configHash: "config" }

    try {
      const cache = await makeDiskCache({ cacheDir })
      await Effect.runPromise(
        cache.setTiered(key, { score: 0.8 }, { tier: 2, refVersionHash: "ref-v1" }),
      )

      const reloaded = await makeDiskCache({ cacheDir })
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
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-ref-"))
    const key: CacheKey = { signalId: "TEST-T2", contentHash: "content", configHash: "config" }

    try {
      const cache = await makeDiskCache({ cacheDir })
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
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-tier3-"))
    const key: CacheKey = { signalId: "TEST-T3", contentHash: "content", configHash: "config" }
    const computedAt = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

    try {
      const cache = await makeDiskCache({ cacheDir })
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
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("evicts least-recently-used entries under a size budget", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-lru-"))

    try {
      const warmCache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
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

      const fullCache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      const threeEntryBytes = await Effect.runPromise(fullCache.totalBytes)
      const constrainedCache = await makeDiskCache({
        cacheDir,
        maxSizeBytes: Math.floor((twoEntryBytes + threeEntryBytes) / 2),
      })

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

  test("compacts an oversized signal bucket without rewriting other buckets", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-signal-budget-"))
    const maxSignalBytes = 1_500
    const makeKey = (signalId: string, name: string): CacheKey => ({
      signalId,
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })

    try {
      const cache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      const unrelatedKey = makeKey("OTHER", "stable")
      await Effect.runPromise(
        cache.setTiered(unrelatedKey, { payload: "unchanged" }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:00.000Z",
        }),
      )
      const unrelatedPath = join(cacheDir, "OTHER", "entries.jsonl")
      const unrelatedBefore = await readFile(unrelatedPath, "utf8")

      const legacyKeys = Array.from({ length: 3 }, (_, index) =>
        makeKey("BOUNDED", `legacy-${index}`),
      )
      for (const [index, key] of legacyKeys.entries()) {
        await Effect.runPromise(
          cache.setTiered(key, { payload: "x".repeat(2_000) }, {
            tier: 1,
            computedAt: `2026-04-19T00:00:0${index + 1}.000Z`,
          }),
        )
      }
      const boundedPath = join(cacheDir, "BOUNDED", "entries.jsonl")
      expect(Buffer.byteLength(await readFile(boundedPath, "utf8"), "utf8"))
        .toBeGreaterThan(maxSignalBytes)

      const newestKey = makeKey("BOUNDED", "newest")
      await Effect.runPromise(
        cache.setTiered(newestKey, { payload: "new" }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:10.000Z",
          maxSignalBytes,
        }),
      )

      const boundedAfter = await readFile(boundedPath, "utf8")
      expect(Buffer.byteLength(boundedAfter, "utf8")).toBeLessThanOrEqual(maxSignalBytes)
      expect(await readFile(unrelatedPath, "utf8")).toBe(unrelatedBefore)

      const reloaded = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      const newest = await Effect.runPromise(
        reloaded.getTiered<{ payload: string }>(newestKey, { tier: 1 }),
      )
      expect(newest.status).toBe("hit")
      expect(newest.value?.payload).toBe("new")
      for (const legacyKey of legacyKeys) {
        const legacy = await Effect.runPromise(
          reloaded.getTiered(legacyKey, { tier: 1 }),
        )
        expect(legacy.status).toBe("miss")
      }
      expect(
        (await Effect.runPromise(
          reloaded.getTiered<{ payload: string }>(unrelatedKey, { tier: 1 }),
        )).value?.payload,
      ).toBe("unchanged")
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("replaces an oversized legacy bucket without parsing it on a bounded read/write", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-legacy-budget-"))
    const signalId = "BOUNDED-LEGACY"
    const signalDir = join(cacheDir, signalId)
    const filePath = join(signalDir, "entries.jsonl")
    const maxSignalBytes = 700
    const legacyKey: CacheKey = {
      signalId,
      contentHash: "legacy",
      configHash: "legacy",
    }
    const newestKey: CacheKey = {
      signalId,
      contentHash: "newest",
      configHash: "newest",
    }
    const legacyMarker = "legacy-record-must-not-be-parsed"

    try {
      await mkdir(signalDir, { recursive: true })
      const legacyLine = persistedTierOneRecord(
        legacyKey,
        { payload: `${legacyMarker}:${"x".repeat(4_000)}` },
      )
      const malformedLine = `{"marker":"${legacyMarker}","payload":"${"y".repeat(1_000)}`
      await writeFile(filePath, `${legacyLine}\n${malformedLine}`)
      expect(Buffer.byteLength(await readFile(filePath, "utf8"), "utf8"))
        .toBeGreaterThan(maxSignalBytes)

      const cache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      const originalParse = JSON.parse
      let legacyParseCount = 0
      const parseSpy = spyOn(JSON, "parse").mockImplementation((text, reviver) => {
        if (text.includes(legacyMarker)) legacyParseCount += 1
        return originalParse(text, reviver)
      })
      try {
        const boundedMiss = await Effect.runPromise(
          cache.getTiered(legacyKey, { tier: 1, maxSignalBytes }),
        )
        expect(boundedMiss.status).toBe("miss")
        await Effect.runPromise(
          cache.setTiered(newestKey, { payload: "new" }, {
            tier: 1,
            maxSignalBytes,
          }),
        )
      } finally {
        parseSpy.mockRestore()
      }

      expect(legacyParseCount).toBe(0)
      const persisted = await readFile(filePath, "utf8")
      expect(Buffer.byteLength(persisted, "utf8")).toBeLessThanOrEqual(maxSignalBytes)
      expect(persisted).not.toContain(legacyMarker)

      const reloaded = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      expect(
        (await Effect.runPromise(reloaded.getTiered(newestKey, { tier: 1 }))).status,
      ).toBe("hit")
      expect(
        (await Effect.runPromise(reloaded.getTiered(legacyKey, { tier: 1 }))).status,
      ).toBe("miss")
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("preserves oversized legacy buckets for unbudgeted reads", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-legacy-read-"))
    const signalId = "UNBOUNDED-LEGACY"
    const signalDir = join(cacheDir, signalId)
    const filePath = join(signalDir, "entries.jsonl")
    const key: CacheKey = {
      signalId,
      contentHash: "legacy",
      configHash: "legacy",
    }

    try {
      await mkdir(signalDir, { recursive: true })
      const persisted = persistedTierOneRecord(key, { payload: "x".repeat(4_000) })
      await writeFile(filePath, persisted)

      const cache = await makeDiskCache({ cacheDir })
      const hit = await Effect.runPromise(
        cache.getTiered<{ payload: string }>(key, { tier: 1 }),
      )

      expect(hit.status).toBe("hit")
      expect(hit.value?.payload).toHaveLength(4_000)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("rejects the just-written entry when it alone exceeds the signal budget", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-signal-budget-entry-"))
    const makeKey = (name: string): CacheKey => ({
      signalId: "BOUNDED",
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })

    try {
      const cache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      await Effect.runPromise(
        cache.setTiered(makeKey("old"), { payload: "old" }, { tier: 1 }),
      )
      await Effect.runPromise(
        cache.setTiered(
          makeKey("new"),
          { payload: "x".repeat(2_000) },
          { tier: 1, maxSignalBytes: 100 },
        ),
      )

      const reloaded = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      expect(
        (await Effect.runPromise(reloaded.getTiered(makeKey("old"), { tier: 1 }))).status,
      ).toBe("miss")
      expect(
        (await Effect.runPromise(reloaded.getTiered(makeKey("new"), { tier: 1 }))).status,
      ).toBe("miss")
      expect(await readFile(join(cacheDir, "BOUNDED", "entries.jsonl"), "utf8"))
        .toBe("")
      expect(await Effect.runPromise(reloaded.totalBytes)).toBe(0)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("serves 1k concurrent gets across 10k entries within the indexed-read budget", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-bench-"))
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

      const cache = await makeDiskCache({ cacheDir })
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
      // This is a regression guard for indexed reads, not a scheduler benchmark.
      // Full Turbo runs can add enough contention that sub-250ms wall-clock
      // assertions become noisy on otherwise healthy indexed lookups.
      expect(elapsedMs).toBeLessThan(1_000)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  }, 120_000)

  test("a cold miss does not parse record bodies", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-lazy-"))
    const signalId = "LAZY"
    const signalDir = join(cacheDir, signalId)
    const filePath = join(signalDir, "entries.jsonl")
    const makeKey = (name: string): CacheKey => ({
      signalId,
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })
    const bodyMarker = "body-must-not-be-parsed"

    try {
      await mkdir(signalDir, { recursive: true })
      const lines = Array.from({ length: 4 }, (_, index) =>
        persistedTierOneRecord(makeKey(`record-${index}`), {
          payload: `${bodyMarker}:${"x".repeat(512)}`,
        }),
      )
      await writeFile(filePath, lines.join("\n"))

      const cache = await makeDiskCache({ cacheDir })
      const originalParse = JSON.parse
      const parsedBodies: string[] = []
      const parseSpy = spyOn(JSON, "parse").mockImplementation((text, reviver) => {
        if (typeof text === "string" && text.includes(bodyMarker)) parsedBodies.push(text)
        return originalParse(text, reviver)
      })
      let missStatus: string
      try {
        // A miss still indexes the file for its keys and timestamps, but the
        // retained record representation is the raw line, not a parsed value.
        const miss = await Effect.runPromise(
          cache.getTiered(makeKey("absent"), { tier: 1 }),
        )
        missStatus = miss.status
      } finally {
        parseSpy.mockRestore()
      }

      expect(missStatus).toBe("miss")
      expect(parsedBodies.length).toBeGreaterThan(0)
      // The parsed body was transient indexing metadata, not a retained value:
      // a second miss must not re-serialize or re-parse any record body.
      const parsedBefore = parsedBodies.length
      expect(
        (await Effect.runPromise(cache.getTiered(makeKey("absent"), { tier: 1 }))).status,
      ).toBe("miss")
      expect(parsedBodies.length).toBe(parsedBefore)
      // The file is untouched by misses, and a hit parses exactly one body.
      expect((await Effect.runPromise(cache.getTiered(makeKey("record-2"), { tier: 1 }))).status)
        .toBe("hit")
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("a bounded read never parses an oversized record body", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-bounded-guard-"))
    const signalId = "BOUNDED-GUARD"
    const signalDir = join(cacheDir, signalId)
    const filePath = join(signalDir, "entries.jsonl")
    const key: CacheKey = { signalId, contentHash: "huge", configHash: "huge" }
    const bodyMarker = "oversized-body"

    try {
      await mkdir(signalDir, { recursive: true })
      const line = persistedTierOneRecord(key, {
        payload: `${bodyMarker}:${"x".repeat(4_000)}`,
      })
      await writeFile(filePath, line)

      const cache = await makeDiskCache({ cacheDir })
      const originalParse = JSON.parse
      let bodyParseCount = 0
      const parseSpy = spyOn(JSON, "parse").mockImplementation((text, reviver) => {
        if (typeof text === "string" && text.includes(bodyMarker)) bodyParseCount += 1
        return originalParse(text, reviver)
      })
      try {
        const miss = await Effect.runPromise(
          cache.getTiered(key, { tier: 1, maxSignalBytes: 256 }),
        )
        expect(miss.status).toBe("miss")
      } finally {
        parseSpy.mockRestore()
      }

      expect(bodyParseCount).toBe(0)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("evicts records from unvisited buckets using the lightweight index", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-global-lru-"))
    const makeKey = (signalId: string, name: string): CacheKey => ({
      signalId,
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })
    const oldest = makeKey("LRU-B", "oldest")
    const survivor = makeKey("LRU-A", "newest")

    try {
      const cache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      await Effect.runPromise(
        cache.setTiered(oldest, { payload: "x".repeat(3_000) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:00.000Z",
        }),
      )
      await Effect.runPromise(
        cache.setTiered(survivor, { payload: "y".repeat(1_000) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:05.000Z",
        }),
      )

      // A fresh instance must discover the unvisited bucket from its index
      // alone and evict its oldest record before writing the new one.
      const constrained = await makeDiskCache({
        cacheDir,
        maxSizeBytes: 3_600,
      })
      await Effect.runPromise(
        constrained.setTiered(makeKey("LRU-C", "new"), { payload: "z".repeat(200) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:10.000Z",
        }),
      )

      const reloaded = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      expect(
        (await Effect.runPromise(reloaded.getTiered(oldest, { tier: 1 }))).status,
      ).toBe("miss")
      expect(
        (await Effect.runPromise(reloaded.getTiered(survivor, { tier: 1 }))).status,
      ).toBe("hit")
      expect(
        (await Effect.runPromise(reloaded.getTiered(makeKey("LRU-C", "new"), { tier: 1 }))).status,
      ).toBe("hit")
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("keeps persisted LRU order after a read hit under a write budget", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-hit-lru-"))
    const makeKey = (name: string): CacheKey => ({
      signalId: "HIT-LRU",
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })
    const youngest = makeKey("a")
    const middle = makeKey("b")

    try {
      const cache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      await Effect.runPromise(
        cache.setTiered(youngest, { payload: "a".repeat(500) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:00.000Z",
        }),
      )
      await Effect.runPromise(
        cache.setTiered(middle, { payload: "b".repeat(500) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:01.000Z",
        }),
      )

      // `youngest` is the least recently used before the hit; the hit must
      // promote it above `middle`.
      expect((await Effect.runPromise(cache.getTiered(youngest, { tier: 1 }))).status)
        .toBe("hit")

      // Budget for two ~700-byte records. Inserting a third must evict the
      // least recently used record, which is now `middle`.
      await Effect.runPromise(
        cache.setTiered(makeKey("c"), { payload: "c".repeat(500) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:02.000Z",
          maxSignalBytes: 1_600,
        }),
      )

      const reloaded = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      expect(
        (await Effect.runPromise(reloaded.getTiered(youngest, { tier: 1 }))).status,
      ).toBe("hit")
      expect(
        (await Effect.runPromise(reloaded.getTiered(middle, { tier: 1 }))).status,
      ).toBe("miss")
      expect(
        (await Effect.runPromise(reloaded.getTiered(makeKey("c"), { tier: 1 }))).status,
      ).toBe("hit")
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("leaves no temp file behind when an atomic bucket write fails", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-atomic-"))
    const signalId = "ATOMIC"
    const key: CacheKey = { signalId, contentHash: "c", configHash: "k" }

    try {
      // A directory at the bucket path makes the final atomic rename fail
      // after the temp file has been fully written.
      await mkdir(join(cacheDir, signalId, "entries.jsonl"), { recursive: true })
      const cache = await makeDiskCache({ cacheDir })

      await expect(
        Effect.runPromise(cache.setTiered(key, { payload: "x".repeat(100) }, { tier: 1 })),
      ).rejects.toBeDefined()

      const bucketEntries = await readdir(join(cacheDir, signalId), { withFileTypes: true })
      const tempFiles = bucketEntries
        .map((entry) => entry.name)
        .filter((name) => name.startsWith(".") && name.endsWith(".tmp"))
      expect(tempFiles).toEqual([])
      expect(bucketEntries.map((entry) => entry.name)).toEqual(["entries.jsonl"])
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("rewrites the bucket to empty when trimming deletes every record", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-empty-trim-"))
    const signalId = "SHRINK"
    const filePath = join(cacheDir, signalId, "entries.jsonl")
    const makeKey = (name: string): CacheKey => ({
      signalId,
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })

    try {
      const cache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      await Effect.runPromise(
        cache.setTiered(makeKey("a"), { payload: "a".repeat(2_000) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:00.000Z",
        }),
      )
      await Effect.runPromise(
        cache.setTiered(makeKey("b"), { payload: "b".repeat(2_000) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:01.000Z",
        }),
      )
      expect(Buffer.byteLength(await readFile(filePath, "utf8"), "utf8"))
        .toBeGreaterThan(0)

      // An entry that alone exceeds the budget removes both records; the file
      // must not keep the stale records that are no longer part of the index.
      await Effect.runPromise(
        cache.setTiered(makeKey("c"), { payload: "c".repeat(2_000) }, {
          tier: 1,
          computedAt: "2026-04-19T00:00:02.000Z",
          maxSignalBytes: 100,
        }),
      )

      expect(await readFile(filePath, "utf8")).toBe("")
      const reloaded = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      expect(await Effect.runPromise(reloaded.size)).toBe(0)
      expect(await Effect.runPromise(reloaded.totalBytes)).toBe(0)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("sweeps orphaned temp files at startup but keeps live writers'", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-sweep-"))
    const signalDir = join(cacheDir, "SWEEP")
    const orphanName = ".entries.jsonl.999999.1.tmp"
    const liveName = `.entries.jsonl.${process.pid}.1.tmp`

    try {
      await mkdir(signalDir, { recursive: true })
      await writeFile(join(signalDir, orphanName), "partial record from a dead writer")
      await writeFile(join(signalDir, liveName), "partial record from a live writer")
      await writeFile(
        join(signalDir, "entries.jsonl"),
        persistedTierOneRecord(
          { signalId: "SWEEP", contentHash: "c", configHash: "k" },
          { payload: "kept" },
        ),
      )

      const cache = await makeDiskCache({ cacheDir })
      expect((await Effect.runPromise(cache.getTiered<{ payload: string }>(
        { signalId: "SWEEP", contentHash: "c", configHash: "k" },
        { tier: 1 },
      ))).value?.payload).toBe("kept")

      const remaining = (await readdir(signalDir)).sort()
      expect(remaining).toEqual([liveName, "entries.jsonl"])
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("serves concurrent first accesses without a false miss", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-concurrent-"))
    const signalDir = join(cacheDir, "CONCURRENT")
    const filePath = join(signalDir, "entries.jsonl")
    const makeKey = (name: string): CacheKey => ({
      signalId: "CONCURRENT",
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })

    try {
      await mkdir(signalDir, { recursive: true })
      await writeFile(
        filePath,
        [
          persistedTierOneRecord(makeKey("a"), { payload: "a".repeat(1_000) }),
          persistedTierOneRecord(makeKey("b"), { payload: "b".repeat(1_000) }),
          persistedTierOneRecord(makeKey("c"), { payload: "c".repeat(1_000) }),
        ].join("\n"),
      )

      const cache = await makeDiskCache({ cacheDir })
      // The first access starts the load; every concurrent access must await
      // the shared in-flight load instead of observing an empty bucket.
      const results = await Effect.runPromise(
        Effect.forEach(
          [
            makeKey("a"),
            makeKey("b"),
            makeKey("c"),
            makeKey("a"),
            makeKey("b"),
            makeKey("c"),
            makeKey("a"),
            makeKey("b"),
          ],
          (key) => cache.getTiered<{ payload: string }>(key, { tier: 1 }),
          { concurrency: 8 },
        ),
      )

      expect(results.map((result) => result.status)).toEqual([
        "hit",
        "hit",
        "hit",
        "hit",
        "hit",
        "hit",
        "hit",
        "hit",
      ])
      expect(await Effect.runPromise(cache.size)).toBe(3)
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })

  test("size and totalBytes await the in-flight full index load", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "pulsar-cache-full-index-"))
    const makeKey = (name: string): CacheKey => ({
      signalId: "FULL-INDEX",
      contentHash: `content-${name}`,
      configHash: `config-${name}`,
    })

    try {
      const seed = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      await Effect.runPromise(
        seed.setTiered(makeKey("a"), { payload: "a".repeat(1_000) }, { tier: 1 }),
      )
      await Effect.runPromise(
        seed.setTiered(makeKey("b"), { payload: "b".repeat(1_000) }, { tier: 1 }),
      )

      const cache = await makeDiskCache({ cacheDir, maxSizeBytes: 10_000_000 })
      const [size, totalBytes] = await Effect.runPromise(
        Effect.all([cache.size, cache.totalBytes], { concurrency: "unbounded" }),
      )
      expect(size).toBe(2)
      expect(totalBytes).toBe(await Effect.runPromise(cache.totalBytes))
    } finally {
      await rm(cacheDir, { recursive: true, force: true })
    }
  })
})
