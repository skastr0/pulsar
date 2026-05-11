import { Context, Effect, Layer } from "effect"
import { simpleGit } from "simple-git"
import { Project } from "ts-morph"
import {
  isProductionSourcePath,
  type CalibrationProcessorError,
} from "@skastr0/pulsar-core"
import { discoverPackages, type PackageInfo } from "./discovery.js"

export interface TsProjectOptions {
  readonly productionOnly?: boolean
}

const BASE_WORKTREE_GLOB_PATTERNS = [
  "**/*.{ts,tsx}",
  "!**/.*/**",
  "!**/node_modules/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.next/**",
  "!**/.nuxt/**",
  "!**/.output/**",
  "!**/coverage/**",
  "!**/.turbo/**",
  "!**/.cache/**",
  "!**/vendor/**",
  "!**/gen/**",
  "!**/_generated/**",
  "!**/*.gen.ts",
  "!**/*.gen.tsx",
  "!**/*.generated.ts",
  "!**/*.generated.tsx",
  "!**/sst-env.d.ts",
] as const

const PRODUCTION_WORKTREE_GLOB_PATTERNS = [
  "!**/*.test.ts",
  "!**/*.test.tsx",
  "!**/*.spec.ts",
  "!**/*.spec.tsx",
  "!**/*.stories.ts",
  "!**/*.stories.tsx",
  "!**/__tests__/**",
  "!**/test/**",
  "!**/tests/**",
  "!**/test-support/**",
  "!**/test-utils/**",
  "!**/*test-support.ts",
  "!**/*test-support.tsx",
  "!**/*test-utils.ts",
  "!**/*test-utils.tsx",
  "!**/*test-helpers.ts",
  "!**/*test-helpers.tsx",
  "!**/*test-mocks.ts",
  "!**/*test-mocks.tsx",
  "!**/*test-harness.ts",
  "!**/*test-harness.tsx",
  "!**/happydom.ts",
] as const

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

/**
 * A shared ts-morph Project per scoring run. The compiler is expensive
 * to construct — signals that need AST access pull this service rather
 * than instantiate their own.
 *
 * Monorepo handling: we discover every tsconfig in the worktree, then
 * merge source files across them into a single Project. Discovery uses
 * `git ls-files` with a filesystem-walk fallback, respecting .gitignore
 * in the common case.
 *
 * Why merge instead of one Project per tsconfig: TC-020 exists to fix
 * correctness (missing source files under sub-tsconfigs) without changing
 * the shape consumed by existing signals. A merged Project sacrifices
 * per-tsconfig compilerOptions fidelity, which does not matter for
 * syntactic Phase-1 signals (cyclomatic complexity, token walks). The
 * richer shape — one Project per tsconfig, lifecycle-managed — belongs
 * to TC-017's scoring engine.
 */
export class TsProjectTag extends Context.Tag("@skastr0/pulsar-ts-pack/TsProject")<
  TsProjectTag,
  Project
>() {}

export class TsPackageInfoTag extends Context.Tag(
  "@skastr0/pulsar-ts-pack/TsPackageInfo",
)<TsPackageInfoTag, ReadonlyArray<PackageInfo>>() {}

export const makeTsProject = (worktreePath: string): Effect.Effect<Project> =>
  Effect.gen(function* () {
    const packages = yield* discoverPackages(worktreePath)
    return buildMergedProject(worktreePath, packages)
  })

export const makeTsProjectWithOptions = (
  worktreePath: string,
  options?: TsProjectOptions,
): Effect.Effect<Project, CalibrationProcessorError> =>
  Effect.gen(function* () {
    const packages = yield* discoverPackages(worktreePath)
    const currentSourceFiles =
      options?.productionOnly === true
        ? yield* listProductionTypeScriptFiles(worktreePath)
        : undefined
    return buildMergedProject(worktreePath, packages, options, currentSourceFiles)
  })

