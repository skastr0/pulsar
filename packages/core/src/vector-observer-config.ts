import type {
  CategoryAggregationObserverConfig,
  PulsarVector,
  ReadinessObserverConfig,
} from "./vector-schema.js"

export const reviewThresholdOf = (
  reviewerRole: string,
  vector: PulsarVector | undefined,
  fallback = 0.6,
): number => vector?.review_routing?.score_thresholds[reviewerRole] ?? fallback

export const diffTimeIntegrationEnabled = (
  vector: PulsarVector | undefined,
): boolean => vector?.observer?.diffTimeIntegration ?? true

export const readinessConfigOf = (
  vector: PulsarVector | undefined,
): ReadinessObserverConfig => ({
  p_norm: vector?.observer?.readiness?.p_norm ?? 4,
  local_warning_threshold: vector?.observer?.readiness?.local_warning_threshold ?? 0.4,
  local_poison_threshold: vector?.observer?.readiness?.local_poison_threshold ?? 0.75,
  local_warning_gain: vector?.observer?.readiness?.local_warning_gain ?? 0.75,
  hard_gate_score_cap: vector?.observer?.readiness?.hard_gate_score_cap ?? 0.2,
  green_max_pressure: vector?.observer?.readiness?.green_max_pressure ?? 0.15,
  red_min_pressure: vector?.observer?.readiness?.red_min_pressure ?? 0.4,
  top_pressures: vector?.observer?.readiness?.top_pressures ?? 10,
})

export const categoryAggregationConfigOf = (
  vector: PulsarVector | undefined,
): CategoryAggregationObserverConfig => ({
  p_norm: vector?.observer?.category_aggregation?.p_norm ?? 4,
  local_warning_threshold:
    vector?.observer?.category_aggregation?.local_warning_threshold ?? 0.4,
  local_poison_threshold:
    vector?.observer?.category_aggregation?.local_poison_threshold ?? 0.75,
  local_warning_gain:
    vector?.observer?.category_aggregation?.local_warning_gain ?? 0.75,
})

export const timeSeriesConfigOf = (vector: PulsarVector | undefined): NonNullable<
  NonNullable<PulsarVector["observer"]>["timeSeries"]
> => ({
  enabled: vector?.observer?.timeSeries?.enabled ?? false,
  compaction_threshold: vector?.observer?.timeSeries?.compaction_threshold ?? 10_000,
  raw_retention_days: vector?.observer?.timeSeries?.raw_retention_days ?? 90,
})
