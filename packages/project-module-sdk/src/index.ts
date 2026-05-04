import { createHash } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import { createRequire } from "node:module"
import { isAbsolute, relative, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { Effect, Schema } from "effect"
import {
  activateProjectModule,
  defineCalibrationProcessor,
  appendCalibrationDecision,
  type ActiveProjectModule,
  type AnyCalibrationProcessor,
  type CalibrationDecision,
  type CalibrationEvidenceRef,
  type CalibrationProcessor,
  type CalibrationProcessorRole,
  type CalibrationSlotInput,
  type CalibrationSlotId,
  type CalibrationSlotOutput,
  type CalibrationSlotResult,
  type SourceCategory,
  type TypeScriptExportReachabilityValue,
  type TypeScriptNoopClassificationValue,
  type ProjectModuleDescriptor,
  type ProjectModuleScope,
  type ResolvedCalibrationContext,
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
  type TypeScriptCallExpressionFact,
  type TypeScriptCloneGroupPolicyValue,
  type TypeScriptDependencyResolutionValue,
  type TypeScriptExportDeclarationFact,
  type TypeScriptExportReachabilityValue,
  type TypeScriptExportSpecifierFact,
  type TypeScriptImportBindingFact,
  type TypeScriptLocalBindingFact,
  type TypeScriptNoopClassificationValue,
  type TypeScriptSuppressionJustificationValue,
} from "@taste-codec/core"

export interface ProjectModuleProcessorDefinition<Slot extends CalibrationSlotId> {
  readonly id: string
  readonly slot: Slot
  readonly role: CalibrationProcessorRole
  readonly fingerprint: string
  readonly priority?: number
  readonly process: ProjectModuleProcessor<Slot>
}

export type AnyProjectModuleProcessorDefinition = ProjectModuleProcessorDefinition<any>

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
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
}

export type ProjectModuleProcessor<Slot extends CalibrationSlotId> = (
  current: CalibrationSlotOutput<Slot>,
  context: ResolvedCalibrationContext,
  runtime: ProjectModuleProcessorRuntime<Slot>,
) => ReturnType<CalibrationProcessor<Slot>["process"]>

