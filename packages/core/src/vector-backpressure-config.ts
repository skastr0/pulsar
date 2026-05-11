import type { BackpressureConfig, PulsarVector } from "./vector-schema.js"

export const backpressureConfigOf = (
  vector: PulsarVector | undefined,
): BackpressureConfig => ({
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
