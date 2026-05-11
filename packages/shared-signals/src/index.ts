/**
 * @skastr0/pulsar-shared-signals — language-agnostic shared pack.
 */

export const SHARED_SIGNALS_VERSION = "0.0.0" as const

export {
  Shared02BusFactor,
  Shared02BusFactorConfig,
  Shared03ChurnRate,
  Shared03ChurnRateConfig,
  SharedChurn01,
  SharedChurn01Config,
} from "@skastr0/pulsar-core/shared-signals"
export type {
  BusFactorInfo,
  Shared02BusFactorOutput,
  Shared03FileRate,
  Shared03ChurnRateOutput,
  SharedChurn01Output,
} from "@skastr0/pulsar-core/shared-signals"
export * from "./pack.js"
export * from "./shared-05-suppression.js"
export * from "./shared-06-pr-dep-delta.js"
