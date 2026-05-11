import { CATEGORIES, type Category } from "./category.js"
import {
  OBSERVER_OUTPUT_SEMANTICS,
  toObserverJson,
} from "./observer.js"
import type { TimeSeriesEntry } from "./time-series.js"
import {
  DAY_MS,
  compareTimeSeriesEntries,
  endOfIsoWeek,
  isoWeekKey,
  startOfIsoWeek,
} from "./time-series-dates.js"
import type { WeightedEntry } from "./time-series-compaction-types.js"
import {
  aggregateCategoryMetadata,
  aggregateSignalMetadata,
} from "./time-series-metadata.js"
import { aggregateReadiness } from "./time-series-readiness.js"

export const compactTimeSeriesEntries = (
  entries: ReadonlyArray<TimeSeriesEntry>,
  rawRetentionDays: number,
): ReadonlyArray<TimeSeriesEntry> => {
  if (entries.length === 0) return entries
  const latestTimestamp = Date.parse(entries.at(-1)?.timestamp ?? new Date(0).toISOString())
  const retentionCutoff = latestTimestamp - rawRetentionDays * DAY_MS

  const recent = entries.filter((entry) => Date.parse(entry.timestamp) >= retentionCutoff)
  const older = entries.filter((entry) => Date.parse(entry.timestamp) < retentionCutoff)
  if (older.length === 0) return entries

  const byWeek = new Map<string, Array<TimeSeriesEntry>>()
  for (const entry of older) {
    const key = isoWeekKey(new Date(entry.timestamp))
    const bucket = byWeek.get(key) ?? []
    bucket.push(entry)
    byWeek.set(key, bucket)
  }

  const compacted = [...byWeek.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, bucket]) => aggregateWeek(bucket))

  return [...compacted, ...recent].sort(compareTimeSeriesEntries)
}

const aggregateWeek = (entries: ReadonlyArray<TimeSeriesEntry>): TimeSeriesEntry => {
  const weightedEntries = entries.map((entry) => ({
    entry,
    weight: entry.aggregate?.sample_count ?? 1,
  }))
  const totalWeight = weightedEntries.reduce((sum, item) => sum + item.weight, 0)
  const earliest = entries[0]?.timestamp ?? new Date(0).toISOString()
  const latest = entries.at(-1)?.timestamp ?? earliest
  const signalAverages = new Map<string, { category: Category; total: number }>()
  const readiness = aggregateReadiness(weightedEntries, totalWeight)
  const signalMetadata = aggregateSignalMetadata(weightedEntries)
  const readinessSampleCount = weightedEntries
    .filter(({ entry }) => entry.observerOutput.readiness !== undefined)
    .reduce((sum, item) => sum + item.weight, 0)

  const categories = Object.fromEntries(
    CATEGORIES.map((category) => {
      let categorySum = 0
      const signals: Record<string, number> = {}

      for (const { entry, weight } of weightedEntries) {
        const snapshot = entry.observerOutput.categories[category]
        categorySum += snapshot.score * weight
        for (const [signalId, score] of Object.entries(snapshot.signals)) {
          const existing = signalAverages.get(signalId) ?? { category, total: 0 }
          existing.total += score * weight
          signalAverages.set(signalId, existing)
        }
      }

      for (const [signalId, average] of signalAverages.entries()) {
        if (average.category === category) {
          signals[signalId] = average.total / totalWeight
        }
      }

      return [
        category,
        {
          score: categorySum / totalWeight,
          signals,
          ...aggregateCategoryMetadata(weightedEntries, category, totalWeight),
        },
      ]
    }),
  ) as ReturnType<typeof toObserverJson>["categories"]

  const minimum = computeAggregateMinimum(signalAverages, totalWeight)
  const weightedMean =
    weightedEntries.reduce(
      (sum, { entry, weight }) => sum + entry.observerOutput.weighted_mean * weight,
      0,
    ) / totalWeight
  const hardGateStatus = weightedEntries.some(
    ({ entry }) => entry.observerOutput.hard_gate_status === "fail",
  )
    ? "fail"
    : "pass"
  const commitShas = weightedEntries.flatMap(({ entry }) =>
    entry.aggregate?.commit_shas ?? [entry.sha],
  )
  const weekStart = startOfIsoWeek(new Date(earliest))
  const weekEnd = endOfIsoWeek(new Date(latest))

  return {
    sha: `aggregate:${isoWeekKey(weekStart)}`,
    timestamp: weekEnd.toISOString(),
    source: "weekly-average",
    aggregate: {
      kind: "weekly-average",
      from: weekStart.toISOString(),
      to: weekEnd.toISOString(),
      sample_count: commitShas.length,
      commit_shas: commitShas,
      observer_semantics:
        readiness === undefined ? "legacy-compatibility" : "readiness-aware",
      readiness_sample_count: readinessSampleCount,
      ...(readiness === undefined
        ? {
            compatibility_reason:
              readinessSampleCount === 0
                ? "source rows predate readiness/applicability metadata"
                : "source rows mix readiness-aware and legacy observer semantics",
          }
        : {}),
    },
    observerOutput: {
      observer_semantics: OBSERVER_OUTPUT_SEMANTICS,
      categories,
      minimum,
      weighted_mean: weightedMean,
      ...(readiness !== undefined ? { readiness } : {}),
      hard_gate_status: hardGateStatus,
      hard_gate_violations: [],
      ...(signalMetadata !== undefined ? { signal_metadata: signalMetadata } : {}),
    },
    inactiveSignals: [],
  }
}

const computeAggregateMinimum = (
  signals: ReadonlyMap<string, { category: Category; total: number }>,
  totalWeight: number,
): ReturnType<typeof toObserverJson>["minimum"] => {
  let best:
    | {
        signal: string
        category: Category
        score: number
      }
    | undefined

  for (const [signalId, aggregate] of signals.entries()) {
    const score = aggregate.total / totalWeight
    if (
      best === undefined ||
      score < best.score ||
      (score === best.score && signalId.localeCompare(best.signal) < 0)
    ) {
      best = { signal: signalId, category: aggregate.category, score }
    }
  }

  if (best === undefined) return undefined
  return {
    signal: best.signal,
    category: best.category,
    score: best.score,
    detail: `Compacted weekly average across ${totalWeight} entries`,
  }
}
