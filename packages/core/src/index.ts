/**
 * @skastr0/pulsar-core — small root contract for defining and running signals.
 *
 * Broader subsystems are exposed through named entrypoints such as
 * `@skastr0/pulsar-core/vector` and `@skastr0/pulsar-core/calibration`.
 */

export const CODEC_CORE_VERSION = "0.0.0" as const

export {
  CATEGORIES,
  SignalComputeError,
  SignalContextTag,
  InMemoryCacheLayer,
  levenshteinDistance,
  parseBypasses,
  type AnySignal,
  type Category,
  type Diagnostic,
  type Signal,
  type SignalContext,
  type SignalFactorDefinition,
  type SignalFactorLedger,
  type SignalFactorLedgerEntry,
  type SignalFactorValue,
} from "./signal-api.js"
export {
  SIGNAL_FACTOR_POLICY_PRECEDENCE,
  SignalFactorPolicyTag,
  withConfigFactorLedger,
} from "./factors.js"
export { buildRegistry, runSignal, type Registry, type SignalRunResult } from "./scoring.js"
export {
  PulsarVector,
  decodePulsarVector,
  isActive,
  validateVectorAgainstRegistry,
  weightOf,
} from "./vector.js"
export {
  CalibrationContextTag,
  makeResolvedCalibrationContext,
  type RepoFacts,
  type ResolvedCalibrationContext,
} from "./calibration.js"
export {
  ObserverOutput,
  observe,
  toObserverJson,
  type HardGateViolation,
  type MinimumDimension,
} from "./observer.js"
