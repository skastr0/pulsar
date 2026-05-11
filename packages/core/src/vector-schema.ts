import { Schema } from "effect"
import type { SignalFactorValue } from "./signal-factor-model.js"

export const SignalOverride = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
  weight: Schema.optional(Schema.Number.pipe(Schema.between(0, 2))),
  config: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
  factors: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type SignalOverride = typeof SignalOverride.Type
export type SignalFactorOverrideMap = Readonly<Record<string, SignalFactorValue>>

export const ReviewRoutingConfig = Schema.Struct({
  score_thresholds: Schema.optionalWith(
    Schema.Record({
      key: Schema.String,
      value: Schema.Number.pipe(Schema.between(0, 1)),
    }),
    { default: () => ({}) },
  ),
})
export type ReviewRoutingConfig = typeof ReviewRoutingConfig.Type

export const ObserverConfig = Schema.Struct({
  diffTimeIntegration: Schema.optionalWith(Schema.Boolean, {
    default: () => true,
  }),
  readiness: Schema.optional(
    Schema.Struct({
      p_norm: Schema.optionalWith(Schema.Number.pipe(Schema.between(1, 32)), {
        default: () => 12,
      }),
      local_warning_threshold: Schema.optionalWith(
        Schema.Number.pipe(Schema.between(0, 1)),
        {
          default: () => 0.4,
        },
      ),
      local_poison_threshold: Schema.optionalWith(
        Schema.Number.pipe(Schema.between(0, 1)),
        {
          default: () => 0.75,
        },
      ),
      local_warning_gain: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
        default: () => 0.75,
      }),
      hard_gate_score_cap: Schema.optionalWith(
        Schema.Number.pipe(Schema.between(0, 1)),
        {
          default: () => 0.2,
        },
      ),
      green_max_pressure: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
        default: () => 0.15,
      }),
      red_min_pressure: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
        default: () => 0.4,
      }),
      top_pressures: Schema.optionalWith(Schema.Number.pipe(Schema.between(1, 1000)), {
        default: () => 10,
      }),
    }),
  ),
  category_aggregation: Schema.optional(
    Schema.Struct({
      p_norm: Schema.optionalWith(Schema.Number.pipe(Schema.between(1, 32)), {
        default: () => 12,
      }),
      local_warning_threshold: Schema.optionalWith(
        Schema.Number.pipe(Schema.between(0, 1)),
        {
          default: () => 0.4,
        },
      ),
      local_poison_threshold: Schema.optionalWith(
        Schema.Number.pipe(Schema.between(0, 1)),
        {
          default: () => 0.75,
        },
      ),
      local_warning_gain: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
        default: () => 0.75,
      }),
    }),
  ),
  timeSeries: Schema.optional(
    Schema.Struct({
      enabled: Schema.optionalWith(Schema.Boolean, {
        default: () => false,
      }),
      compaction_threshold: Schema.optionalWith(Schema.Number, {
        default: () => 10_000,
      }),
      raw_retention_days: Schema.optionalWith(Schema.Number, {
        default: () => 90,
      }),
    }),
  ),
})
export type ObserverConfig = typeof ObserverConfig.Type

export interface ReadinessObserverConfig {
  readonly p_norm: number
  readonly local_warning_threshold: number
  readonly local_poison_threshold: number
  readonly local_warning_gain: number
  readonly hard_gate_score_cap: number
  readonly green_max_pressure: number
  readonly red_min_pressure: number
  readonly top_pressures: number
}

export interface CategoryAggregationObserverConfig {
  readonly p_norm: number
  readonly local_warning_threshold: number
  readonly local_poison_threshold: number
  readonly local_warning_gain: number
}

export const GoodhartConfig = Schema.Struct({
  holdout_ratio: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 0.2,
  }),
  rotation_period_days: Schema.optionalWith(Schema.Number, {
    default: () => 7,
  }),
  max_visible_holdout_gap: Schema.optionalWith(
    Schema.Number.pipe(Schema.between(0, 1)),
    {
      default: () => 0.08,
    },
  ),
  max_velocity_excess: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 0.12,
  }),
  min_history_points: Schema.optionalWith(Schema.Number, {
    default: () => 4,
  }),
})
export type GoodhartConfig = typeof GoodhartConfig.Type

export const BackpressureThresholdConfig = Schema.Struct({
  green_min_score: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 0.85,
  }),
  yellow_min_score: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 0.6,
  }),
  red_min_dimension: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 0.4,
  }),
  degrading_window_drop: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 0.1,
  }),
})
export type BackpressureThresholdConfig = typeof BackpressureThresholdConfig.Type

export const BackpressureConfig = Schema.Struct({
  trajectory_days: Schema.optionalWith(Schema.Number, {
    default: () => 14,
  }),
  empty_series_level: Schema.optionalWith(Schema.Literal("green", "yellow", "red"), {
    default: () => "yellow",
  }),
  thresholds: Schema.optionalWith(BackpressureThresholdConfig, {
    default: () => ({
      green_min_score: 0.85,
      yellow_min_score: 0.6,
      red_min_dimension: 0.4,
      degrading_window_drop: 0.1,
    }),
  }),
  goodhart: Schema.optionalWith(GoodhartConfig, {
    default: () => ({
      holdout_ratio: 0.2,
      rotation_period_days: 7,
      max_visible_holdout_gap: 0.08,
      max_velocity_excess: 0.12,
      min_history_points: 4,
    }),
  }),
})
export type BackpressureConfig = typeof BackpressureConfig.Type

export const PulsarVectorEvidence = Schema.Struct({
  kind: Schema.Literal("preset", "quiz", "observation", "score-delta", "proposal"),
  summary: Schema.String,
  signal_ids: Schema.optional(Schema.Array(Schema.String)),
  artifact_path: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.Unknown })),
})
export type PulsarVectorEvidence = typeof PulsarVectorEvidence.Type

export const PulsarVectorProvenanceEntry = Schema.Struct({
  source: Schema.Literal(
    "manual",
    "preset",
    "quiz",
    "revealed-preference",
    "passive-extraction",
    "ai-assisted-detection",
  ),
  recorded_at: Schema.String,
  summary: Schema.String,
  preset_id: Schema.optional(Schema.String),
  artifact_path: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.Array(PulsarVectorEvidence)),
})
export type PulsarVectorProvenanceEntry = typeof PulsarVectorProvenanceEntry.Type

export const PulsarVectorModes = Schema.Struct({
  ai_assisted: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
})
export type PulsarVectorModes = typeof PulsarVectorModes.Type

export const PulsarVector = Schema.Struct({
  id: Schema.String,
  domain: Schema.String,
  description: Schema.optional(Schema.String),
  signal_overrides: Schema.Record({ key: Schema.String, value: SignalOverride }),
  review_routing: Schema.optional(ReviewRoutingConfig),
  observer: Schema.optional(ObserverConfig),
  backpressure: Schema.optional(BackpressureConfig),
  provenance: Schema.optional(Schema.Array(PulsarVectorProvenanceEntry)),
  modes: Schema.optional(PulsarVectorModes),
})
export type PulsarVector = typeof PulsarVector.Type

export const decodePulsarVector = Schema.decodeUnknown(PulsarVector)
