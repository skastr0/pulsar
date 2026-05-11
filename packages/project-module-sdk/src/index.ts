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
  tuneTypeScriptUnsafeType,
  tuneTypeScriptUnfinishedImplementation,
  type AddSourceCategoryOptions,
  type ClassifyTypeScriptNoopOptions,
  type MarkTypeScriptPublicEntrypointOptions,
  type NameTypeScriptCallbackContextOptions,
  type TuneTypeScriptUnsafeTypeOptions,
  type TuneTypeScriptUnfinishedImplementationOptions,
} from "./helpers.js"

export {
  tuneTypeScriptTypeCoupling,
  tuneTypeScriptDependencyVersion,
} from "./dependency-version-helper.js"

export {
  loadEnabledProjectModules,
  loadProjectModuleRef,
} from "./loader.js"
export type { ProjectModuleLoadOptions } from "./loader-types.js"

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
  type TypeScriptDependencyVersionPolicyValue,
  type TypeScriptExportDeclarationFact,
  type TypeScriptExportReachabilityValue,
  type TypeScriptExportSpecifierFact,
  type TypeScriptImportBindingFact,
  type TypeScriptLocalBindingFact,
  type TypeScriptNoopClassificationValue,
  type TypeScriptTypeCouplingPolicyValue,
  type TypeScriptUnsafeTypePolicyValue,
  type TypeScriptUnfinishedImplementationPolicyValue,
} from "@skastr0/pulsar-core/calibration"
