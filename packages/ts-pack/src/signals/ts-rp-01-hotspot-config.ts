import type { HotspotConfig } from "./ts-rp-01-hotspot-types.js"
import { TS_RP_01_DEFAULT_CONFIG } from "./ts-rp-01-hotspot-types.js"
import {
  normalizeDiagnosticLimit,
  normalizeFiniteRange,
  normalizeNonNegativeFinite,
} from "./ts-rp-01-hotspot-math.js"

export const normalizeHotspotConfig = (config: HotspotConfig): HotspotConfig => ({
  top_n: normalizeDiagnosticLimit(config.top_n),
  min_churn: normalizeNonNegativeFinite(
    config.min_churn,
    TS_RP_01_DEFAULT_CONFIG.min_churn,
  ),
  min_complexity: normalizeNonNegativeFinite(
    config.min_complexity,
    TS_RP_01_DEFAULT_CONFIG.min_complexity,
  ),
  threshold_softness: normalizeFiniteRange(
    config.threshold_softness,
    TS_RP_01_DEFAULT_CONFIG.threshold_softness,
    0,
    0.99,
  ),
  peer_percentile_floor: normalizeFiniteRange(
    config.peer_percentile_floor,
    TS_RP_01_DEFAULT_CONFIG.peer_percentile_floor,
    0,
    0.95,
  ),
})
