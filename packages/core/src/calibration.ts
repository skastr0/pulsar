import { createHash } from "node:crypto"
import { Context, Effect, Schema } from "effect"

export const CALIBRATION_SLOT_IDS = [
  "taxonomy.file-classifier",
  "language-pack-activation",
  "typescript.noop-classifier",
  "typescript.clone-group-policy",
  "typescript.dependency-resolver",
  "typescript.suppression-justifier",
  "typescript.callback-context-namer",
  "typescript.export-reachability",
  "typescript.unfinished-implementation-policy",
  "mixer.category-policy",
] as const

export const CalibrationSlotId = Schema.Literal(...CALIBRATION_SLOT_IDS)
export type CalibrationSlotId = typeof CalibrationSlotId.Type

export const CalibrationProcessorRole = Schema.Literal(
  "filter",
  "resolver",
  "normalizer",
  "compressor",
  "enricher",
  "factor-policy",
  "mixer-policy",
)
export type CalibrationProcessorRole = typeof CalibrationProcessorRole.Type

export const CalibrationConfidence = Schema.Literal("high", "medium", "low")
export type CalibrationConfidence = typeof CalibrationConfidence.Type

export const SourceCategory = Schema.Literal(
  "production_source",
  "test_code",
  "test_utility",
  "example",
  "generated",
  "config_tooling",
  "declaration",
  "build_artifact",
  "dependency",
  "hidden_tooling",
  "documentation",
  "stories",
  "unknown",
)
export type SourceCategory = typeof SourceCategory.Type

