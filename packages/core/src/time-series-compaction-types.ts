import type { TimeSeriesEntry } from "./time-series.js"

export type WeightedEntry = {
  readonly entry: TimeSeriesEntry
  readonly weight: number
}
