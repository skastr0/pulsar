import { Effect } from "effect"
import { UnknownSignalFactorError, UnknownSignalIdError } from "./errors.js"
import type { Registry } from "./registry.js"
import type { SignalFactorValue, SignalIdentity } from "./signal.js"
import type {
  PulsarVector,
  PulsarVectorProvenanceEntry,
  SignalFactorOverrideMap,
  SignalOverride,
} from "./vector-schema.js"

/**
 * Validate that every signal id referenced in the vector is known to the
 * registry. This is a load-time check — bad vectors fail loud, not late.
 */
export const validateVectorAgainstRegistry = (
  vector: PulsarVector,
  registry: Registry,
): Effect.Effect<void, UnknownSignalIdError | UnknownSignalFactorError> =>
  Effect.gen(function* () {
    for (const id of Object.keys(vector.signal_overrides)) {
      const signal = registry.byId.get(id)
      if (signal === undefined) return yield* new UnknownSignalIdError({ id })

      const factorPaths = new Set((signal.factorDefinitions ?? []).map((factor) => factor.path))
      for (const factorPath of Object.keys(vector.signal_overrides[id]?.factors ?? {})) {
        if (!factorPaths.has(factorPath)) {
          return yield* new UnknownSignalFactorError({
            signalId: signal.id,
            factorPath,
          })
        }
      }
    }
  })

/**
 * Resolve the effective config for a signal given a pulsar vector,
 * falling back to the signal's defaultConfig when no override is
 * provided.
 */
export const resolvedConfig = <Config>(
  signal: string | SignalIdentity,
  defaultConfig: Config,
  vector: PulsarVector | undefined,
): Config => {
  if (vector === undefined) return defaultConfig
  const override = signalOverrideOf(signal, vector)
  if (override === undefined) return defaultConfig
  return {
    ...defaultConfig,
    ...((override.config ?? {}) as Partial<Config>),
    ...configPatchFromFactorOverrides<Config>(override.factors),
  }
}

export const isActive = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): boolean => {
  if (vector === undefined) return true
  const override = signalOverrideOf(signal, vector)
  return override?.active ?? true
}

export const weightOf = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): number => {
  if (vector === undefined) return 1
  const override = signalOverrideOf(signal, vector)
  return override?.weight ?? 1
}

export const signalOverrideOf = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): SignalOverride | undefined => {
  if (vector === undefined) return undefined
  for (const id of signalIdsForOverrideLookup(signal)) {
    const override = vector.signal_overrides[id]
    if (override !== undefined) return override
  }
  return undefined
}

export const factorOverridesOf = (
  signal: string | SignalIdentity,
  vector: PulsarVector | undefined,
): SignalFactorOverrideMap => {
  const factors = signalOverrideOf(signal, vector)?.factors
  return factors === undefined ? {} : (factors as SignalFactorOverrideMap)
}

const configPatchFromFactorOverrides = <Config>(
  factors: SignalOverride["factors"] | undefined,
): Partial<Config> => {
  if (factors === undefined) return {}
  const patch: Record<string, SignalFactorValue> = {}
  for (const [path, value] of Object.entries(factors)) {
    if (!path.startsWith("config.")) continue
    patch[path.slice("config.".length)] = (value ?? null) as SignalFactorValue
  }
  return patch as Partial<Config>
}

const signalIdsForOverrideLookup = (
  signal: string | SignalIdentity,
): ReadonlyArray<string> =>
  typeof signal === "string" ? [signal] : [signal.id, ...(signal.aliases ?? [])]

export const reviewThresholdOf = (
  reviewerRole: string,
  vector: PulsarVector | undefined,
  fallback = 0.6,
): number => vector?.review_routing?.score_thresholds[reviewerRole] ?? fallback

export const diffTimeIntegrationEnabled = (
  vector: PulsarVector | undefined,
): boolean => vector?.observer?.diffTimeIntegration ?? true

interface ResolvedReadinessObserverConfig {
  readonly p_norm: number
  readonly local_warning_threshold: number
  readonly local_poison_threshold: number
  readonly local_warning_gain: number
  readonly hard_gate_score_cap: number
  readonly green_max_pressure: number
  readonly red_min_pressure: number
  readonly top_pressures: number
}

export const readinessConfigOf = (
  vector: PulsarVector | undefined,
): ResolvedReadinessObserverConfig => ({
  p_norm: vector?.observer?.readiness?.p_norm ?? 12,
  local_warning_threshold: vector?.observer?.readiness?.local_warning_threshold ?? 0.4,
  local_poison_threshold: vector?.observer?.readiness?.local_poison_threshold ?? 0.75,
  local_warning_gain: vector?.observer?.readiness?.local_warning_gain ?? 0.75,
  hard_gate_score_cap: vector?.observer?.readiness?.hard_gate_score_cap ?? 0.2,
  green_max_pressure: vector?.observer?.readiness?.green_max_pressure ?? 0.15,
  red_min_pressure: vector?.observer?.readiness?.red_min_pressure ?? 0.4,
  top_pressures: vector?.observer?.readiness?.top_pressures ?? 10,
})

interface ResolvedCategoryAggregationObserverConfig {
  readonly p_norm: number
  readonly local_warning_threshold: number
  readonly local_poison_threshold: number
  readonly local_warning_gain: number
}

