import { Context, Effect, Layer, Schema, Semaphore } from "effect"
import { openQuartzWorkspace, type QuartzWorkspace } from "@skastr0/quartz-engine"
import type { CalibrationProcessorError } from "@skastr0/pulsar-core/calibration"
import {
  materializeAnalysisConfigs,
  removeAnalysisConfigBundle,
  type AnalysisConfigBundle,
} from "./analysis-config.js"
import { discoverPackages, type PackageInfo } from "./discovery.js"
import {
  canonicalPath,
  chooseOwningProject,
  fallbackProjectId,
  isAnalyzableTypeScriptPath,
  listProductionTypeScriptFiles,
  projectIdForConfig,
  relativeWorktreePath,
  shouldIgnoreSourcePath,
  type TsProjectOptions,
} from "./source-membership.js"
import type { Project, SourceFile } from "./tsgo-api.js"
import { resolveTsgoExecutablePath } from "./tsgo-runtime.js"

export type { TsProjectOptions }

export class TsAnalysisError extends Schema.TaggedError<TsAnalysisError>()("TsAnalysisError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown),
}) {}

export interface TsFile {
  readonly path: string
  readonly relativePath: string
  readonly projectId: string
}

export interface TsFileContext {
  readonly file: TsFile
  readonly sourceFile: SourceFile
  readonly project: Project
}

export interface TsAnalysis {
  readonly files: ReadonlyArray<TsFile>
  mapFiles<A>(
    visit: (context: TsFileContext) => Promise<A>,
  ): Effect.Effect<ReadonlyArray<A>, TsAnalysisError>
  withProject<A>(
    projectId: string,
    visit: (project: Project, files: ReadonlyArray<TsFile>) => Promise<A>,
  ): Effect.Effect<A, TsAnalysisError>
}

export interface TsFileChanges {
  readonly changed?: ReadonlyArray<string>
  readonly created?: ReadonlyArray<string>
  readonly deleted?: ReadonlyArray<string>
}

export interface TsAnalysisSession {
  observationLayer(
    changes?: TsFileChanges,
  ): Layer.Layer<TsAnalysisTag | TsPackageInfoTag, TsAnalysisError | CalibrationProcessorError>
}

export class TsAnalysisTag extends Context.Service<TsAnalysisTag, TsAnalysis>()(
  "@skastr0/pulsar-ts-pack/TsAnalysis",
) {}

export class TsPackageInfoTag extends Context.Service<
  TsPackageInfoTag,
  ReadonlyArray<PackageInfo>
>()("@skastr0/pulsar-ts-pack/TsPackageInfo") {}

export const makeTsAnalysisSession = Effect.fn("makeTsAnalysisSession")(function* (
  worktreePath: string,
  options?: TsProjectOptions,
): Effect.fn.Return<TsAnalysisSession, TsAnalysisError, import("effect/Scope").Scope> {
  const root = canonicalPath(worktreePath)
  const tsserverPath = yield* resolveTsgoExecutablePath().pipe(
    Effect.mapError((cause) =>
      new TsAnalysisError({ message: cause.message, cause }),
    ),
  )
  const lease = yield* Semaphore.make(1)
  const state: SessionState = {
    workspace: undefined,
    configFingerprint: "",
    configBundle: undefined,
  }

  yield* Effect.acquireRelease(Effect.succeed(state), (sessionState) =>
    Effect.promise(async () => {
      if (sessionState.workspace !== undefined) {
        await sessionState.workspace.close()
        sessionState.workspace = undefined
      }
    }),
  )

  return {
    observationLayer: (changes?: TsFileChanges) =>
      Layer.effectContext(
        Effect.gen(function* () {
          yield* lease.take(1)
          yield* Effect.addFinalizer(() => lease.release(1).pipe(Effect.asVoid))
          const observation = yield* buildObservation(root, options, tsserverPath, state, changes)
          return Context.make(TsAnalysisTag, observation.analysis).pipe(
            Context.add(TsPackageInfoTag, observation.packages),
          )
        }),
      ),
  }
})

export const TsAnalysisLayer = (
  worktreePath: string,
  options?: TsProjectOptions,
): Layer.Layer<TsAnalysisTag | TsPackageInfoTag, TsAnalysisError | CalibrationProcessorError> =>
  Layer.unwrap(
    Effect.gen(function* () {
      const session = yield* makeTsAnalysisSession(worktreePath, options)
      return session.observationLayer()
    }),
  )

export const TsPackageInfoLayer = (
  worktreePath: string,
): Layer.Layer<TsPackageInfoTag> =>
  Layer.effect(TsPackageInfoTag, discoverPackages(worktreePath))

interface SessionState {
  workspace: QuartzWorkspace | undefined
  configFingerprint: string
  configBundle: AnalysisConfigBundle | undefined
}

interface BuiltObservation {
  readonly analysis: TsAnalysis
  readonly packages: ReadonlyArray<PackageInfo>
}

