import { clamp01 } from "./observer-score-utils.js"
import type {
  CategoryAggregationObserverConfig,
  ReadinessObserverConfig,
} from "./vector.js"

export type PoisonRampConfig = Pick<
  CategoryAggregationObserverConfig | ReadinessObserverConfig,
  "local_poison_threshold" | "local_warning_threshold"
>

/**
 * Continuous poison grade for the observer aggregators.
 *
 * Zero at and below local_warning_threshold, scaling linearly up to full
 * passthrough at local_poison_threshold — no discontinuities anywhere, so
 * a one-in-ten-thousand change in a single signal can never step the
 * repo headline. Callers feed it the maximum effective pressure over
 * signals holding poison authority (see hasPoisonAuthority); signals
 * without that authority never reach this function.
 */
export const poisonRampPressure = (
  maxAuthorityPressure: number,
  config: PoisonRampConfig,
): number => {
  const span = config.local_poison_threshold - config.local_warning_threshold
  if (span <= 0) {
    // Degenerate vector config (warn >= poison): fall back to a step at
    // the poison threshold rather than dividing by zero.
    return maxAuthorityPressure >= config.local_poison_threshold ? maxAuthorityPressure : 0
  }
  const ramp = clamp01((maxAuthorityPressure - config.local_warning_threshold) / span)
  return ramp * maxAuthorityPressure
}
