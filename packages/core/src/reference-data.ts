export {
  AI_FACT_ARTIFACT_SCHEMA_VERSION,
  AI_FACT_REPLAY_OUTPUT_SCHEMA_VERSION,
  AiFactArtifactMode,
  AiFactEnforcementCeiling,
  AiFactInputScope,
  computeAiFactArtifactFingerprint,
  computeAiFactCacheFingerprint,
  decodeAiFactLabelArtifactSync,
  replayAiFactArtifact,
  serializeAiFactReplayOutput,
} from "./ai-facts.js"
export type {
  AiFactClassifierDescriptor,
  AiFactEvidenceRef,
  AiFactInputDescriptor,
  AiFactLabel,
  AiFactLabelArtifact,
  AiFactPolicy,
  AiFactProvenance,
  AiFactReplayOutput,
} from "./ai-facts.js"
export {
  computeDiagnosticHash,
  type Diagnostic,
} from "./diagnostic.js"
export {
  decodeGlossaryDraftSync,
  decodeGlossarySync,
  type CanonicalGlossaryTerm,
  type Glossary,
  type GlossaryDraft,
  type GlossaryIdentifierKind,
  type GlossaryProvenance,
} from "./glossary.js"
export {
  decodeSchemaConventionsSync,
  type BoundaryConvention,
  type NamingConventions,
  type SchemaConventions,
} from "./conventions.js"
export {
  CANONICAL_COVERAGE_FACTS_RELATIVE_PATH,
  COVERAGE_FACTS_ARTIFACT_SCHEMA_VERSION,
  CANONICAL_ISTANBUL_RELATIVE_PATH,
  CANONICAL_LCOV_RELATIVE_PATH,
  COVERAGE_REFERENCE_DATA_KEY,
  CoverageFactsArtifact,
  CoverageFactsSchema,
  buildCoverageFactsArtifact,
  CoverageFactState,
  buildAbsentCoverageFacts,
  buildUnknownCoverageFacts,
  coverageMetric,
  decodeCoverageFactsArtifactSync,
  emptyCoverageMetric,
  parseCoverageCandidate,
  summarizeCoverageFiles,
} from "./coverage-facts.js"
export type {
  CoverageFactsArtifactValue,
  CoverageFacts,
  CoverageFileFact,
  CoverageMetric,
} from "./coverage-facts.js"
export {
  CANONICAL_CONTRACT_FRESHNESS_RELATIVE_PATH,
  CONTRACT_FRESHNESS_REFERENCE_DATA_KEY,
  ContractFreshnessManifest,
  buildNotConfiguredContractFreshnessFacts,
  buildUnknownContractFreshnessFacts,
  decodeContractFreshnessManifestSync,
  loadContractFreshnessFacts,
} from "./contract-freshness.js"
export type {
  ContractFreshnessArtifactFact,
  ContractFreshnessFactState,
  ContractFreshnessFacts,
  ContractFreshnessFinding,
  ContractFreshnessFindingKind,
} from "./contract-freshness.js"
export {
  CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
  DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY,
  DomainConstructionManifest,
  buildNotConfiguredDomainConstructionFacts,
  buildUnknownDomainConstructionFacts,
  decodeDomainConstructionManifestSync,
  loadDomainConstructionFacts,
} from "./domain-construction.js"
export type {
  DomainConstructionConstructFact,
  DomainConstructionFactState,
  DomainConstructionFacts,
  DomainConstructionFinding,
  DomainConstructionFindingKind,
} from "./domain-construction.js"
export {
  CANONICAL_CONVENTIONS_RELATIVE_PATH,
  CANONICAL_GLOSSARY_RELATIVE_PATH,
  loadCanonicalReferenceDataEntries,
} from "./reference-data-loader.js"
export {
  ReferenceDataTag,
  makeReferenceData,
  type ReferenceData,
} from "./context.js"