export interface CalibrationEvidenceRef {
  readonly kind: string
  readonly value: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface CalibrationDecision {
  readonly moduleId: string
  readonly processorId: string
  readonly slot: CalibrationSlotId
  readonly action: string
  readonly confidence: CalibrationConfidence
  readonly reason: string
  readonly ruleId?: string
  readonly factorPaths?: ReadonlyArray<string>
  readonly before?: unknown
  readonly after?: unknown
  readonly evidence: ReadonlyArray<CalibrationEvidenceRef>
}

export interface CalibrationSlotResult<Value> {
  readonly value: Value
  readonly decisions: ReadonlyArray<CalibrationDecision>
}

export const unchangedCalibrationResult = <Value>(
  value: Value,
): CalibrationSlotResult<Value> => ({
  value,
  decisions: [],
})

export const appendCalibrationDecision = <Value>(
  result: CalibrationSlotResult<Value>,
  decision: CalibrationDecision,
  nextValue?: Value,
): CalibrationSlotResult<Value> => ({
  value: nextValue ?? result.value,
  decisions: [...result.decisions, decision],
})

export interface FileClassificationValue {
  readonly path: string
  readonly categories: ReadonlyArray<SourceCategory>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface LanguagePackActivationValue {
  readonly repoRoot: string
  readonly sourceExtensions: ReadonlyArray<string>
  readonly activePackIds: ReadonlyArray<string>
  readonly evidence: ReadonlyArray<CalibrationEvidenceRef>
}

export interface TypeScriptNoopClassificationValue {
  readonly file: string
  readonly name: string
  readonly line?: number
  readonly nodeKind: string
  readonly bodyText?: string
  readonly functionText?: string
  readonly parentKind?: string
  readonly parentText?: string
  readonly ancestorKinds?: ReadonlyArray<string>
  readonly candidateKind?:
    | "throw-not-implemented"
    | "empty-body"
    | "todo-comment"
    | "mock-return"
    | "unknown"
  readonly inTestPath?: boolean
  readonly classification: "unknown" | "intentional_noop" | "stub"
  readonly confidence?: CalibrationConfidence
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptCloneGroupPolicyValue {
  readonly groupId: string
  readonly action: "keep" | "deweight" | "exclude"
  readonly factor: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptDependencyResolutionValue {
  readonly specifier: string
  readonly fromFile: string
  readonly resolution:
    | "unresolved"
    | "declared"
    | "virtual_module"
    | "path_alias"
    | "workspace"
    | "bundled_external"
    | "facade_alias"
  readonly packageName?: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptSuppressionJustificationValue {
  readonly file: string
  readonly line: number
  readonly directive: string
  readonly justification: "unknown" | "justified" | "suspicious" | "unjustified"
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptCallbackContextNameValue {
  readonly file: string
  readonly line: number
  readonly fallbackName: string
  readonly resolvedName: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptCallExpressionFact {
  readonly calleeText: string
  readonly calleeName?: string
}

export interface TypeScriptImportBindingFact {
  readonly moduleSpecifier: string
  readonly importKind: "default" | "named" | "namespace"
  readonly importedName: string
  readonly localName: string
}

export interface TypeScriptLocalBindingFact {
  readonly localName: string
  readonly initializerCall?: TypeScriptCallExpressionFact
}

export interface TypeScriptExportSpecifierFact {
  readonly exportedName: string
  readonly localName: string
  readonly moduleSpecifier?: string
}

export interface TypeScriptExportDeclarationFact {
  readonly declarationKind: string
  readonly exportName: string
  readonly localName?: string
  readonly initializerCall?: TypeScriptCallExpressionFact
  readonly expressionIdentifier?: string
  readonly expressionCall?: TypeScriptCallExpressionFact
}

export interface TypeScriptExportReachabilityValue {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly declarationKinds: ReadonlyArray<string>
  readonly declarations?: ReadonlyArray<TypeScriptExportDeclarationFact>
  readonly sourceImports?: ReadonlyArray<TypeScriptImportBindingFact>
  readonly sourceLocalBindings?: ReadonlyArray<TypeScriptLocalBindingFact>
  readonly sourceExportSpecifiers?: ReadonlyArray<TypeScriptExportSpecifierFact>
  readonly isPublicEntrypoint: boolean
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TypeScriptUnfinishedImplementationPolicyValue {
  readonly signalId: string
  readonly findingId: string
  readonly file: string
  readonly name: string
  readonly line?: number
  readonly stubKind:
    | "throw-not-implemented"
    | "empty-body"
    | "todo-comment"
    | "mock-return"
    | "unknown"
  readonly message: string
  readonly visible: boolean
  readonly severity: "info" | "warn" | "block"
  readonly confidence: CalibrationConfidence
  readonly penaltyWeight: number
  readonly scoreCapParticipation: boolean
  readonly scoreCap?: number
  readonly factorPathPrefix: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface MixerCategoryPolicyValue {
  readonly category: string
  readonly rawScore: number
  readonly finalScore: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface CalibrationSlots {
  readonly "taxonomy.file-classifier": FileClassificationValue
  readonly "language-pack-activation": LanguagePackActivationValue
  readonly "typescript.noop-classifier": TypeScriptNoopClassificationValue
  readonly "typescript.clone-group-policy": TypeScriptCloneGroupPolicyValue
  readonly "typescript.dependency-resolver": TypeScriptDependencyResolutionValue
  readonly "typescript.suppression-justifier": TypeScriptSuppressionJustificationValue
  readonly "typescript.callback-context-namer": TypeScriptCallbackContextNameValue
  readonly "typescript.export-reachability": TypeScriptExportReachabilityValue
  readonly "typescript.unfinished-implementation-policy": TypeScriptUnfinishedImplementationPolicyValue
  readonly "mixer.category-policy": MixerCategoryPolicyValue
}

export type CalibrationSlotInput<Slot extends CalibrationSlotId> =
  CalibrationSlots[Slot]

export type CalibrationSlotOutput<Slot extends CalibrationSlotId> =
  CalibrationSlotResult<CalibrationSlots[Slot]>

export const ProjectModuleScope = Schema.Literal(
  "core",
  "language",
  "ecosystem",
  "technology",
  "framework",
  "organization",
  "repository",
)
export type ProjectModuleScope = typeof ProjectModuleScope.Type

export interface ProjectModuleContribution {
  readonly slot: CalibrationSlotId
  readonly processorId: string
  readonly role: CalibrationProcessorRole
  readonly priority: number
  readonly fingerprint: string
}

export interface ProjectModuleDescriptor {
  readonly id: string
  readonly version: string
  readonly scope: ProjectModuleScope
  readonly source: "builtin" | "package" | "workspace" | "repo-local"
  readonly sourceRef?: string
  readonly sourceFingerprint?: string
  readonly configHash?: string
  readonly contributions: ReadonlyArray<ProjectModuleContribution>
}

export interface ActiveProjectModule extends ProjectModuleDescriptor {
  readonly fingerprint: string
}

export interface RepoFacts {
  readonly repoRoot: string
  readonly fingerprint: string
  readonly detectedTechnologies: ReadonlyArray<string>
  readonly sourceExtensions: ReadonlyArray<string>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export class CalibrationProcessorError extends Schema.TaggedError<CalibrationProcessorError>()(
  "CalibrationProcessorError",
  {
    slot: CalibrationSlotId,
    moduleId: Schema.String,
    processorId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface CalibrationProcessor<Slot extends CalibrationSlotId> {
  readonly id: string
  readonly moduleId: string
  readonly moduleVersion: string
  readonly slot: Slot
  readonly role: CalibrationProcessorRole
  readonly priority: number
  readonly fingerprint: string
  readonly process: (
    current: CalibrationSlotOutput<Slot>,
    context: ResolvedCalibrationContext,
  ) => Effect.Effect<CalibrationSlotOutput<Slot>, CalibrationProcessorError, never>
}

export type AnyCalibrationProcessor = CalibrationProcessor<any>

export interface ResolvedCalibrationContext {
  readonly fingerprint: string
  readonly activeModules: ReadonlyArray<ActiveProjectModule>
  readonly repoFacts: RepoFacts
  readonly processors: ReadonlyArray<AnyCalibrationProcessor>
  readonly runSlot: <Slot extends CalibrationSlotId>(
    slot: Slot,
    input: CalibrationSlotInput<Slot>,
  ) => Effect.Effect<CalibrationSlotOutput<Slot>, CalibrationProcessorError, never>
}

export class CalibrationContextTag extends Context.Tag(
  "@skastr0/pulsar-core/CalibrationContext",
)<CalibrationContextTag, ResolvedCalibrationContext>() {}

export const defineCalibrationProcessor = <Slot extends CalibrationSlotId>(
  processor: CalibrationProcessor<Slot>,
): CalibrationProcessor<Slot> => processor

export const fingerprintProjectModule = (
  module: ProjectModuleDescriptor,
): string =>
  hashCalibrationValue({
    id: module.id,
    version: module.version,
    scope: module.scope,
    source: module.source,
    sourceRef: module.sourceRef ?? null,
    sourceFingerprint: module.sourceFingerprint ?? null,
    configHash: module.configHash ?? null,
    contributions: normalizeContributions(module.contributions),
  })

export const activateProjectModule = (
  module: ProjectModuleDescriptor,
): ActiveProjectModule => ({
  ...module,
  fingerprint: fingerprintProjectModule(module),
})

export const computeResolvedCalibrationFingerprint = (input: {
  readonly activeModules: ReadonlyArray<ActiveProjectModule>
  readonly repoFacts: RepoFacts
  readonly processors: ReadonlyArray<AnyCalibrationProcessor>
}): string =>
  hashCalibrationValue({
    repoFacts: {
      fingerprint: input.repoFacts.fingerprint,
      detectedTechnologies: [...input.repoFacts.detectedTechnologies].sort(),
      sourceExtensions: [...input.repoFacts.sourceExtensions].sort(),
    },
    activeModules: input.activeModules
      .map((module) => ({
        id: module.id,
        version: module.version,
        scope: module.scope,
        fingerprint: module.fingerprint,
      }))
      .sort(compareByIdThenVersion),
    processors: input.processors
      .map((processor) => ({
        id: processor.id,
        moduleId: processor.moduleId,
        moduleVersion: processor.moduleVersion,
        slot: processor.slot,
        role: processor.role,
        priority: processor.priority,
        fingerprint: processor.fingerprint,
      }))
      .sort(compareProcessorDescriptor),
  })

export const makeResolvedCalibrationContext = (input: {
  readonly activeModules?: ReadonlyArray<ActiveProjectModule>
  readonly repoFacts: RepoFacts
  readonly processors?: ReadonlyArray<AnyCalibrationProcessor>
}): ResolvedCalibrationContext => {
  const activeModules = [...(input.activeModules ?? [])].sort(compareByIdThenVersion)
  const processors = [...(input.processors ?? [])].sort(compareProcessor)
  const processorsBySlot = new Map<CalibrationSlotId, ReadonlyArray<AnyCalibrationProcessor>>()
  for (const slot of CALIBRATION_SLOT_IDS) {
    processorsBySlot.set(
      slot,
      processors.filter((processor) => processor.slot === slot),
    )
  }

  const context: ResolvedCalibrationContext = {
    fingerprint: computeResolvedCalibrationFingerprint({
      activeModules,
      repoFacts: input.repoFacts,
      processors,
    }),
    activeModules,
    repoFacts: input.repoFacts,
    processors,
    runSlot: <Slot extends CalibrationSlotId>(
      slot: Slot,
      slotInput: CalibrationSlotInput<Slot>,
    ): Effect.Effect<CalibrationSlotOutput<Slot>, CalibrationProcessorError, never> =>
      Effect.gen(function* () {
        let current: CalibrationSlotOutput<Slot> = unchangedCalibrationResult(slotInput)
        const slotProcessors = processorsBySlot.get(slot) ?? []
        for (const processor of slotProcessors) {
          current = yield* processor
            .process(current, context)
            .pipe(Effect.withSpan(`calibration.${slot}.${processor.moduleId}.${processor.id}`))
        }
        return current
      }),
  }

  return context
}

export const hashCalibrationValue = (value: unknown): string =>
  createHash("sha256").update(stableCalibrationStringify(value)).digest("hex")

export const stableCalibrationStringify = (value: unknown): string => {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  if (Array.isArray(value)) {
    return `[${value.map(stableCalibrationStringify).join(",")}]`
  }

  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableCalibrationStringify(object[key])}`)
    .join(",")}}`
}

const normalizeContributions = (
  contributions: ReadonlyArray<ProjectModuleContribution>,
): ReadonlyArray<ProjectModuleContribution> =>
  [...contributions].sort((left, right) =>
    left.slot.localeCompare(right.slot) ||
    left.priority - right.priority ||
    left.processorId.localeCompare(right.processorId),
  )

const compareByIdThenVersion = (
  left: { readonly id: string; readonly version: string },
  right: { readonly id: string; readonly version: string },
): number => left.id.localeCompare(right.id) || left.version.localeCompare(right.version)

const compareProcessor = (
  left: AnyCalibrationProcessor,
  right: AnyCalibrationProcessor,
): number =>
  left.slot.localeCompare(right.slot) ||
  left.priority - right.priority ||
  left.moduleId.localeCompare(right.moduleId) ||
  left.id.localeCompare(right.id)

const compareProcessorDescriptor = (
  left: {
    readonly slot: string
    readonly priority: number
    readonly moduleId: string
    readonly id: string
  },
  right: {
    readonly slot: string
    readonly priority: number
    readonly moduleId: string
    readonly id: string
  },
): number =>
  left.slot.localeCompare(right.slot) ||
  left.priority - right.priority ||
  left.moduleId.localeCompare(right.moduleId) ||
  left.id.localeCompare(right.id)