const buildObservation = (
  worktreePath: string,
  options: TsProjectOptions | undefined,
  tsserverPath: string,
  state: SessionState,
  changes: TsFileChanges | undefined,
): Effect.Effect<BuiltObservation, TsAnalysisError | CalibrationProcessorError> =>
  Effect.gen(function* () {
    const packages = yield* discoverPackages(worktreePath)
    const originalConfigPaths = packages.map((pkg) => canonicalPath(pkg.tsconfigPath))
    const fingerprint = originalConfigPaths.slice().sort().join("\0")
    if (state.workspace !== undefined && state.configFingerprint !== fingerprint) {
      yield* replaceWorkspace(state)
    }
    if (state.workspace === undefined) {
      const bundle = yield* materializeAnalysisConfigs(worktreePath, originalConfigPaths).pipe(
        Effect.mapError((cause) => new TsAnalysisError({ message: cause.message, cause })),
      )
      const derivedPaths = bundle.configs.map((config) => config.derivedPath)
      const workspace = yield* Effect.tryPromise({
        try: () =>
          openQuartzWorkspace(worktreePath, {
            ...(derivedPaths[0] === undefined ? {} : { tsconfigPath: derivedPaths[0] }),
            ...(derivedPaths.length > 1 ? { tsconfigPaths: derivedPaths } : {}),
            tsserverPath,
          }),
        catch: (cause) =>
          new TsAnalysisError({
            message: `Failed to open Quartz workspace for ${worktreePath}`,
            cause,
          }),
      })
      state.workspace = workspace
      state.configBundle = bundle
      state.configFingerprint = fingerprint
    } else {
      yield* Effect.tryPromise({
        try: () =>
          state.workspace!.refresh(
            changes === undefined
              ? undefined
              : {
                  ...(changes.changed === undefined ? {} : { changed: changes.changed }),
                  ...(changes.created === undefined ? {} : { created: changes.created }),
                  ...(changes.deleted === undefined ? {} : { deleted: changes.deleted }),
                },
          ),
        catch: (cause) =>
          new TsAnalysisError({
            message: `Failed to refresh Quartz workspace for ${worktreePath}`,
            cause,
          }),
      })
    }

    const workspace = state.workspace
    if (workspace === undefined) {
      return yield* new TsAnalysisError({ message: `Quartz workspace was not opened for ${worktreePath}` })
    }
    const productionFiles =
      options?.productionOnly === true
        ? new Set(yield* listProductionTypeScriptFiles(worktreePath))
        : undefined
    const files = yield* collectOwnedFiles(
      worktreePath,
      workspace,
      packages,
      state.configBundle,
      productionFiles,
    )
    return {
      packages,
      analysis: makeAnalysis(workspace, files, state.configBundle),
    }
  })

