import type {
  CategoryAggregationObserverConfig,
  ReadinessObserverConfig,
} from "./vector.js"

type LocalPressureConfig = Pick<
  CategoryAggregationObserverConfig | ReadinessObserverConfig,
  "local_poison_threshold" | "local_warning_gain" | "local_warning_threshold"
>

export const localSignalPressure = (
  maxLocalPressure: number,
  config: LocalPressureConfig,
): number => {
  if (maxLocalPressure >= config.local_poison_threshold) return maxLocalPressure
  if (maxLocalPressure >= config.local_warning_threshold) {
    return maxLocalPressure * config.local_warning_gain
  }
  return 0
}
