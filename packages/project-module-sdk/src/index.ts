export {
  decodeProjectModuleManifest,
  fingerprintProjectModuleManifest,
  type PackageProjectModuleRef,
  type ProjectModuleManifest,
  type ProjectModuleRef,
  type ProjectModuleRefConfig,
  type RepoLocalProjectModuleRef,
  type WorkspaceProjectModuleRef,
} from "./manifest.js"

export {
  appendProjectModuleDecision,
  defineProcessor,
  defineProjectModule,
  makeProjectModuleDecision,
  makeProjectModuleProcessorRuntime,
  type AnyProjectModuleProcessorDefinition,
  type DefinedProjectModule,
  type ProjectModuleDecisionInput,
  type ProjectModuleDefinitionInput,
  type ProjectModuleProcessor,
  type ProjectModuleProcessorDefinition,
  type ProjectModuleProcessorRuntime,
} from "./definition.js"

export {
  addSourceCategory,
  classifyTypeScriptNoop,
  markTypeScriptExportPublicEntrypoint,
  nameTypeScriptCallbackContext,
  tuneTypeScriptUnfinishedImplementation,
  type AddSourceCategoryOptions,
  type ClassifyTypeScriptNoopOptions,
  type MarkTypeScriptPublicEntrypointOptions,
  type NameTypeScriptCallbackContextOptions,
  type TuneTypeScriptUnfinishedImplementationOptions,
} from "./helpers.js"

export {
  loadEnabledProjectModules,
  loadProjectModuleRef,
  type ProjectModuleLoadOptions,
} from "./loader.js"

export {
  fingerprintProjectModule,
  makeResolvedCalibrationContext,
  type ActiveProjectModule,
  type AnyCalibrationProcessor,
  type CalibrationConfidence,
  type CalibrationDecision,
  type CalibrationEvidenceRef,
  type CalibrationProcessorRole,
  type CalibrationSlotId,
  type CalibrationSlotInput,
  type CalibrationSlotOutput,
  type CalibrationSlotResult,
  type ProjectModuleContribution,
  type ProjectModuleDescriptor,
  type ProjectModuleScope,
  type RepoFacts,
  type ResolvedCalibrationContext,
  type SourceCategory,
  type TypeScriptCallbackContextNameValue,
  type TypeScriptCallExpressionFact,
  type TypeScriptExportDeclarationFact,
  type TypeScriptExportReachabilityValue,
  type TypeScriptExportSpecifierFact,
  type TypeScriptImportBindingFact,
  type TypeScriptLocalBindingFact,
  type TypeScriptNoopClassificationValue,
  type TypeScriptUnfinishedImplementationPolicyValue,
} from "@skastr0/pulsar-core"
