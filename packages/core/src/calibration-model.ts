import { Context, Effect, Schema } from "effect"

import type { CalibrationSlotValues } from "./calibration-slot-values.js"

export type * from "./calibration-slot-values.js"

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
  "typescript.unsafe-type-policy",
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

export interface CalibrationSlots extends CalibrationSlotValues {}

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

export type AnyCalibrationProcessor = {
  readonly [Slot in CalibrationSlotId]: CalibrationProcessor<Slot>
}[CalibrationSlotId]

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
