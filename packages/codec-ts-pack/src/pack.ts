import type { AnySignal } from "@taste-codec/core"
import { SharedChurn01 } from "./signals/shared-churn-01.js"
import { TsLd01 } from "./signals/ts-ld-01-complexity.js"
import { TsRp01 } from "./signals/ts-rp-01-hotspots.js"

/**
 * The TypeScript signal pack. Consumers (CLI, opencode plugin) compose
 * this with other packs via `Layer.merge`, then feed the union into
 * `registryLayer` from @taste-codec/core.
 */
export const TS_PACK_SIGNALS: ReadonlyArray<AnySignal> = [TsLd01, SharedChurn01, TsRp01]

export { TsLd01 } from "./signals/ts-ld-01-complexity.js"
export { SharedChurn01 } from "./signals/shared-churn-01.js"
export { TsRp01 } from "./signals/ts-rp-01-hotspots.js"
