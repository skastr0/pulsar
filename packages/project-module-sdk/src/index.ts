import {
  activateProjectModule,
  defineCalibrationProcessor,
  type ActiveProjectModule,
  type AnyCalibrationProcessor,
  type CalibrationProcessor,
  type CalibrationProcessorRole,
  type CalibrationSlotId,
  type ProjectModuleDescriptor,
  type ProjectModuleScope,
} from "@taste-codec/core"

export {
  CalibrationContextTag,
  CalibrationProcessorError,
  appendCalibrationDecision,
  computeResolvedCalibrationFingerprint,
  fingerprintProjectModule,
  hashCalibrationValue,
  makeResolvedCalibrationContext,
  stableCalibrationStringify,
  unchangedCalibrationResult,
  type ActiveProjectModule,
  type AnyCalibrationProcessor,
  type CalibrationConfidence,
  type CalibrationDecision,
  type CalibrationEvidenceRef,
  type CalibrationProcessor,
  type CalibrationProcessorRole,
  type CalibrationSlotId,
  type CalibrationSlotInput,
  type CalibrationSlotOutput,
  type CalibrationSlotResult,
  type FileClassificationValue,
  type LanguagePackActivationValue,
  type MixerCategoryPolicyValue,
  type ProjectModuleContribution,
  type ProjectModuleDescriptor,
  type ProjectModuleScope,
  type RepoFacts,
  type ResolvedCalibrationContext,
  type SourceCategory,
  type TypeScriptCallbackContextNameValue,
  type TypeScriptCloneGroupPolicyValue,
  type TypeScriptDependencyResolutionValue,
  type TypeScriptNoopClassificationValue,
  type TypeScriptSuppressionJustificationValue,
} from "@taste-codec/core"

export interface ProjectModuleProcessorDefinition<Slot extends CalibrationSlotId> {
  readonly id: string
  readonly slot: Slot
  readonly role: CalibrationProcessorRole
  readonly fingerprint: string
  readonly priority?: number
  readonly process: CalibrationProcessor<Slot>["process"]
}

export type AnyProjectModuleProcessorDefinition = ProjectModuleProcessorDefinition<any>

export interface ProjectModuleDefinitionInput<
  Processors extends ReadonlyArray<AnyProjectModuleProcessorDefinition> =
    ReadonlyArray<AnyProjectModuleProcessorDefinition>,
> {
  readonly id: string
  readonly version: string
  readonly scope: ProjectModuleScope
  readonly source?: ProjectModuleDescriptor["source"]
  readonly sourceRef?: string
  readonly configHash?: string
  readonly processors: Processors
}

export interface DefinedProjectModule {
  readonly descriptor: ProjectModuleDescriptor
  readonly activeModule: ActiveProjectModule
  readonly processors: ReadonlyArray<AnyCalibrationProcessor>
}

export const defineProcessor = <const Slot extends CalibrationSlotId>(
  processor: ProjectModuleProcessorDefinition<Slot>,
): ProjectModuleProcessorDefinition<Slot> => processor

export const defineProjectModule = <
  const Processors extends ReadonlyArray<AnyProjectModuleProcessorDefinition>,
>(
  definition: ProjectModuleDefinitionInput<Processors>,
): DefinedProjectModule => {
  const processors = definition.processors.map((processor) =>
    defineCalibrationProcessor({
      ...processor,
      moduleId: definition.id,
      moduleVersion: definition.version,
      priority: processor.priority ?? 0,
    }),
  )
  const descriptor: ProjectModuleDescriptor = {
    id: definition.id,
    version: definition.version,
    scope: definition.scope,
    source: definition.source ?? "repo-local",
    ...(definition.sourceRef !== undefined ? { sourceRef: definition.sourceRef } : {}),
    ...(definition.configHash !== undefined ? { configHash: definition.configHash } : {}),
    contributions: processors.map((processor) => ({
      slot: processor.slot,
      processorId: processor.id,
      role: processor.role,
      priority: processor.priority,
      fingerprint: processor.fingerprint,
    })),
  }

  return {
    descriptor,
    activeModule: activateProjectModule(descriptor),
    processors,
  }
}
