/**
 * @taste-codec/shared-signals — language-agnostic shared pack.
 */

export const SHARED_SIGNALS_VERSION = "0.0.0" as const

export {
  Shared02BusFactor,
  Shared02BusFactorConfig,
  Shared03ChurnRate,
  Shared03ChurnRateConfig,
  SharedChurn01,
  SharedChurn01Config,
} from "@taste-codec/core"
export type {
  BusFactorInfo,
  Shared02BusFactorOutput,
  Shared03FileRate,
  Shared03ChurnRateOutput,
  SharedChurn01Output,
} from "@taste-codec/core"
export * from "./pack.js"
export * from "./shared-05-suppression.js"
export * from "./shared-06-pr-dep-delta.js"
