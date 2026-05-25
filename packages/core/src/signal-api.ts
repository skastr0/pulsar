export { CATEGORIES, type Category } from "./category.js"
export {
  Diagnostic as DiagnosticSchema,
  DiagnosticFixHint as DiagnosticFixHintSchema,
  computeDiagnosticHash,
} from "./diagnostic.js"
export type { Diagnostic, DiagnosticFixHint } from "./diagnostic.js"
export {
  ReferenceDataTag,
  SignalContextTag,
  makeReferenceData,
  type ChangedHunk,
  type ReferenceData,
  type SignalContext,
} from "./context.js"
export { InMemoryCacheLayer } from "./cache.js"
export { summarize, type DistributionalSummary } from "./distribution.js"
export {
  CANONICAL_COVERAGE_FACTS_RELATIVE_PATH,
  COVERAGE_REFERENCE_DATA_KEY,
  buildCoverageFactsArtifact,
  decodeCoverageFactsArtifactSync,
} from "./coverage-facts.js"
export type {
  CoverageFacts,
  CoverageFactsArtifactValue,
  CoverageFileFact,
  CoverageMetric,
} from "./coverage-facts.js"
export { levenshteinDistance } from "./edit-distance.js"
export { matchesAnyGlob } from "./globs.js"
export { classifyFilePath, isProductionSourcePath, sortedUniqueFilePaths } from "./file-taxonomy.js"
export { mapWithConcurrency } from "./concurrency.js"
export {
  hasSuppressingBypass,
  parseBypasses,
  toExpiredBypassDiagnostic,
  type PulsarAllowBypass,
} from "./bypass.js"
export {
  SignalComputeError,
  type RegistryError,
  type ScoringEngineError,
  type SignalError,
} from "./errors.js"
export {
  type AnySignal,
  type InputOutputs,
  type Signal,
  type SignalInputRef,
} from "./signal.js"
export {
  buildCompositeExplanation,
  compositeSignalInputs,
  resolveCompositeInputs,
  type CompositeExplanation,
  type CompositeInputExplanation,
  type CompositeInputResolution,
  type CompositeInputSpec,
  type CompositeInputState,
  type ResolvedCompositeInput,
} from "./composite.js"
export type { SignalRequirements } from "./signal-runtime.js"
export { scoreThresholdViolationShare } from "./signal-score-utils.js"
export {
  type SignalFactorAttribution,
  type SignalFactorAttributionEvidence,
  type SignalFactorDefinition,
  type SignalFactorLedger,
  type SignalFactorLedgerEntry,
  type SignalFactorPolicyMutation,
  type SignalFactorScoreRole,
  type SignalFactorSource,
  type SignalFactorValue,
  type SignalFactorValueKind,
} from "./signal-factor-model.js"
