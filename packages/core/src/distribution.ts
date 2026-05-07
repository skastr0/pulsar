import { Schema } from "effect"

/**
 * Shared distributional summary used across signals that emit per-file
 * or per-bucket aggregates. Exposing max/p95/sum/count alongside avg
 * lets downstream compound signals and pulsar-vector overrides pick a
 * different aggregation axis without forcing the producer to re-walk
 * its input.
 */
export const DistributionalSummary = Schema.Struct({
  max: Schema.Number,
  p95: Schema.Number,
  avg: Schema.Number,
  sum: Schema.Number,
  count: Schema.Number,
})
export type DistributionalSummary = typeof DistributionalSummary.Type

export const emptySummary: DistributionalSummary = {
  max: 0,
  p95: 0,
  avg: 0,
  sum: 0,
  count: 0,
}

export const summarize = (values: ReadonlyArray<number>): DistributionalSummary => {
  if (values.length === 0) return emptySummary
  const sorted = [...values].sort((a, b) => a - b)
  let sum = 0
  let max = sorted[0] ?? 0
  for (const v of sorted) {
    sum += v
    if (v > max) max = v
  }
  const p95Index = Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))
  const p95 = sorted[p95Index] ?? 0
  return {
    max,
    p95,
    avg: sum / sorted.length,
    sum,
    count: sorted.length,
  }
}