export const categoryAggregationConfigOf = (
  vector: PulsarVector | undefined,
): ResolvedCategoryAggregationObserverConfig => ({
  p_norm: vector?.observer?.category_aggregation?.p_norm ?? 12,
  local_warning_threshold:
    vector?.observer?.category_aggregation?.local_warning_threshold ?? 0.4,
  local_poison_threshold:
    vector?.observer?.category_aggregation?.local_poison_threshold ?? 0.75,
  local_warning_gain:
    vector?.observer?.category_aggregation?.local_warning_gain ?? 0.75,
})

export const aiAssistedModeEnabled = (vector: PulsarVector | undefined): boolean =>
  vector?.modes?.ai_assisted ?? false

export interface AiAssistedModeExplanation {
  readonly active: boolean
  readonly source: "inactive" | "preset" | "proposal" | "manual"
  readonly summary: string
  readonly overrideHint: string
}

export const explainAiAssistedMode = (
  vector: PulsarVector | undefined,
): AiAssistedModeExplanation => {
  if (!aiAssistedModeEnabled(vector)) {
    return {
      active: false,
      source: "inactive",
      summary: "inactive — AI-assisted thresholds are off for this run.",
      overrideHint:
        "The pulsar never hides this switch: enable modes.ai_assisted or accept an AI-mode proposal if you want the tighter thresholds.",
    }
  }

  const latestRelevant = [...(vector?.provenance ?? [])]
    .reverse()
    .find(
      (entry) =>
        entry.source === "ai-assisted-detection" ||
        entry.source === "preset" ||
        entry.summary.toLowerCase().includes("ai-assisted"),
    )

  if (latestRelevant?.source === "ai-assisted-detection") {
    return {
      active: true,
      source: "proposal",
      summary: `active via accepted AI-assisted detection proposal — ${latestRelevant.summary}`,
      overrideHint:
        "This remains explicit in vector.modes.ai_assisted; edit the vector or reject future proposals to stay on manual thresholds.",
    }
  }

  if (latestRelevant?.source === "preset") {
    return {
      active: true,
      source: "preset",
      summary:
        latestRelevant.preset_id !== undefined
          ? `active via preset ${latestRelevant.preset_id}`
          : `active via preset provenance — ${latestRelevant.summary}`,
      overrideHint:
        "This remains explicit in vector.modes.ai_assisted; switch presets or set the mode to false to return to manual thresholds.",
    }
  }

  return {
    active: true,
    source: "manual",
    summary: "active because vector.modes.ai_assisted is true.",
    overrideHint:
      "This remains explicit in the vector; set modes.ai_assisted to false to disable the tighter thresholds.",
  }
}

export const timeSeriesConfigOf = (vector: PulsarVector | undefined): NonNullable<
  NonNullable<PulsarVector["observer"]>["timeSeries"]
> => ({
  enabled: vector?.observer?.timeSeries?.enabled ?? false,
  compaction_threshold: vector?.observer?.timeSeries?.compaction_threshold ?? 10_000,
  raw_retention_days: vector?.observer?.timeSeries?.raw_retention_days ?? 90,
})

interface ResolvedBackpressureConfig {
  readonly trajectory_days: number
  readonly empty_series_level: "green" | "yellow" | "red"
  readonly thresholds: {
    readonly green_min_score: number
    readonly yellow_min_score: number
    readonly red_min_dimension: number
    readonly degrading_window_drop: number
  }
  readonly goodhart: {
    readonly holdout_ratio: number
    readonly rotation_period_days: number
    readonly max_visible_holdout_gap: number
    readonly max_velocity_excess: number
    readonly min_history_points: number
  }
}

export const backpressureConfigOf = (
  vector: PulsarVector | undefined,
): ResolvedBackpressureConfig => ({
  trajectory_days: vector?.backpressure?.trajectory_days ?? 14,
  empty_series_level: vector?.backpressure?.empty_series_level ?? "yellow",
  thresholds: {
    green_min_score: vector?.backpressure?.thresholds?.green_min_score ?? 0.85,
    yellow_min_score: vector?.backpressure?.thresholds?.yellow_min_score ?? 0.6,
    red_min_dimension: vector?.backpressure?.thresholds?.red_min_dimension ?? 0.4,
    degrading_window_drop: vector?.backpressure?.thresholds?.degrading_window_drop ?? 0.1,
  },
  goodhart: {
    holdout_ratio: vector?.backpressure?.goodhart?.holdout_ratio ?? 0.2,
    rotation_period_days: vector?.backpressure?.goodhart?.rotation_period_days ?? 7,
    max_visible_holdout_gap:
      vector?.backpressure?.goodhart?.max_visible_holdout_gap ?? 0.08,
    max_velocity_excess: vector?.backpressure?.goodhart?.max_velocity_excess ?? 0.12,
    min_history_points: vector?.backpressure?.goodhart?.min_history_points ?? 4,
  },
})

export const appendVectorProvenance = (
  vector: PulsarVector,
  entry: PulsarVectorProvenanceEntry,
): PulsarVector => ({
  ...vector,
  provenance: [...(vector.provenance ?? []), entry],
})
