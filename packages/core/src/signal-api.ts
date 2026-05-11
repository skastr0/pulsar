export { CATEGORIES, type Category } from "./category.js"
export { type Diagnostic, computeDiagnosticHash } from "./diagnostic.js"
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
export { levenshteinDistance } from "./edit-distance.js"
export { matchesAnyGlob } from "./globs.js"
export { isProductionSourcePath } from "./file-taxonomy.js"
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
  type Signal,
  type SignalFactorDefinition,
  type SignalFactorLedger,
  type SignalFactorLedgerEntry,
  type SignalFactorValue,
} from "./signal.js"
