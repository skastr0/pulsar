import { createHash } from "node:crypto"
import { mkdir, stat, readFile, realpath, writeFile } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { Effect, Schema } from "effect"
import { preProcessFile } from "typescript"
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
} from "@skastr0/pulsar-core"
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
} from "@skastr0/pulsar-core"

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

interface ProjectModulePackageTarget {
  readonly target: string
  readonly packageRoot: string
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

    const files = yield* collectProjectModuleSourceFiles(
      ref,
      target,
      repoRoot,
      (path) => toSourceRef(relative(repoRoot, path)),
    )
    const sourceFingerprint = yield* hashProjectModuleSource(ref, target, files)
    const importTarget = yield* materializeProjectModuleImportTarget(
      ref,
      target,
      repoRoot,
      repoRoot,
      sourceFingerprint,
      files,
      ["repo"],
    )
    return {
      target: withSourceFingerprintQuery(pathToFileURL(importTarget).href, sourceFingerprint),
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

    const resolvedRepoRoot = yield* Effect.tryPromise({
      try: () => realpath(repoRoot),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: repoRoot,
          message: `Failed to resolve repository root for project module ${ref.id}`,
          cause,
        }),
    })
    const packagePath = yield* Effect.try({
      try: () =>
        createRequire(resolve(resolvedRepoRoot, "package.json")).resolve(packageName),
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
    const packageTarget = yield* resolveOwnedProjectModulePackageTarget(
      ref,
      target,
      resolvedRepoRoot,
    )
    const files = yield* collectProjectModuleSourceFiles(
      ref,
      packageTarget.target,
      packageTarget.packageRoot,
      (path) => toSourceRef(`${packageName}/${relative(packageTarget.packageRoot, path)}`),
    )
    const sourceFingerprint = yield* hashProjectModuleSource(ref, packageTarget.target, files)
    const importTarget = yield* materializeProjectModuleImportTarget(
      ref,
      packageTarget.target,
      packageTarget.packageRoot,
      resolvedRepoRoot,
      sourceFingerprint,
      files,
      ["node_modules", ...packageName.split("/")],
    )
    return {
      target: withSourceFingerprintQuery(
        pathToFileURL(importTarget).href,
        sourceFingerprint,
      ),
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

const resolveOwnedProjectModulePackageTarget = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  target: string,
  repoRoot: string,
): Effect.Effect<ProjectModulePackageTarget, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageRoot = yield* findProjectModulePackageRoot(ref, target)
    yield* verifyProjectModulePackageName(ref, target, packageRoot)

    if (ref.kind === "workspace") {
      if (!isPathInside(repoRoot, packageRoot)) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Workspace project module ${ref.packageName} must resolve inside the repository root`,
        })
      }
    } else {
      const packageIsInRepo = isPathInside(repoRoot, packageRoot)
      const packageIsRepoInstall = yield* isRepoOwnedInstalledPackage(
        ref,
        repoRoot,
        packageRoot,
      )
      if (!packageIsInRepo && !packageIsRepoInstall) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Package project module ${ref.packageName} must resolve from the repository package graph`,
        })
      }
    }

    return {
      target,
      packageRoot,
    }
  })

const findProjectModulePackageRoot = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  target: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    let cursor = dirname(target)
    while (true) {
      if (yield* isFile(resolve(cursor, "package.json"))) {
        return yield* Effect.tryPromise({
          try: () => realpath(cursor),
          catch: (cause) =>
            new ProjectModuleLoadError({
              refId: ref.id,
              target,
              message: `Failed to resolve project module package root ${ref.packageName}`,
              cause,
            }),
        })
      }
      const parent = dirname(cursor)
      if (parent === cursor) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to locate package.json for project module package ${ref.packageName}`,
        })
      }
      cursor = parent
    }
  })

const verifyProjectModulePackageName = (
  ref: ProjectModuleRef & { readonly kind: "workspace" | "package" },
  target: string,
  packageRoot: string,
): Effect.Effect<void, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageJsonPath = resolve(packageRoot, "package.json")
    const packageJson = yield* Effect.tryPromise({
      try: () => readFile(packageJsonPath, "utf8"),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to read project module package manifest ${ref.packageName}`,
          cause,
        }),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(packageJson) as unknown,
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to parse project module package manifest ${ref.packageName}`,
          cause,
        }),
    })
    const name = isRecord(parsed) ? parsed.name : undefined
    if (name !== ref.packageName) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Project module package ${ref.packageName} resolved to package manifest for ${String(name)}`,
      })
    }
  })