const collectOwnedFiles = (
  worktreePath: string,
  workspace: QuartzWorkspace,
  packages: ReadonlyArray<PackageInfo>,
  bundle: AnalysisConfigBundle | undefined,
  productionFiles: ReadonlySet<string> | undefined,
): Effect.Effect<ReadonlyArray<TsFile>, TsAnalysisError> =>
  Effect.tryPromise({
    try: async () => {
      const candidates = new Map<string, Array<{ readonly projectId: string; readonly configPath: string }>>()
      const configByProjectId = new Map<string, string>()
      const derivedByOriginal = new Map(
        (bundle?.configs ?? []).map((config) => [canonicalPath(config.originalPath), config.derivedPath] as const),
      )

      for (const pkg of packages) {
        const projectId = projectIdForConfig(worktreePath, pkg.tsconfigPath)
        const derivedPath = derivedByOriginal.get(canonicalPath(pkg.tsconfigPath))
        if (derivedPath === undefined) continue
        configByProjectId.set(projectId, derivedPath)
        const names = await workspace.withProject(
          async (project) => [...await project.program.getSourceFileNames()],
          derivedPath,
        )
        for (const name of names) {
          const path = canonicalPath(name)
          if (!isAnalyzableTypeScriptPath(path)) continue
          if (shouldIgnoreSourcePath(path)) continue
          if (productionFiles !== undefined && !productionFiles.has(path)) continue
          const existing = candidates.get(path) ?? []
          existing.push({ projectId, configPath: pkg.tsconfigPath })
          candidates.set(path, existing)
        }
      }

      if (candidates.size === 0 && packages.length === 0) {
        const fallbackId = fallbackProjectId(worktreePath, packages)
        const derivedPath = bundle?.configs[0]?.derivedPath
        if (derivedPath !== undefined) {
          const names = await workspace.withProject(
            async (project) => [...await project.program.getSourceFileNames()],
            derivedPath,
          )
          for (const name of names) {
            const path = canonicalPath(name)
            if (!isAnalyzableTypeScriptPath(path)) continue
            if (shouldIgnoreSourcePath(path)) continue
            if (productionFiles !== undefined && !productionFiles.has(path)) continue
            candidates.set(path, [{ projectId: fallbackId, configPath: derivedPath }])
          }
          configByProjectId.set(fallbackId, derivedPath)
        }
      }

      const files: Array<TsFile> = []
      for (const [path, owners] of [...candidates.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        const owner = chooseOwningProject(path, owners)
        if (owner === undefined) continue
        files.push({
          path,
          relativePath: relativeWorktreePath(worktreePath, path),
          projectId: owner.projectId,
        })
      }
      void configByProjectId
      return files
    },
    catch: (cause) =>
      new TsAnalysisError({
        message: `Failed to enumerate TypeScript files in ${worktreePath}`,
        cause,
      }),
  })

const makeAnalysis = (
  workspace: QuartzWorkspace,
  files: ReadonlyArray<TsFile>,
  bundle: AnalysisConfigBundle | undefined,
): TsAnalysis => {
  const filesByProject = groupFilesByProject(files)
  const derivedByProject = derivedPathByProjectId(files, bundle)

  return {
    files,
    mapFiles: <A>(visit: (context: TsFileContext) => Promise<A>) =>
      Effect.tryPromise({
        try: async () => {
          const results: Array<A> = []
          for (const [projectId, projectFiles] of [...filesByProject.entries()].sort(([left], [right]) =>
            left.localeCompare(right),
          )) {
            const derivedPath = derivedByProject.get(projectId)
            const batch = await workspace.withProject(async (project) => {
              const sourceFiles = await Promise.all(
                projectFiles.map((file) => project.program.getSourceFile(file.path)),
              )
              const visited: Array<A> = []
              for (const [index, file] of projectFiles.entries()) {
                const sourceFile = sourceFiles[index]
                if (sourceFile === undefined) continue
                visited.push(await visit({ file, sourceFile, project }))
              }
              return visited
            }, derivedPath)
            results.push(...batch)
          }
          return results
        },
        catch: (cause) =>
          new TsAnalysisError({
            message: "Failed to analyze TypeScript files",
            cause,
          }),
      }),
    withProject: <A>(
      projectId: string,
      visit: (project: Project, projectFiles: ReadonlyArray<TsFile>) => Promise<A>,
    ) =>
      Effect.tryPromise({
        try: () =>
          workspace.withProject(
            (project) => visit(project, filesForProject(filesByProject, projectId)),
            derivedByProject.get(projectId),
          ),
        catch: (cause) =>
          new TsAnalysisError({
            message: `Failed to open TypeScript project ${projectId}`,
            cause,
          }),
      }),
  }
}

const groupFilesByProject = (
  files: ReadonlyArray<TsFile>,
): Map<string, ReadonlyArray<TsFile>> => {
  const grouped = new Map<string, Array<TsFile>>()
  for (const file of files) {
    const current = grouped.get(file.projectId) ?? []
    current.push(file)
    grouped.set(file.projectId, current)
  }
  return grouped
}

const filesForProject = (
  filesByProject: Map<string, ReadonlyArray<TsFile>>,
  projectId: string,
): ReadonlyArray<TsFile> => filesByProject.get(projectId) ?? []

const derivedPathByProjectId = (
  files: ReadonlyArray<TsFile>,
  bundle: AnalysisConfigBundle | undefined,
): ReadonlyMap<string, string> => {
  const byOriginal = new Map(
    (bundle?.configs ?? []).map((config) => [canonicalPath(config.originalPath), config.derivedPath] as const),
  )
  const result = new Map<string, string>()
  for (const file of files) {
    if (result.has(file.projectId)) continue
    const original = files.find((candidate) => candidate.projectId === file.projectId)
    void original
    const match = [...byOriginal.entries()].find(([originalPath]) =>
      projectIdMatchesOriginal(file.projectId, originalPath),
    )
    if (match !== undefined) result.set(file.projectId, match[1])
    else if (bundle?.configs[0] !== undefined) result.set(file.projectId, bundle.configs[0].derivedPath)
  }
  for (const config of bundle?.configs ?? []) {
    const projectId = relativeWorktreePathFromConfig(config.originalPath)
    if (!result.has(projectId)) result.set(projectId, config.derivedPath)
  }
  return result
}

const projectIdMatchesOriginal = (projectId: string, originalPath: string): boolean =>
  originalPath.endsWith(`/${projectId}`) || originalPath.endsWith(projectId)

const relativeWorktreePathFromConfig = (originalPath: string): string => {
  const parts = originalPath.replaceAll("\\", "/").split("/")
  const tsconfigIndex = parts.lastIndexOf("tsconfig.json")
  if (tsconfigIndex <= 0) return "tsconfig.json"
  return parts.slice(-2).join("/")
}

const replaceWorkspace = (state: SessionState): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (state.workspace !== undefined) {
      yield* Effect.promise(() => state.workspace!.close())
      state.workspace = undefined
    }
    yield* removeAnalysisConfigBundle(state.configBundle)
    state.configBundle = undefined
    state.configFingerprint = ""
  })