export interface AddSourceCategoryOptions {
  readonly action?: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ClassifyTypeScriptNoopOptions {
  readonly classification: TypeScriptNoopClassificationValue["classification"]
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface MarkTypeScriptPublicEntrypointOptions {
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

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

interface ResolvedProjectModuleTarget {
  readonly target: string
  readonly source: ProjectModuleDescriptor["source"]
  readonly sourceRef: string
  readonly sourceFingerprint: string
}

interface ProjectModuleSourceFile {
  readonly sourceRef: string
  readonly path: string
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
  const processors = definition.processors.map((processor) => {
    const runtime = makeProjectModuleProcessorRuntime(definition, processor)
    return defineCalibrationProcessor({
      ...processor,
      moduleId: definition.id,
      moduleVersion: definition.version,
      priority: processor.priority ?? 0,
      process: (current, context) => processor.process(current, context, runtime),
    })
  })
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

export const makeProjectModuleDecision = <Slot extends CalibrationSlotId>(
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

export const addSourceCategory = (
  current: CalibrationSlotOutput<"taxonomy.file-classifier">,
  runtime: ProjectModuleProcessorRuntime<"taxonomy.file-classifier">,
  category: SourceCategory,
  options: AddSourceCategoryOptions,
): CalibrationSlotOutput<"taxonomy.file-classifier"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? `classify-${category}`,
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    {
      ...current.value,
      categories: [...new Set([...current.value.categories, category])].sort(),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  )
}

export const classifyTypeScriptNoop = (
  current: CalibrationSlotOutput<"typescript.noop-classifier">,
  runtime: ProjectModuleProcessorRuntime<"typescript.noop-classifier">,
  options: ClassifyTypeScriptNoopOptions,
): CalibrationSlotOutput<"typescript.noop-classifier"> => {
  const confidence = options.confidence ?? current.value.confidence
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? `classify-${options.classification}`,
      confidence: confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    {
      ...current.value,
      classification: options.classification,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  )
}

export const markTypeScriptExportPublicEntrypoint = (
  current: CalibrationSlotOutput<"typescript.export-reachability">,
  runtime: ProjectModuleProcessorRuntime<"typescript.export-reachability">,
  options: MarkTypeScriptPublicEntrypointOptions,
): CalibrationSlotOutput<"typescript.export-reachability"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue: TypeScriptExportReachabilityValue = {
    ...current.value,
    isPublicEntrypoint: true,
    ...(metadata !== undefined ? { metadata } : {}),
  }
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "mark-public-entrypoint",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    nextValue,
  )
}

export const projectModuleRefTarget = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.map(resolveProjectModuleRefTarget(ref, options), (target) => target.target)

const resolveProjectModuleRefTarget = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): Effect.Effect<ResolvedProjectModuleTarget, ProjectModuleLoadError> => {
  switch (ref.kind) {
    case "repo-local":
      return resolveRepoLocalProjectModuleTarget(ref, options)
    case "workspace":
    case "package":
      return resolvePackageProjectModuleTarget(ref, options.repoRoot)
  }
}

const resolveRepoLocalProjectModuleTarget = (
  ref: ProjectModuleRef & { readonly kind: "repo-local" },
  options: ProjectModuleLoadOptions,
): Effect.Effect<ResolvedProjectModuleTarget, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    if (isAbsolute(ref.path)) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target: ref.path,
        message: `Repo-local project module ${ref.id} must use a relative path`,
      })
    }

    const repoRoot = yield* Effect.tryPromise({
      try: () => realpath(options.repoRoot),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: options.repoRoot,
          message: `Failed to resolve repository root for project module ${ref.id}`,
          cause,
        }),
    })
    const targetPath = resolve(repoRoot, ref.path)
    const target = yield* Effect.tryPromise({
      try: () => realpath(targetPath),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: targetPath,
          message: `Failed to resolve repo-local project module ${ref.id}`,
          cause,
        }),
    })

    if (!isPathInside(repoRoot, target)) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Repo-local project module ${ref.id} resolves outside the repository root`,
      })
    }

    const sourceFingerprint = yield* hashProjectModuleSource(ref, target, [
      { sourceRef: ref.path, path: target },
    ])
    return {
      target: withSourceFingerprintQuery(pathToFileURL(target).href, sourceFingerprint),
      source: "repo-local",
      sourceRef: ref.path,
      sourceFingerprint,
    }
  })

const resolvePackageProjectModuleTarget = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  repoRoot: string,
): Effect.Effect<ResolvedProjectModuleTarget, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageName = ref.packageName
    if (!isPackageName(packageName)) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target: packageName,
        message: `Project module package ref ${packageName} is not a valid package name`,
      })
    }

    const packagePath = yield* Effect.try({
      try: () => createRequire(resolve(repoRoot, "package.json")).resolve(packageName),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: packageName,
          message: `Failed to resolve project module package ${packageName} from repository root`,
          cause,
        }),
    })

    const target = yield* Effect.tryPromise({
      try: () => realpath(packagePath),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: packagePath,
          message: `Failed to resolve project module package artifact ${packageName}`,
          cause,
        }),
    })
    const sourceFingerprint = yield* hashProjectModuleSource(ref, target, [
      { sourceRef: packageName, path: target },
    ])
    return {
      target: withSourceFingerprintQuery(pathToFileURL(target).href, sourceFingerprint),
      source: ref.kind,
      sourceRef: packageName,
      sourceFingerprint,
    }
  })

export const loadProjectModuleRef = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): Effect.Effect<DefinedProjectModule, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const resolvedTarget = yield* resolveProjectModuleRefTarget(ref, options)
    const target = resolvedTarget.target
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

    const module = yield* normalizeLoadedProjectModule(ref, target, value)
    return withLoadedProjectModuleSourceIdentity(module, resolvedTarget)
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

const withLoadedProjectModuleSourceIdentity = (
  module: DefinedProjectModule,
  target: ResolvedProjectModuleTarget,
): DefinedProjectModule => {
  const descriptor: ProjectModuleDescriptor = {
    ...module.descriptor,
    source: target.source,
    sourceRef: target.sourceRef,
    sourceFingerprint: target.sourceFingerprint,
  }
  return {
    descriptor,
    activeModule: activateProjectModule(descriptor),
    processors: module.processors,
  }
}

const makeProjectModuleProcessorRuntime = <Slot extends CalibrationSlotId>(
  definition: ProjectModuleDefinitionInput,
  processor: ProjectModuleProcessorDefinition<Slot>,
): ProjectModuleProcessorRuntime<Slot> => ({
  moduleId: definition.id,
  moduleVersion: definition.version,
  processorId: processor.id,
  slot: processor.slot,
})

const mergeMetadata = (
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined => {
  if (left === undefined) return right
  if (right === undefined) return left
  return { ...left, ...right }
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

const isPathInside = (parent: string, child: string): boolean => {
  const path = relative(parent, child)
  return path === "" || (!path.startsWith("..") && !isAbsolute(path))
}

const isPackageName = (value: string): boolean =>
  /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(value)

const hashProjectModuleSource = (
  ref: ProjectModuleRef,
  target: string,
  files: ReadonlyArray<ProjectModuleSourceFile>,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const hash = createHash("sha256")
    for (const file of [...files].sort((left, right) =>
      left.sourceRef.localeCompare(right.sourceRef),
    )) {
      const content = yield* Effect.tryPromise({
        try: () => readFile(file.path),
        catch: (cause) =>
          new ProjectModuleLoadError({
            refId: ref.id,
            target,
            message: `Failed to hash project module source ${file.sourceRef}`,
            cause,
          }),
      })
      hash.update(file.sourceRef)
      hash.update("\0")
      hash.update(content)
      hash.update("\0")
    }
    return `sha256:${hash.digest("hex")}`
  })

const withSourceFingerprintQuery = (url: string, sourceFingerprint: string): string => {
  const parsed = new URL(url)
  parsed.searchParams.set("tasteModuleSource", sourceFingerprint)
  return parsed.href
}
