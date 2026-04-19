import type { Registry } from "./registry.js"
import type { ConfigDirection } from "./signal.js"
import type { SignalOverride, TasteVector } from "./vector.js"

export type AggregationMode = "mean" | "max" | "min" | "median"
export type VectorLevel = "personal" | "team" | "project" | "task"

export interface WeightedSample {
  readonly value: number
  readonly weight: number
}

export const collectSignalIds = (
  ...vectors: ReadonlyArray<TasteVector | undefined>
): ReadonlyArray<string> => {
  const ids = new Set<string>()
  for (const vector of vectors) {
    if (vector === undefined) continue
    for (const signalId of Object.keys(vector.signal_overrides)) {
      ids.add(signalId)
    }
  }
  return [...ids].sort()
}

export const overrideOf = (
  signalId: string,
  vector: TasteVector | undefined,
): SignalOverride | undefined => vector?.signal_overrides[signalId]

export const explicitConfigOf = (
  override: SignalOverride | undefined,
): Record<string, unknown> => {
  const config = override?.config
  return isRecord(config) ? { ...config } : {}
}

export const defaultAggregationMode = (
  signalId: string,
  registry?: Registry,
): AggregationMode => {
  const kind = registry?.byId.get(signalId)?.kind
  return kind === "structural" ? "max" : "mean"
}

export const aggregateNumeric = (
  samples: ReadonlyArray<WeightedSample>,
  mode: AggregationMode,
): number => {
  if (samples.length === 0) return 1
  switch (mode) {
    case "mean":
      return weightedMean(samples)
    case "max":
      return Math.max(...samples.map((sample) => sample.value))
    case "min":
      return Math.min(...samples.map((sample) => sample.value))
    case "median":
      return weightedMedian(samples)
  }
}

export const weightedMean = (samples: ReadonlyArray<WeightedSample>): number => {
  if (samples.length === 0) return 1
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0)
  if (totalWeight === 0) return 1
  return (
    samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / totalWeight
  )
}

export const weightedVariance = (samples: ReadonlyArray<WeightedSample>): number => {
  if (samples.length <= 1) return 0
  const mean = weightedMean(samples)
  const totalWeight = samples.reduce((sum, sample) => sum + sample.weight, 0)
  if (totalWeight === 0) return 0
  return (
    samples.reduce(
      (sum, sample) => sum + sample.weight * Math.pow(sample.value - mean, 2),
      0,
    ) / totalWeight
  )
}

export const weightedMedian = (samples: ReadonlyArray<WeightedSample>): number => {
  if (samples.length === 0) return 1
  const sorted = [...samples].sort((left, right) => left.value - right.value)
  const totalWeight = sorted.reduce((sum, sample) => sum + sample.weight, 0)
  if (totalWeight === 0) return sorted[Math.floor(sorted.length / 2)]?.value ?? 1
  let cumulative = 0
  for (const sample of sorted) {
    cumulative += sample.weight
    if (cumulative >= totalWeight / 2) {
      return sample.value
    }
  }
  return sorted[sorted.length - 1]?.value ?? 1
}

export const baselineConfigOf = (
  signalId: string,
  registry?: Registry,
): Record<string, unknown> => {
  const defaults = registry?.byId.get(signalId)?.defaultConfig
  return isRecord(defaults) ? { ...defaults } : {}
}

export const directionFor = (
  signalId: string,
  configKey: string,
  registry?: Registry,
): ConfigDirection => {
  const signal = registry?.byId.get(signalId)
  if (signal === undefined || signal.configDirections === undefined) {
    return "higher-is-stricter"
  }
  const direction = signal.configDirections[configKey as keyof typeof signal.configDirections]
  return direction ?? "higher-is-stricter"
}

export const compareConfigStrictness = (input: {
  readonly signalId: string
  readonly configKey: string
  readonly current: unknown
  readonly attempted: unknown
  readonly registry?: Registry
}): {
  readonly accepted: boolean
  readonly tightened: boolean
  readonly reason?: string
} => {
  if (Object.is(input.current, input.attempted)) {
    return { accepted: true, tightened: false }
  }

  if (input.current === undefined) {
    return { accepted: true, tightened: true }
  }

  if (typeof input.current === "number" && typeof input.attempted === "number") {
    const direction = directionFor(input.signalId, input.configKey, input.registry)
    const tightened =
      direction === "higher-is-stricter"
        ? input.attempted >= input.current
        : input.attempted <= input.current
    return {
      accepted: tightened,
      tightened,
      ...(tightened
        ? {}
        : {
            reason: `config.${input.configKey} would loosen ${direction}`,
          }),
    }
  }

  return {
    accepted: false,
    tightened: false,
    reason: `config.${input.configKey} comparison only supports numeric thresholds`,
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