const buildMergedProject = (
  worktreePath: string,
  packages: ReadonlyArray<PackageInfo>,
  options?: TsProjectOptions,
  sourceFilePaths?: ReadonlyArray<string>,
): Project => {
  if (options?.productionOnly === true) {
    return buildUntypedProject(worktreePath, options, sourceFilePaths)
  }
  if (packages.length === 0) {
    return buildUntypedProject(worktreePath, options, sourceFilePaths)
  }
  // Seed with the first tsconfig so we get sane default compiler options
  // (target, module, etc.). Additional tsconfigs contribute their source
  // files; their compilerOptions are intentionally dropped.
  const [seed, ...rest] = packages
  const project = new Project({
    skipAddingFilesFromTsConfig: false,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
    tsConfigFilePath: seed!.tsconfigPath,
  })
  for (const pkg of rest) {
    project.addSourceFilesFromTsConfig(pkg.tsconfigPath)
  }
  if (project.getSourceFiles().length === 0) {
    addWorktreeGlob(project, worktreePath, options)
  }
  removeIgnoredSourceFiles(project)
  return project
}

const buildUntypedProject = (
  worktreePath: string,
  options?: TsProjectOptions,
  sourceFilePaths?: ReadonlyArray<string>,
): Project => {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  })
  addSourceFiles(project, worktreePath, options, sourceFilePaths)
  return project
}

const addSourceFiles = (
  project: Project,
  worktreePath: string,
  options?: TsProjectOptions,
  sourceFilePaths?: ReadonlyArray<string>,
): void => {
  if (sourceFilePaths !== undefined && sourceFilePaths.length > 0) {
    for (const sourceFilePath of sourceFilePaths) {
      project.addSourceFileAtPathIfExists(sourceFilePath)
    }
    return
  }
  addWorktreeGlob(project, worktreePath, options)
}

const addWorktreeGlob = (project: Project, worktreePath: string, options?: TsProjectOptions): void => {
  project.addSourceFilesAtPaths(worktreeGlobPatterns(worktreePath, options?.productionOnly === true))
  removeIgnoredSourceFiles(project)
}

const worktreeGlobPatterns = (
  worktreePath: string,
  productionOnly: boolean,
): ReadonlyArray<string> => [
  ...BASE_WORKTREE_GLOB_PATTERNS.map((pattern) => withWorktreePrefix(worktreePath, pattern)),
  ...(productionOnly
    ? PRODUCTION_WORKTREE_GLOB_PATTERNS.map((pattern) => withWorktreePrefix(worktreePath, pattern))
    : []),
]

const withWorktreePrefix = (worktreePath: string, pattern: string): string =>
  pattern.startsWith("!") ? `!${worktreePath}/${pattern.slice(1)}` : `${worktreePath}/${pattern}`

const removeIgnoredSourceFiles = (project: Project): void => {
  for (const sourceFile of project.getSourceFiles()) {
    if (hasIgnoredPathSegment(sourceFile.getFilePath()) && !isHiddenToolEntrypoint(sourceFile.getFilePath())) {
      project.removeSourceFile(sourceFile)
    }
  }
}

const hasIgnoredPathSegment = (filePath: string): boolean =>
  filePath.split(/[\\/]+/).some((segment) =>
    isHiddenPathSegment(segment) || segment === "_generated"
  )

const listProductionTypeScriptFiles = (
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
    }).pipe(Effect.orElseSucceed(() => []))
    const isProductionSource = makeProductionSourcePathClassifier()
    const productionFiles = yield* Effect.filter(
      files.filter(isProductionTypeScriptFile),
      isProductionSource,
    )
    return productionFiles.map((file) => `${worktreePath}/${file}`)
  })

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
  return /\/\.opencode\/tools?\/[^/]+\.[cm]?tsx?$/u.test(normalized) ||
    /\/\.opencode\/plugins\/[^/]+\.[cm]?tsx?$/u.test(normalized) ||
    /\/\.pi\/extensions\/[^/]+\.[cm]?tsx?$/u.test(normalized)
}

export const TsProjectLayer = (
  worktreePath: string,
  options?: TsProjectOptions,
): Layer.Layer<TsProjectTag | TsPackageInfoTag, CalibrationProcessorError> =>
  Layer.unwrapEffect(
    Effect.gen(function* () {
      const packages = yield* discoverPackages(worktreePath)
      const currentSourceFiles =
        options?.productionOnly === true
          ? yield* listProductionTypeScriptFiles(worktreePath)
          : undefined
      return Layer.mergeAll(
        Layer.succeed(TsProjectTag, buildMergedProject(worktreePath, packages, options, currentSourceFiles)),
        Layer.succeed(TsPackageInfoTag, packages),
      )
    }),
  )

export const TsPackageInfoLayer = (
  worktreePath: string,
): Layer.Layer<TsPackageInfoTag> =>
  Layer.effect(TsPackageInfoTag, discoverPackages(worktreePath))
