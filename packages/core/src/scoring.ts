export { buildRegistry, type Registry } from "./registry.js"
export { runSignal, type SignalRunResult } from "./runner.js"
export { InMemoryCacheLayer } from "./cache.js"
export {
  ObserverOutput,
  observe,
  toObserverJson,
  type ObserverOutputPublic,
  type HardGateViolation,
  type MinimumDimension,
} from "./observer.js"
export {
  ScoringEngineLayer,
  ScoringEngineTag,
  collectChangedHunksForRange,
  collectWorktreeChangedHunks,
  computeConfigHash,
  computeObserverConfigHash,
} from "./scoring-engine.js"
export {
  baselineViolationCount,
  compareToBaseline,
  createBaseline,
  decodeBaseline,
  decodeBaselineSync,
  type Baseline,
  type BaselineComparison,
} from "./baseline.js"
export {
  CommitNotFound,
  CompositionTooDeepError,
  ConfigValidationError,
  CycleDetectedError,
  DuplicateSignalIdError,
  GitRevListFailed,
  MissingDependencyError,
  ReferenceDataLoadFailed,
  ReferenceDataMissingError,
  RoutingPatternLoadFailed,
  SignalComputeError,
  UnknownSignalFactorError,
  UnknownSignalIdError,
  WorktreeCreateFailed,
  WorktreeRemoveFailed,
  type RegistryError,
  type ScoringEngineError,
  type SignalError,
} from "./errors.js"
export {
  PULSAR_CONFIG_DIR_NAME,
  normalizeRepoStatePath,
  repoStateId,
  resolvePulsarStateRoot,
  resolvePulsarRepoStateDir,
  resolvePulsarRepoStatePath,
} from "./state-paths.js"