const isRepoOwnedInstalledPackage = (
  ref: ProjectModuleRef & { readonly kind: "package" },
  repoRoot: string,
  packageRoot: string,
): Effect.Effect<boolean, never> =>
  Effect.gen(function* () {
    const installedPackageRoot = resolve(repoRoot, "node_modules", ref.packageName)
    const installedPackageRealpath = yield* realpathOption(installedPackageRoot)
    return installedPackageRealpath === packageRoot
  })

const collectProjectModuleSourceFiles = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  sourceRefForPath: (path: string) => string,
): Effect.Effect<ReadonlyArray<ProjectModuleSourceFile>, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const files: Array<ProjectModuleSourceFile> = []
    const seen = new Set<string>()
    const sourcePackageName = yield* readProjectModulePackageNameOption(
      ref,
      target,
      sourceRoot,
    )
    const addFile = (path: string): void => {
      if (seen.has(path)) return
      seen.add(path)
      files.push({
        sourceRef: sourceRefForPath(path),
        path,
      })
    }
    const visit = (
      path: string,
    ): Effect.Effect<void, ProjectModuleLoadError> =>
      Effect.gen(function* () {
        const resolvedPath = yield* Effect.tryPromise({
          try: () => realpath(path),
          catch: (cause) =>
            new ProjectModuleLoadError({
              refId: ref.id,
              target,
              message: `Failed to resolve project module source file ${path}`,
              cause,
            }),
        })
        if (!isPathInside(sourceRoot, resolvedPath)) {
          return yield* new ProjectModuleLoadError({
            refId: ref.id,
            target,
            message: `Project module ${ref.id} imports source outside its owned source root`,
          })
        }
        if (seen.has(resolvedPath)) return
        addFile(resolvedPath)

        if (!isJavaScriptLikeProjectModuleSource(resolvedPath)) return
        const content = yield* Effect.tryPromise({
          try: () => readFile(resolvedPath, "utf8"),
          catch: (cause) =>
            new ProjectModuleLoadError({
              refId: ref.id,
              target,
              message: `Failed to read project module source file ${resolvedPath}`,
              cause,
            }),
        })
        for (const specifier of projectModuleSourceSpecifiers(content)) {
          const importedPath = yield* resolveOwnedProjectModuleSourceSpecifier(
            ref,
            target,
            sourceRoot,
            resolvedPath,
            specifier,
            sourcePackageName,
          )
          if (importedPath !== undefined) {
            yield* visit(importedPath)
          }
        }
      })

    yield* visit(target)
    const packageJsonPath = yield* realFileOption(resolve(sourceRoot, "package.json"))
    if (packageJsonPath !== undefined && isPathInside(sourceRoot, packageJsonPath)) {
      addFile(packageJsonPath)
    }
    return files
  })

const projectModuleSourceSpecifiers = (content: string): ReadonlyArray<string> => {
  const info = preProcessFile(content, true, true)
  return [
    ...new Set(
      [...info.importedFiles, ...info.referencedFiles].map((file) => file.fileName),
    ),
  ].sort()
}

const resolveOwnedProjectModuleSourceSpecifier = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromFile: string,
  specifier: string,
  sourcePackageName: string | undefined,
): Effect.Effect<string | undefined, ProjectModuleLoadError> => {
  if (isRelativeModuleSpecifier(specifier)) {
    return resolveLocalProjectModuleSourceFile(
      ref,
      target,
      sourceRoot,
      dirname(fromFile),
      specifier,
    )
  }

  if (!isOwnedPackageModuleSpecifier(specifier, sourcePackageName)) {
    return Effect.succeed(undefined)
  }

  return resolvePackageLocalProjectModuleSourceFile(
    ref,
    target,
    sourceRoot,
    fromFile,
    specifier,
  )
}

const resolveLocalProjectModuleSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromDirectory: string,
  specifier: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const requestedPath = resolve(fromDirectory, specifier)
    if (!isPathInside(sourceRoot, requestedPath)) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target,
        message: `Project module ${ref.id} imports local source outside its owned source root`,
      })
    }

    for (const candidate of localProjectModuleSourceCandidates(requestedPath)) {
      const file = yield* realFileOption(candidate)
      if (file === undefined) continue
      if (!isPathInside(sourceRoot, file)) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Project module ${ref.id} imports local source outside its owned source root`,
        })
      }
      return file
    }

    return undefined
  })

const resolvePackageLocalProjectModuleSourceFile = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  fromFile: string,
  specifier: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const resolved = yield* Effect.sync(() => {
      try {
        return createRequire(fromFile).resolve(specifier)
      } catch {
        return undefined
      }
    })
    if (resolved === undefined) return undefined
    const file = yield* realFileOption(resolved)
    if (file === undefined) return undefined
    if (!isPathInside(sourceRoot, file)) return undefined
    return file
  })

const readProjectModulePackageNameOption = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
): Effect.Effect<string | undefined, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const packageJsonPath = yield* realFileOption(resolve(sourceRoot, "package.json"))
    if (packageJsonPath === undefined) return undefined
    const packageJson = yield* Effect.tryPromise({
      try: () => readFile(packageJsonPath, "utf8"),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to read project module package scope manifest`,
          cause,
        }),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(packageJson) as unknown,
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Failed to parse project module package scope manifest`,
          cause,
        }),
    })
    const name = isRecord(parsed) ? parsed.name : undefined
    return typeof name === "string" ? name : undefined
  })

const ProjectModuleSourceExtensions = [
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".json",
] as const

const localProjectModuleSourceCandidates = (requestedPath: string): ReadonlyArray<string> => {
  const candidates = new Set<string>([requestedPath])
  for (const extension of ProjectModuleSourceExtensions) {
    candidates.add(`${requestedPath}${extension}`)
    candidates.add(resolve(requestedPath, `index${extension}`))
  }
  return [...candidates]
}

const isJavaScriptLikeProjectModuleSource = (path: string): boolean =>
  new Set(ProjectModuleSourceExtensions).has(
    extname(path) as (typeof ProjectModuleSourceExtensions)[number],
  ) && extname(path) !== ".json"

const isRelativeModuleSpecifier = (specifier: string): boolean =>
  specifier.startsWith("./") || specifier.startsWith("../")

const isOwnedPackageModuleSpecifier = (
  specifier: string,
  sourcePackageName: string | undefined,
): boolean =>
  specifier.startsWith("#") ||
  (sourcePackageName !== undefined &&
    (specifier === sourcePackageName || specifier.startsWith(`${sourcePackageName}/`)))

const materializeProjectModuleImportTarget = (
  ref: ProjectModuleRef,
  target: string,
  sourceRoot: string,
  repoRoot: string,
  sourceFingerprint: string,
  files: ReadonlyArray<ProjectModuleSourceFile>,
  shadowRootSegments: ReadonlyArray<string>,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const shadowSourceRoot = resolve(
      repoRoot,
      ".pulsar",
      "cache",
      "project-modules",
      safeSourceFingerprintPath(sourceFingerprint),
      ...shadowRootSegments,
    )
    for (const file of files) {
      const relativePath = relative(sourceRoot, file.path)
      if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Project module ${ref.id} source file escaped its owned source root while materializing`,
        })
      }
      const destination = resolve(shadowSourceRoot, relativePath)
      if (!isPathInside(shadowSourceRoot, destination)) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id,
          target,
          message: `Project module ${ref.id} source file escaped its materialized source root`,
        })
      }
      const content = yield* Effect.tryPromise({
        try: () => readFile(file.path),
        catch: (cause) =>
          new ProjectModuleLoadError({
            refId: ref.id,
            target,
            message: `Failed to read project module source ${file.sourceRef}`,
            cause,
          }),
      })
      yield* Effect.tryPromise({
        try: () => mkdir(dirname(destination), { recursive: true }),
        catch: (cause) =>
          new ProjectModuleLoadError({
            refId: ref.id,
            target,
            message: `Failed to create materialized project module source directory`,
            cause,
          }),
      })
      yield* Effect.tryPromise({
        try: () => writeFile(destination, content),
        catch: (cause) =>
          new ProjectModuleLoadError({
            refId: ref.id,
            target,
            message: `Failed to write materialized project module source ${file.sourceRef}`,
            cause,
          }),
      })
    }

    return resolve(shadowSourceRoot, relative(sourceRoot, target))
  })

const safeSourceFingerprintPath = (sourceFingerprint: string): string =>
  sourceFingerprint.replace(/[^a-zA-Z0-9._-]/g, "-")

const isFile = (path: string): Effect.Effect<boolean, never> =>
  Effect.promise(async () => {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  })

const realFileOption = (path: string): Effect.Effect<string | undefined, never> =>
  Effect.promise(async () => {
    try {
      const fileStat = await stat(path)
      if (!fileStat.isFile()) return undefined
      return await realpath(path)
    } catch {
      return undefined
    }
  })

const realpathOption = (path: string): Effect.Effect<string | undefined, never> =>
  Effect.promise(async () => {
    try {
      return await realpath(path)
    } catch {
      return undefined
    }
  })

const toSourceRef = (path: string): string => path.split(sep).join("/")

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
