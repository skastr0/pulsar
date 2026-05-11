import {
  activateProjectModule,
  appendCalibrationDecision,
  defineCalibrationProcessor,
  type ActiveProjectModule,
  type AnyCalibrationProcessor,
  type CalibrationDecision,
  type CalibrationEvidenceRef,
  type CalibrationProcessor,
  type CalibrationProcessorRole,
  type CalibrationSlotId,
  type CalibrationSlotInput,
  type CalibrationSlotOutput,
  type CalibrationSlotResult,
  type ProjectModuleDescriptor,
  type ProjectModuleScope,
  type ResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"

export interface ProjectModuleProcessorDefinition<Slot extends CalibrationSlotId> {
  readonly id: string
  readonly slot: Slot
  readonly role: CalibrationProcessorRole
  readonly fingerprint: string
  readonly priority?: number
  readonly process: ProjectModuleProcessor<Slot>
}

export type AnyProjectModuleProcessorDefinition =
  {
    readonly [Slot in CalibrationSlotId]: ProjectModuleProcessorDefinition<Slot>
  }[CalibrationSlotId]

export interface ProjectModuleProcessorRuntime<Slot extends CalibrationSlotId> {
  readonly moduleId: string
  readonly moduleVersion: string
  readonly processorId: string
  readonly slot: Slot
}

export interface ProjectModuleDecisionInput {
  readonly action: string
  readonly confidence: CalibrationDecision["confidence"]
  readonly reason: string
  readonly ruleId?: string
  readonly factorPaths?: ReadonlyArray<string>
  readonly before?: unknown
  readonly after?: unknown
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
}

export type ProjectModuleProcessor<Slot extends CalibrationSlotId> = (
  current: CalibrationSlotOutput<Slot>,
  context: ResolvedCalibrationContext,
  runtime: ProjectModuleProcessorRuntime<Slot>,
) => ReturnType<CalibrationProcessor<Slot>["process"]>

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
    defineRuntimeCalibrationProcessor(definition, processor),
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

const defineRuntimeCalibrationProcessor = (
  definition: ProjectModuleDefinitionInput,
  processor: AnyProjectModuleProcessorDefinition,
): AnyCalibrationProcessor => {
  const typedProcessor = processor as unknown as ProjectModuleProcessorDefinition<CalibrationSlotId>
  const runtime = makeProjectModuleProcessorRuntime(definition, typedProcessor)
  return defineCalibrationProcessor({
    ...typedProcessor,
    moduleId: definition.id,
    moduleVersion: definition.version,
    priority: typedProcessor.priority ?? 0,
    process: (current, context) => typedProcessor.process(current, context, runtime),
  }) as unknown as AnyCalibrationProcessor
}

const makeProjectModuleDecision = <Slot extends CalibrationSlotId>(
  runtime: ProjectModuleProcessorRuntime<Slot>,
  input: ProjectModuleDecisionInput,
): CalibrationDecision => ({
  moduleId: runtime.moduleId,
  processorId: runtime.processorId,
  slot: runtime.slot,
  action: input.action,
  confidence: input.confidence,
  reason: input.reason,
  ...(input.ruleId !== undefined ? { ruleId: input.ruleId } : {}),
  ...(input.factorPaths !== undefined ? { factorPaths: input.factorPaths } : {}),
  ...(input.before !== undefined ? { before: input.before } : {}),
  ...(input.after !== undefined ? { after: input.after } : {}),
  evidence: input.evidence ?? [],
})

export const appendProjectModuleDecision = <Slot extends CalibrationSlotId>(
  current: CalibrationSlotOutput<Slot>,
  runtime: ProjectModuleProcessorRuntime<Slot>,
  decision: ProjectModuleDecisionInput,
  nextValue?: CalibrationSlotInput<Slot>,
): CalibrationSlotResult<CalibrationSlotInput<Slot>> =>
  appendCalibrationDecision(
    current,
    makeProjectModuleDecision(runtime, decision),
    nextValue,
  )

const makeProjectModuleProcessorRuntime = <Slot extends CalibrationSlotId>(
  definition: ProjectModuleDefinitionInput,
  processor: ProjectModuleProcessorDefinition<Slot>,
): ProjectModuleProcessorRuntime<Slot> => ({
  moduleId: definition.id,
  moduleVersion: definition.version,
  processorId: processor.id,
  slot: processor.slot,
})

export const isDefinedProjectModule = (value: unknown): value is DefinedProjectModule => {
  if (!isRecord(value)) return false
  return (
    isRecord(value.descriptor) &&
    isRecord(value.activeModule) &&
    Array.isArray(value.processors)
  )
}

export const isProjectModuleDefinitionInput = (
  value: unknown,
): value is ProjectModuleDefinitionInput => {
  if (!isRecord(value)) return false
  return (
    typeof value.id === "string" &&
    typeof value.version === "string" &&
    typeof value.scope === "string" &&
    Array.isArray(value.processors)
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object"
