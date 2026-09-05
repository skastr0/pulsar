import { Effect, Schema } from "effect"
import type { SignalFactorValue } from "./signal-factor-model.js"

export const SignalOverride = Schema.Struct({
  active: Schema.optional(Schema.Boolean),
  weight: Schema.optional(
    Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 2 }))),
  ),
  config: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  factors: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type SignalOverride = typeof SignalOverride.Type
export type SignalFactorOverrideMap = Readonly<Record<string, SignalFactorValue>>

export const ReviewRoutingConfig = Schema.Struct({
  score_thresholds: Schema.Record(
    Schema.String,
    Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  ).pipe(
    Schema.withDecodingDefaultType(Effect.sync(() => ({}))),
  ),
})
export type ReviewRoutingConfig = typeof ReviewRoutingConfig.Type

export const ObserverConfig = Schema.Struct({
  diffTimeIntegration: Schema.Boolean.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(true)),
  ),
  readiness: Schema.optional(
    Schema.Struct({
      // Default 4: the headline sits between mean and max — sensitive to a
      // bad tail without duplicating the separately-displayed minimum.
      p_norm: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
        Schema.withDecodingDefaultType(Effect.succeed(4)),
      ),
      local_warning_threshold: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.4)),
      ),
      local_poison_threshold: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.75)),
      ),
      /** @deprecated unused since the poison ramp; retained for vector and time-series compatibility. */
      local_warning_gain: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.75)),
      ),
      hard_gate_score_cap: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.2)),
      ),
      green_max_pressure: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.15)),
      ),
      red_min_pressure: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.4)),
      ),
      top_pressures: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
        Schema.withDecodingDefaultType(Effect.succeed(10)),
      ),
    }),
  ),
  category_aggregation: Schema.optional(
    Schema.Struct({
      p_norm: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 1, maximum: 32 })),
        Schema.withDecodingDefaultType(Effect.succeed(4)),
      ),
      local_warning_threshold: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.4)),
      ),
      local_poison_threshold: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.75)),
      ),
      /** @deprecated unused since the poison ramp; retained for vector and time-series compatibility. */
      local_warning_gain: Schema.Number.pipe(
        Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
        Schema.withDecodingDefaultType(Effect.succeed(0.75)),
      ),
    }),
  ),
  timeSeries: Schema.optional(
    Schema.Struct({
      enabled: Schema.Boolean.pipe(
        Schema.withDecodingDefaultType(Effect.succeed(false)),
      ),
      compaction_threshold: Schema.Number.pipe(
        Schema.withDecodingDefaultType(Effect.succeed(10_000)),
      ),
      raw_retention_days: Schema.Number.pipe(
        Schema.withDecodingDefaultType(Effect.succeed(90)),
      ),
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
  holdout_ratio: Schema.Number.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    Schema.withDecodingDefaultType(Effect.succeed(0.2)),
  ),
  rotation_period_days: Schema.Number.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(7)),
  ),
  max_visible_holdout_gap: Schema.Number.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    Schema.withDecodingDefaultType(Effect.succeed(0.08)),
  ),
  max_velocity_excess: Schema.Number.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    Schema.withDecodingDefaultType(Effect.succeed(0.12)),
  ),
  min_history_points: Schema.Number.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(4)),
  ),
})
export type GoodhartConfig = typeof GoodhartConfig.Type

export const BackpressureThresholdConfig = Schema.Struct({
  green_min_score: Schema.Number.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    Schema.withDecodingDefaultType(Effect.succeed(0.85)),
  ),
  yellow_min_score: Schema.Number.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    Schema.withDecodingDefaultType(Effect.succeed(0.6)),
  ),
  red_min_dimension: Schema.Number.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    Schema.withDecodingDefaultType(Effect.succeed(0.4)),
  ),
  degrading_window_drop: Schema.Number.pipe(
    Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
    Schema.withDecodingDefaultType(Effect.succeed(0.1)),
  ),
})
export type BackpressureThresholdConfig = typeof BackpressureThresholdConfig.Type

export const BackpressureConfig = Schema.Struct({
  trajectory_days: Schema.Number.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(14)),
  ),
  empty_series_level: Schema.Literals(["green", "yellow", "red"]).pipe(
    Schema.withDecodingDefaultType(Effect.succeed("yellow")),
  ),
  thresholds: BackpressureThresholdConfig.pipe(
    Schema.withDecodingDefaultType(
      Effect.sync(() => ({
        green_min_score: 0.85,
        yellow_min_score: 0.6,
        red_min_dimension: 0.4,
        degrading_window_drop: 0.1,
      })),
    ),
  ),
  goodhart: GoodhartConfig.pipe(
    Schema.withDecodingDefaultType(
      Effect.sync(() => ({
        holdout_ratio: 0.2,
        rotation_period_days: 7,
        max_visible_holdout_gap: 0.08,
        max_velocity_excess: 0.12,
        min_history_points: 4,
      })),
    ),
  ),
})
export type BackpressureConfig = typeof BackpressureConfig.Type

export const PulsarVectorEvidence = Schema.Struct({
  kind: Schema.Literals(["preset", "quiz", "observation", "score-delta", "proposal"]),
  summary: Schema.String,
  signal_ids: Schema.optional(Schema.Array(Schema.String)),
  artifact_path: Schema.optional(Schema.String),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type PulsarVectorEvidence = typeof PulsarVectorEvidence.Type

export const PulsarVectorProvenanceEntry = Schema.Struct({
  source: Schema.Literals([
    "manual",
    "preset",
    "quiz",
    "revealed-preference",
    "passive-extraction",
    "ai-assisted-detection",
  ]),
  recorded_at: Schema.String,
  summary: Schema.String,
  preset_id: Schema.optional(Schema.String),
  artifact_path: Schema.optional(Schema.String),
  evidence: Schema.optional(Schema.Array(PulsarVectorEvidence)),
})
export type PulsarVectorProvenanceEntry = typeof PulsarVectorProvenanceEntry.Type

export const PulsarVectorModes = Schema.Struct({
  ai_assisted: Schema.Boolean.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(false)),
  ),
})
export type PulsarVectorModes = typeof PulsarVectorModes.Type

export const PulsarVectorPresetProfileKind = Schema.Literals([
  "architecture-taste",
  "technology-practice",
  "workflow-risk",
])
export type PulsarVectorPresetProfileKind = typeof PulsarVectorPresetProfileKind.Type

export const PulsarVectorPresetProfileActivation = Schema.Literal("explicit-apply-only")
export type PulsarVectorPresetProfileActivation =
  typeof PulsarVectorPresetProfileActivation.Type

export const PulsarVectorPresetProfile = Schema.Struct({
  kind: PulsarVectorPresetProfileKind,
  activation: PulsarVectorPresetProfileActivation,
  summary: Schema.String,
})
export type PulsarVectorPresetProfile = typeof PulsarVectorPresetProfile.Type

export const PulsarVector = Schema.Struct({
  id: Schema.String,
  domain: Schema.String,
  description: Schema.optional(Schema.String),
  preset_profile: Schema.optional(PulsarVectorPresetProfile),
  signal_overrides: Schema.Record(Schema.String, SignalOverride),
  review_routing: Schema.optional(ReviewRoutingConfig),
  observer: Schema.optional(ObserverConfig),
  backpressure: Schema.optional(BackpressureConfig),
  provenance: Schema.optional(Schema.Array(PulsarVectorProvenanceEntry)),
  modes: Schema.optional(PulsarVectorModes),
})
export type PulsarVector = typeof PulsarVector.Type

export const decodePulsarVector = Schema.decodeUnknownEffect(PulsarVector)
