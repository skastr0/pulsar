import { Effect } from "effect"
import {
  activateProjectModule,
  type ProjectModuleDescriptor,
} from "@skastr0/pulsar-core/calibration"
import type { DefinedProjectModule } from "./definition.js"
import { validateLoadedProjectModule } from "./loader-validation.js"
import type { ProjectModuleManifest, ProjectModuleRef } from "./manifest.js"
import {
  ProjectModuleLoadError,
  type ProjectModuleLoadOptions,
} from "./loader-types.js"
import {
  resolveProjectModuleRefTarget,
  type ResolvedProjectModuleTarget,
} from "./loader-resolution.js"

export const loadProjectModuleRef = (
  ref: ProjectModuleRef,
  options: ProjectModuleLoadOptions,
): Effect.Effect<DefinedProjectModule, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    if (ref.kind === "builtin") {
      return yield* loadBuiltinProjectModuleRef(ref, options)
    }

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

    const module = yield* validateLoadedProjectModule(ref, target, value)
    return withLoadedProjectModuleSourceIdentity(module, resolvedTarget)
  })

export const loadEnabledProjectModules = (
  manifest: ProjectModuleManifest,
  options: ProjectModuleLoadOptions,
): Effect.Effect<ReadonlyArray<DefinedProjectModule>, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const ids = new Set<string>()
    for (const ref of manifest.modules) {
      if (ids.has(ref.id)) {
        return yield* new ProjectModuleLoadError({
          refId: ref.id, target: ref.id, message: `Duplicate project module ref ${ref.id}`,
        })
      }
      ids.add(ref.id)
    }
    return yield* Effect.forEach(
      manifest.modules.filter((ref) => ref.enabled),
      (ref) => loadProjectModuleRef(ref, options),
      { concurrency: 4 },
    )
  })

const loadBuiltinProjectModuleRef = (
  ref: ProjectModuleRef & { readonly kind: "builtin" },
  options: ProjectModuleLoadOptions,
): Effect.Effect<DefinedProjectModule, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const module = options.builtinModules?.get(ref.id)
    if (module === undefined) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target: ref.id,
        message: `Unknown builtin project module ${ref.id}`,
      })
    }

    const validated = yield* validateLoadedProjectModule(ref, ref.id, module)
    const descriptor: ProjectModuleDescriptor = {
      ...validated.descriptor,
      source: "builtin",
      sourceRef: ref.id,
    }
    return {
      descriptor,
      activeModule: activateProjectModule(descriptor),
      processors: validated.processors,
    }
  })

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
