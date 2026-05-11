import type {
  ReadinessOutput,
  ReadinessPressure,
} from "./observer.js"
import type { WeightedEntry } from "./time-series-compaction-types.js"

export const aggregateReadiness = (
  weightedEntries: ReadonlyArray<WeightedEntry>,
  totalWeight: number,
): ReadinessOutput | undefined => {
  if (
    weightedEntries.length === 0 ||
    weightedEntries.some(({ entry }) => entry.observerOutput.readiness === undefined)
  ) {
    return undefined
  }

  const readinessEntries = weightedEntries.map(({ entry, weight }) => ({
    readiness: entry.observerOutput.readiness as ReadinessOutput,
    weight,
  }))
  const maxPressureCount = Math.max(
    ...readinessEntries.map(({ readiness }) => readiness.top_pressures.length),
    0,
  )

  return {
    score: weightedAverage(readinessEntries, ({ readiness }) => readiness.score, totalWeight),
    pressure: weightedAverage(readinessEntries, ({ readiness }) => readiness.pressure, totalWeight),
    status: worstReadinessStatus(readinessEntries.map(({ readiness }) => readiness.status)),
    aggregation: {
      strategy: "pressure-pnorm-local-max",
      p: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.p, totalWeight),
      mean_pressure: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.mean_pressure, totalWeight),
      pnorm_pressure: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.pnorm_pressure, totalWeight),
      max_local_pressure: Math.max(...readinessEntries.map(({ readiness }) => readiness.aggregation.max_local_pressure)),
      failed_signal_pressure: Math.max(...readinessEntries.map(({ readiness }) => readiness.aggregation.failed_signal_pressure ?? 0)),
      hard_gate_pressure: Math.max(...readinessEntries.map(({ readiness }) => readiness.aggregation.hard_gate_pressure)),
      hard_gate_score_cap: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.hard_gate_score_cap, totalWeight),
      local_warning_threshold: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.local_warning_threshold, totalWeight),
      local_poison_threshold: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.local_poison_threshold, totalWeight),
      local_warning_gain: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.local_warning_gain, totalWeight),
      applicable_signal_count: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.applicable_signal_count, totalWeight),
      ignored_signal_count: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.ignored_signal_count, totalWeight),
      failed_signal_count: weightedAverage(readinessEntries, ({ readiness }) => readiness.aggregation.failed_signal_count ?? 0, totalWeight),
    },
    top_pressures: aggregateTopPressures(readinessEntries, maxPressureCount),
  }
}

export const weightedAverage = <A>(
  entries: ReadonlyArray<{ readonly weight: number } & A>,
  value: (entry: A) => number,
  totalWeight: number,
): number =>
  entries.reduce((sum, entry) => sum + value(entry) * entry.weight, 0) / totalWeight

const aggregateTopPressures = (
  readinessEntries: ReadonlyArray<{
    readonly readiness: ReadinessOutput
    readonly weight: number
  }>,
  limit: number,
): ReadonlyArray<ReadinessPressure> => {
  const grouped = new Map<
    string,
    {
      pressure: ReadinessPressure
      totalWeight: number
      score: number
      rawPressure: number
      effectivePressure: number
      weight: number
      confidence: number
    }
  >()

  for (const { readiness, weight } of readinessEntries) {
    for (const pressure of readiness.top_pressures) {
      const key = [pressure.signal_id, pressure.category, pressure.applicability].join("\u0000")
      const existing = grouped.get(key) ?? {
        pressure,
        totalWeight: 0,
        score: 0,
        rawPressure: 0,
        effectivePressure: 0,
        weight: 0,
        confidence: 0,
      }
      existing.totalWeight += weight
      existing.score += pressure.score * weight
      existing.rawPressure += pressure.raw_pressure * weight
      existing.effectivePressure += pressure.effective_pressure * weight
      existing.weight += pressure.weight * weight
      existing.confidence += pressure.confidence * weight
      grouped.set(key, existing)
    }
  }

  return [...grouped.values()]
    .map((item) => ({
      ...item.pressure,
      score: item.score / item.totalWeight,
      raw_pressure: item.rawPressure / item.totalWeight,
      effective_pressure: item.effectivePressure / item.totalWeight,
      weight: item.weight / item.totalWeight,
      confidence: item.confidence / item.totalWeight,
    }))
    .sort(
      (left, right) =>
        right.effective_pressure - left.effective_pressure ||
        left.signal_id.localeCompare(right.signal_id),
    )
    .slice(0, limit)
}

const worstReadinessStatus = (
  statuses: ReadonlyArray<ReadinessOutput["status"]>,
): ReadinessOutput["status"] => {
  const rank: Record<ReadinessOutput["status"], number> = {
    green: 0,
    unknown: 1,
    yellow: 2,
    red: 3,
    blocked: 4,
    failed: 5,
  }
  return statuses.reduce<ReadinessOutput["status"]>(
    (worst, status) => (rank[status] > rank[worst] ? status : worst),
    "green",
  )
}
