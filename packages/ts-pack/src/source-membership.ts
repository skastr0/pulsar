import { access } from "node:fs/promises"
import { dirname, relative, resolve } from "node:path"
import { isProductionSourcePath } from "@skastr0/pulsar-core/signal"
import type { CalibrationProcessorError } from "@skastr0/pulsar-core/calibration"
import { Effect } from "effect"
import { simpleGit } from "simple-git"
import type { PackageInfo } from "./discovery.js"

export interface TsProjectOptions {
  readonly productionOnly?: boolean
}

const GENERATED_TYPE_SCRIPT_SUFFIXES = [
  ".gen.ts",
  ".gen.tsx",
  ".generated.ts",
  ".generated.tsx",
  "sst-env.d.ts",
  "happydom.ts",
] as const

const TEST_TYPE_SCRIPT_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".spec.ts",
  ".spec.tsx",
  ".stories.ts",
  ".stories.tsx",
  "test-support.ts",
  "test-support.tsx",
  "test-utils.ts",
  "test-utils.tsx",
  "test-helpers.ts",
  "test-helpers.tsx",
  "test-mocks.ts",
  "test-mocks.tsx",
  "test-harness.ts",
  "test-harness.tsx",
] as const

const NON_PRODUCTION_PATH_SEGMENTS = [
  "node_modules",
  "dist",
  "build",
  ".next",
  ".nuxt",
  ".output",
  "coverage",
  ".turbo",
  ".cache",
  "vendor",
  "gen",
  "_generated",
  "__tests__",
  "test",
  "tests",
  "test-support",
  "test-utils",
] as const

const ANALYZABLE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"] as const

export const canonicalPath = (path: string): string => resolve(path).replaceAll("\\", "/")

export const relativeWorktreePath = (worktreePath: string, path: string): string =>
  relative(canonicalPath(worktreePath), canonicalPath(path)).replaceAll("\\", "/")

export const isAnalyzableTypeScriptPath = (path: string): boolean => {
  const normalized = path.replaceAll("\\", "/")
  return ANALYZABLE_EXTENSIONS.some((extension) => normalized.endsWith(extension))
}

export const shouldIgnoreSourcePath = (path: string): boolean => {
  if (isHiddenToolEntrypoint(path)) return false
  return path.split(/[\\/]+/).some((segment) => isHiddenPathSegment(segment) || segment === "_generated")
}

export const listProductionTypeScriptFiles = (
  worktreePath: string,
): Effect.Effect<ReadonlyArray<string>, CalibrationProcessorError> =>
  Effect.gen(function* () {
    const files = yield* Effect.tryPromise({
      try: async () => {
        const raw = await simpleGit(worktreePath).raw([
          "ls-files",
          "--cached",
          "--others",
          "--exclude-standard",
        ])
        return raw
          .split("\n")
          .map((file) => file.trim())
          .filter((file) => file.length > 0)
      },
      catch: (cause) => new Error(String(cause)),
    }).pipe(Effect.orElseSucceed(() => [] as Array<string>))
    const existingFiles = yield* Effect.filter(files, (file) =>
      Effect.promise(() => fileExists(`${worktreePath}/${file}`)),
    )
    const isProductionSource = makeProductionSourcePathClassifier()
    const productionFiles = yield* Effect.filter(
      existingFiles.filter(isProductionTypeScriptFile),
      isProductionSource,
    )
    return productionFiles.map((file) => canonicalPath(`${worktreePath}/${file}`))
  })

export const chooseOwningProject = (
  filePath: string,
  candidates: ReadonlyArray<{ readonly projectId: string; readonly configPath: string }>,
): { readonly projectId: string; readonly configPath: string } | undefined => {
  if (candidates.length === 0) return undefined
  const ranked = [...candidates].sort((left, right) => {
    const depthDelta = configDepth(right.configPath) - configDepth(left.configPath)
    if (depthDelta !== 0) return depthDelta
    return left.projectId.localeCompare(right.projectId)
  })
  void filePath
  return ranked[0]
}

export const projectIdForConfig = (worktreePath: string, configPath: string): string =>
  relativeWorktreePath(worktreePath, configPath)

export const fallbackProjectId = (worktreePath: string, packages: ReadonlyArray<PackageInfo>): string => {
  const rootPackage = packages.find((pkg) => canonicalPath(pkg.path) === canonicalPath(worktreePath))
  if (rootPackage !== undefined) return projectIdForConfig(worktreePath, rootPackage.tsconfigPath)
  return "<worktree>"
}

const makeProductionSourcePathClassifier = (): ((
  file: string,
) => Effect.Effect<boolean, CalibrationProcessorError, never>) => {
  const cache = new Map<string, boolean>()
  return (file) => {
    if (cache.has(file)) return Effect.succeed(cache.get(file)!)
    return isProductionSourcePath(file, { sourceExtensions: [".ts", ".tsx"] }).pipe(
      Effect.tap((isProduction) =>
        Effect.sync(() => {
          cache.set(file, isProduction)
        }),
      ),
    )
  }
}

const isProductionTypeScriptFile = (file: string): boolean => {
  if (!(file.endsWith(".ts") || file.endsWith(".tsx"))) return false
  if (hasProductionExcludedSuffix(file)) return false
  return !hasProductionExcludedPath(file)
}

const fileExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const hasProductionExcludedSuffix = (file: string): boolean =>
  GENERATED_TYPE_SCRIPT_SUFFIXES.some((suffix) => file.endsWith(suffix)) ||
  TEST_TYPE_SCRIPT_SUFFIXES.some((suffix) => file.endsWith(suffix))

const hasProductionExcludedPath = (file: string): boolean => {
  const segments = file.split("/")
  return (
    NON_PRODUCTION_PATH_SEGMENTS.some((segment) => segments.includes(segment)) ||
    segments.some(isHiddenPathSegment)
  )
}

const isHiddenPathSegment = (segment: string): boolean =>
  segment.startsWith(".") && segment.length > 1

const isHiddenToolEntrypoint = (path: string): boolean => {
  const normalized = path.replace(/\\/g, "/")
  return /\/\.pi\/extensions\/[^/]+\.[cm]?tsx?$/u.test(normalized)
}

const configDepth = (configPath: string): number =>
  dirname(canonicalPath(configPath)).split("/").filter((segment) => segment.length > 0).length
