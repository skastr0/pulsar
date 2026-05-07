import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect, Option } from "effect"
import { createTimeSeriesServices, type TimeSeriesEntry } from "../time-series.js"

const makeEntry = (
  sha: string,
  timestamp: string,
  score: number,
): TimeSeriesEntry => ({
  sha,
  timestamp,
  source: "raw" as const,
  observerOutput: {
    categories: {
      "architectural-drift": { score, signals: { A: score } },
      "dependency-entropy": { score: 1, signals: {} },
      "abstraction-bloat": { score: 1, signals: {} },
      "legibility-decay": { score: 1, signals: {} },
      "generated-slop": { score: 1, signals: {} },
      "review-pain": { score: 1, signals: {} },
    },
    minimum: { signal: "A", category: "architectural-drift", score, detail: "detail" },
    weighted_mean: score,
    hard_gate_status: score < 0.5 ? ("fail" as const) : ("pass" as const),
    hard_gate_violations: [],
  },
  signalDiagnostics: {
    A: [{ severity: "warn" as const, message: `score ${score}` }],
  },
  inactiveSignals: [],
})

const makeReadinessEntry = (
  sha: string,
  timestamp: string,
  score: number,
): TimeSeriesEntry => {
  const base = makeEntry(sha, timestamp, score)

  return {
    ...base,
    observerOutput: {
      ...base.observerOutput,
      categories: Object.fromEntries(
        Object.entries(base.observerOutput.categories).map(([category, snapshot]) => [
          category,
          {
            ...snapshot,
            signalCount: category === "architectural-drift" ? 1 : 0,
            applicableSignalCount: category === "architectural-drift" ? 1 : 0,
            activeSignalIds: category === "architectural-drift" ? ["A"] : [],
          },
        ]),
      ) as unknown as TimeSeriesEntry["observerOutput"]["categories"],
      readiness: {
        score,
        pressure: 1 - score,
        status: score >= 0.85 ? "green" : "yellow",
        aggregation: {
          strategy: "pressure-pnorm-local-max",
          p: 12,
          mean_pressure: 1 - score,
          pnorm_pressure: 1 - score,
          max_local_pressure: 1 - score,
          failed_signal_pressure: 0,
          hard_gate_pressure: 0,
          hard_gate_score_cap: 0.2,
          local_warning_threshold: 0.4,
          local_poison_threshold: 0.75,
          local_warning_gain: 0.75,
          applicable_signal_count: 1,
          ignored_signal_count: 0,
          failed_signal_count: 0,
        },
        top_pressures: [
          {
            signal_id: "A",
            category: "architectural-drift",
            score,
            raw_pressure: 1 - score,
            effective_pressure: 1 - score,
            weight: 1,
            confidence: 1,
            applicability: "applicable",
          },
        ],
      },
      signal_metadata: {
        A: {
          applicability: "applicable",
          effectiveConfidence: 1,
          baseConfidence: 1,
          computedAt: timestamp,
        },
      },
    },
  }
}

