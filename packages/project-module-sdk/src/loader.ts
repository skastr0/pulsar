import { Effect } from "effect"
import {
  activateProjectModule,
  type ProjectModuleDescriptor,
} from "@skastr0/pulsar-core/calibration"
import {
  defineProjectModule,
  isDefinedProjectModule,
  isProjectModuleDefinitionInput,
  type DefinedProjectModule,
} from "./definition.js"
import type { ProjectModuleManifest, ProjectModuleRef } from "./manifest.js"
import {
  ProjectModuleLoadError,
  type ProjectModuleLoadOptions,
} from "./loader-types.js"
import {
  resolveProjectModuleRefTarget,
  type ResolvedProjectModuleTarget,
} from "./loader-resolution.js"

export { ProjectModuleLoadError, type ProjectModuleLoadOptions } from "./loader-types.js"

export const projectModuleRefTarget = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.map(resolveProjectModuleRefTarget(ref, options), (target) => target.target)

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
