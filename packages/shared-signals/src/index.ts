/**
 * @skastr0/pulsar-shared-signals — language-agnostic shared pack.
 */

export const SHARED_SIGNALS_VERSION = "0.0.0" as const

export {
  compareRootFirstPackageNames,
  ROOT_PACKAGE_NAME,
  sortRootFirstPackages,
  type NamedPackage,
} from "./package-order.js"
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
export { SHARED_SIGNALS } from "./pack.js"
export {
  Shared05Suppression,
  Shared05SuppressionConfig,
  type Shared05SuppressionOutput,
} from "./shared-05-suppression.js"
export {
  Shared06PrDepDelta,
  Shared06PrDepDeltaConfig,
  type Shared06PrDepDeltaOutput,
} from "./shared-06-pr-dep-delta.js"
