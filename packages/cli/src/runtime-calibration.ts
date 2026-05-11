import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import {
  makeResolvedCalibrationContext,
  type RepoFacts,
  type ResolvedCalibrationContext,
} from "@skastr0/pulsar-core/calibration"
import {
  decodeProjectModuleManifest,
  fingerprintProjectModuleManifest,
  loadEnabledProjectModules,
} from "@skastr0/pulsar-project-module-sdk"
import { Effect } from "effect"

export const loadProjectModuleCalibrationContext = (
  repoRoot: string,
  options?: { readonly dependencyRoot?: string },
): Effect.Effect<ResolvedCalibrationContext | undefined, unknown, never> =>
  Effect.gen(function* () {
    const manifestPath = join(repoRoot, ".pulsar", "project-modules.json")
    if (!existsSync(manifestPath)) return undefined

    const raw = yield* Effect.tryPromise({
      try: () => readFile(manifestPath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read project module manifest at ${manifestPath}: ${String(cause)}`),
    })
    const parsed = yield* Effect.try({
      try: () => JSON.parse(raw),
      catch: (cause) =>
        new Error(`Failed to parse project module manifest JSON at ${manifestPath}: ${String(cause)}`),
    })
    const manifest = yield* decodeProjectModuleManifest(parsed)
    const loadedModules = yield* loadEnabledProjectModules(manifest, {
      repoRoot,
      ...(options?.dependencyRoot !== undefined ? { dependencyRoot: options.dependencyRoot } : {}),
    })
    const manifestFingerprint = fingerprintProjectModuleManifest(manifest)
    const repoFacts: RepoFacts = {
      repoRoot,
      fingerprint: `project-modules:${manifestFingerprint}`,
      detectedTechnologies: [],
      sourceExtensions: [],
      metadata: {
        manifestPath,
        manifestFingerprint,
        declaredModuleCount: manifest.modules.length,
        activeModuleCount: loadedModules.length,
      },
    }

    return makeResolvedCalibrationContext({
      repoFacts,
      activeModules: loadedModules.map((module) => module.activeModule),
      processors: loadedModules.flatMap((module) => module.processors),
    })
  })
