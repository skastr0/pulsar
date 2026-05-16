/**
 * @skastr0/pulsar-shared-signals — language-agnostic shared pack.
 */

export const SHARED_SIGNALS_VERSION = "0.1.0" as const

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
  SharedChurn02,
  SharedChurn02Config,
  SharedCochange01,
  SharedCochange01Config,
} from "@skastr0/pulsar-core/shared-signals"
export type {
  BusFactorInfo,
  CoChangePair,
  Shared02BusFactorOutput,
  Shared03FileRate,
  Shared03ChurnRateOutput,
  SharedChurn01Output,
  SharedChurn02Output,
  SharedCochange01Output,
  WeightedChurnFile,
} from "@skastr0/pulsar-core/shared-signals"
export { SHARED_SIGNALS } from "./pack.js"
export {
  MACHINE_FEEDBACK_CLASSES,
  collectMachineFeedbackFacts,
  type FactSourceState,
  type MachineFeedbackClass,
  type MachineFeedbackClassFact,
  type MachineFeedbackEvidence,
  type MachineFeedbackFacts,
} from "./machine-feedback-facts.js"
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
export {
  Shared07MachineFeedbackCoverage,
  Shared07MachineFeedbackCoverageConfig,
  type Shared07MachineFeedbackCoverageOutput,
} from "./shared-07-machine-feedback-coverage.js"
export {
  Shared09ContractFreshness,
  Shared09ContractFreshnessConfig,
  type Shared09ContractFreshnessOutput,
} from "./shared-09-contract-freshness.js"
export {
  Shared10DomainConstructionControl,
  Shared10DomainConstructionControlConfig,
  type Shared10DomainConstructionControlOutput,
} from "./shared-10-domain-construction-control.js"
export {
  SharedCov01CoverageFacts,
  SharedCov01CoverageFactsConfig,
  type SharedCov01CoverageFactsOutput,
} from "./shared-cov-01-coverage-facts.js"
