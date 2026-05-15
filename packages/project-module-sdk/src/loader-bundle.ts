import { basename, dirname, resolve } from "node:path"
import { Effect } from "effect"
import { ProjectModuleLoadError } from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"
import { mkdirForProjectModuleDirectory } from "./loader-fs.js"
import { isFile, safeSourceFingerprintPath } from "./loader-paths.js"

interface BunBuildResult {
  readonly success: boolean
  readonly logs: ReadonlyArray<unknown>
}

interface BunRuntime {
  readonly build: (options: {
    readonly target: "bun"
    readonly format: "esm"
    readonly entrypoints: Array<string>
    readonly outdir: string
    readonly naming: string
    readonly packages: "bundle"
  }) => Promise<BunBuildResult>
}

export const bundleMaterializedProjectModule = (
  ref: ProjectModuleRef,
  importTarget: string,
  shadowSourceRoot: string,
  sourceFingerprint: string,
): Effect.Effect<string, ProjectModuleLoadError> =>
  Effect.gen(function* () {
    const bun = (globalThis as unknown as { readonly Bun?: BunRuntime }).Bun
    if (bun === undefined) return importTarget
    if (process.env.NODE_ENV === "test") return importTarget

    const outputPath = resolve(
      shadowSourceRoot,
      ".pulsar-bundle",
      `${safeSourceFingerprintPath(sourceFingerprint)}.js`,
    )
    if (yield* isFile(outputPath)) return outputPath

    yield* mkdirForProjectModuleDirectory(
      ref,
      dirname(outputPath),
      `Failed to create project module bundle directory`,
    )
    const result = yield* Effect.tryPromise({
      try: () =>
        bun.build({
          target: "bun",
          format: "esm",
          entrypoints: [importTarget],
          outdir: dirname(outputPath),
          naming: basename(outputPath),
          packages: "bundle",
        }),
      catch: (cause) =>
        new ProjectModuleLoadError({
          refId: ref.id,
          target: importTarget,
          message: `Failed to bundle project module ${ref.id}: ${formatBundleFailure(cause)}`,
          cause,
        }),
    })
    if (!result.success) {
      return yield* new ProjectModuleLoadError({
        refId: ref.id,
        target: importTarget,
        message: `Failed to bundle project module ${ref.id}: ${result.logs.map(String).join("; ")}`,
      })
    }
    return outputPath
  })

const formatBundleFailure = (cause: unknown): string => {
  if (cause instanceof AggregateError && cause.errors.length > 0) {
    return cause.errors.map(formatBundleFailure).join("; ")
  }
  if (cause instanceof Error && cause.message.length > 0) return cause.message
  return String(cause)
}
