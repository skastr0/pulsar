import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Effect, Schema } from "effect"
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
import type { ProjectModuleManifest, ProjectModuleRef } from "./manifest.js"

export * from "./manifest.js"

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

export class ProjectModuleLoadError extends Schema.TaggedError<ProjectModuleLoadError>()(
  "ProjectModuleLoadError",
  {
    refId: Schema.String,
    target: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface ProjectModuleLoadOptions {
  readonly repoRoot: string
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

export const projectModuleRefTarget = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): string => {
  switch (ref.kind) {
    case "repo-local":
      return pathToFileURL(resolve(options.repoRoot, ref.path)).href
    case "workspace":
    case "package":
      return ref.packageName
  }
}

export const loadProjectModuleRef = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): Effect.Effect<DefinedProjectModule, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const target = projectModuleRefTarget(ref, options)
    const imported = yield* Effect.tryPromise({
      try: () => import(target) as Promise<Record<string, unknown>>,
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to import project module ${ref.id}`,
          cause,
        }),
    })
    const exportName = ref.exportName ?? "default"
    const exported = imported[exportName]
    if (exported === undefined) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Project module ${ref.id} does not export ${exportName}`,
      })
    }

    const value =
      typeof exported === "function"
        ? yield* Effect.tryPromise({
            try: () => Promise.resolve(exported({ ref, config: ref.config ?? {}, options })),
            catch: (cause) =>
              new ProjectModuleLoadError({
                refId: ref.id,
                target,
                message: `Project module ${ref.id} factory failed`,
                cause,
              }),
          })
        : exported

    return yield* normalizeLoadedProjectModule(ref, target, value)
  })

export const loadEnabledProjectModules = (
  manifest: ProjectModuleManifest,
  options: ProjectModuleLoadOptions,
): Effect.Effect<ReadonlyArray<DefinedProjectModule>, ProjectModuleLoadError> =>
  Effect.forEach(
    manifest.modules.filter((ref) => ref.enabled),
    (ref) => loadProjectModuleRef(ref, options),
    { concurrency: 4 },
  )

const normalizeLoadedProjectModule = (
  ref: ProjectModuleRef,
  target: string,
  value: unknown,
): Effect.Effect<DefinedProjectModule, ProjectModuleLoadError> => {
  if (isDefinedProjectModule(value)) return Effect.succeed(value)
  if (isProjectModuleDefinitionInput(value)) return Effect.succeed(defineProjectModule(value))

  return Effect.fail(new ProjectModuleLoadError({
    refId: ref.id,
    target,
    message: `Project module ${ref.id} must export a DefinedProjectModule or ProjectModuleDefinitionInput`,
  }))
}

const isDefinedProjectModule = (value: unknown): value is DefinedProjectModule => {
  if (!isRecord(value)) return false
  return (
    isRecord(value.descriptor) &&
    isRecord(value.activeModule) &&
    Array.isArray(value.processors)
  )
}

const isProjectModuleDefinitionInput = (
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