describe("time series persistence", () => {
  test("writes then reads entries and keeps same-sha writes idempotent", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-ts-series-"))
    try {
      const services = createTimeSeriesServices(repoPath)
      await Effect.runPromise(
        services.writer.append(makeEntry("abc123", "2026-04-15T10:00:00.000Z", 0.9)),
      )
      const duplicate = await Effect.runPromise(
        services.writer.append(makeEntry("abc123", "2026-04-15T10:00:00.000Z", 0.7)),
      )
      const entries = await Effect.runPromise(services.reader.entries())
      const latest = await Effect.runPromise(services.reader.latest)

      expect(duplicate.status).toBe("duplicate")
      expect(entries).toHaveLength(1)
      expect(entries[0]?.sha).toBe("abc123")
      expect(Option.isSome(latest)).toBe(true)
      if (Option.isSome(latest)) {
        expect(latest.value.observerOutput.weighted_mean).toBe(0.9)
      }
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("compacts older raw entries into weekly averages while preserving recent raw data", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-ts-compact-"))
    try {
      const services = createTimeSeriesServices(repoPath, {
        compactionThreshold: 5,
        rawRetentionDays: 30,
      })

      const older = [
        makeEntry("a1", "2026-01-01T10:00:00.000Z", 0.7),
        makeEntry("a2", "2026-01-02T10:00:00.000Z", 0.9),
        makeEntry("a3", "2026-01-08T10:00:00.000Z", 0.8),
        makeEntry("a4", "2026-01-09T10:00:00.000Z", 0.6),
      ]
      const recent = [
        makeEntry("b1", "2026-04-10T10:00:00.000Z", 0.95),
        makeEntry("b2", "2026-04-15T10:00:00.000Z", 0.96),
      ]

      for (const entry of [...older, ...recent]) {
        await Effect.runPromise(services.writer.append(entry))
      }

      const entries = await Effect.runPromise(services.reader.entries())
      expect(entries.length).toBeLessThan(6)
      expect(entries.some((entry) => entry.source === "weekly-average")).toBe(true)
      expect(entries.some((entry) => entry.sha === "b1")).toBe(true)
      expect(entries.some((entry) => entry.sha === "b2")).toBe(true)
      const compacted = entries.find((entry) => entry.source === "weekly-average")
      expect(compacted?.aggregate?.commit_shas.includes("a1")).toBe(true)
      expect(compacted?.aggregate?.observer_semantics).toBe("legacy-compatibility")
      expect(compacted?.aggregate?.compatibility_reason).toBe(
        "source rows predate readiness/applicability metadata",
      )
      expect(compacted?.observerOutput.readiness).toBeUndefined()
      const resolved = await Effect.runPromise(services.reader.atSha("a2"))
      expect(Option.isSome(resolved)).toBe(true)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("compaction preserves readiness and applicability metadata for readiness-aware buckets", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-ts-readiness-compact-"))
    try {
      const services = createTimeSeriesServices(repoPath, {
        compactionThreshold: 5,
        rawRetentionDays: 30,
      })

      for (const entry of [
        makeReadinessEntry("a1", "2026-01-01T10:00:00.000Z", 0.7),
        makeReadinessEntry("a2", "2026-01-02T10:00:00.000Z", 0.9),
        makeReadinessEntry("a3", "2026-01-08T10:00:00.000Z", 0.8),
        makeReadinessEntry("a4", "2026-01-09T10:00:00.000Z", 0.6),
        makeReadinessEntry("b1", "2026-04-10T10:00:00.000Z", 0.95),
        makeReadinessEntry("b2", "2026-04-15T10:00:00.000Z", 0.96),
      ]) {
        await Effect.runPromise(services.writer.append(entry))
      }

      const compacted = (await Effect.runPromise(services.reader.entries())).find(
        (entry) => entry.source === "weekly-average",
      )

      expect(compacted?.aggregate?.observer_semantics).toBe("readiness-aware")
      expect(compacted?.aggregate?.readiness_sample_count).toBe(2)
      expect(compacted?.observerOutput.observer_semantics).toBe(
        "applicability-aware-readiness-v1",
      )
      expect(compacted?.observerOutput.readiness?.score).toBeCloseTo(0.8, 5)
      expect(compacted?.observerOutput.readiness?.top_pressures[0]).toMatchObject({
        signal_id: "A",
        applicability: "applicable",
      })
      expect(compacted?.observerOutput.signal_metadata?.A?.applicability).toBe(
        "applicable",
      )
      expect(
        compacted?.observerOutput.categories["architectural-drift"].applicableSignalCount,
      ).toBe(1)
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("compaction marks mixed readiness and legacy buckets as compatibility output", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-ts-mixed-compact-"))
    try {
      const services = createTimeSeriesServices(repoPath, {
        compactionThreshold: 5,
        rawRetentionDays: 30,
      })

      for (const entry of [
        makeReadinessEntry("a1", "2026-01-01T10:00:00.000Z", 0.7),
        makeEntry("a2", "2026-01-02T10:00:00.000Z", 0.9),
        makeReadinessEntry("a3", "2026-01-08T10:00:00.000Z", 0.8),
        makeEntry("a4", "2026-01-09T10:00:00.000Z", 0.6),
        makeReadinessEntry("b1", "2026-04-10T10:00:00.000Z", 0.95),
        makeReadinessEntry("b2", "2026-04-15T10:00:00.000Z", 0.96),
      ]) {
        await Effect.runPromise(services.writer.append(entry))
      }

      const compacted = (await Effect.runPromise(services.reader.entries())).find(
        (entry) => entry.source === "weekly-average",
      )

      expect(compacted?.aggregate?.observer_semantics).toBe("legacy-compatibility")
      expect(compacted?.aggregate?.readiness_sample_count).toBe(1)
      expect(compacted?.aggregate?.compatibility_reason).toBe(
        "source rows mix readiness-aware and legacy observer semantics",
      )
      expect(compacted?.observerOutput.readiness).toBeUndefined()
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("serializes concurrent writers with a lock", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-ts-lock-"))
    try {
      const services = createTimeSeriesServices(repoPath)
      await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          Effect.runPromise(
            services.writer.append(
              makeEntry(
                `sha-${index}`,
                `2026-04-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
                0.9,
              ),
            ),
          ),
        ),
      )
      const entries = await Effect.runPromise(services.reader.entries())
      expect(entries).toHaveLength(8)
      expect(entries.map((entry) => entry.sha)).toEqual([
        "sha-0",
        "sha-1",
        "sha-2",
        "sha-3",
        "sha-4",
        "sha-5",
        "sha-6",
        "sha-7",
      ])
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })

  test("reads readiness snapshots written before failed-signal pressure metadata", async () => {
    const repoPath = await mkdtemp(join(tmpdir(), "pulsar-ts-legacy-"))
    try {
      const services = createTimeSeriesServices(repoPath)
      const baseLegacyEntry = makeEntry("legacy", "2026-04-10T10:00:00.000Z", 0.8)
      const legacyEntry = {
        ...baseLegacyEntry,
        observerOutput: {
          ...baseLegacyEntry.observerOutput,
          readiness: {
            score: 0.8,
            pressure: 0.2,
            status: "yellow",
            aggregation: {
              strategy: "pressure-pnorm-local-max",
              p: 12,
              mean_pressure: 0.2,
              pnorm_pressure: 0.2,
              max_local_pressure: 0.2,
              hard_gate_pressure: 0,
              hard_gate_score_cap: 0.2,
              local_warning_threshold: 0.4,
              local_poison_threshold: 0.75,
              local_warning_gain: 0.75,
              applicable_signal_count: 1,
              ignored_signal_count: 0,
              failed_signal_count: 0,
            },
            top_pressures: [],
          },
        },
      }

      await mkdir(join(repoPath, ".pulsar", "time-series"), { recursive: true })
      await writeFile(services.filePath, `${JSON.stringify(legacyEntry)}\n`, "utf8")

      await Effect.runPromise(
        services.writer.append(makeEntry("current", "2026-04-11T10:00:00.000Z", 0.9)),
      )
      const entries = await Effect.runPromise(services.reader.entries())

      expect(entries.map((entry) => entry.sha)).toEqual(["legacy", "current"])
      expect(entries[0]?.observerOutput.readiness?.aggregation.failed_signal_pressure).toBeUndefined()
    } finally {
      await rm(repoPath, { recursive: true, force: true })
    }
  })
})
