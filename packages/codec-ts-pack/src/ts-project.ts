import { Context, Effect, Layer } from "effect"
import { simpleGit } from "simple-git"
import { Project } from "ts-morph"
import { discoverPackages, type PackageInfo } from "./discovery.js"

export interface TsProjectOptions {
  readonly productionOnly?: boolean
}

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
export class TsProjectTag extends Context.Tag("@taste-codec/ts-pack/TsProject")<
  TsProjectTag,
  Project
>() {}

export class TsPackageInfoTag extends Context.Tag(
  "@taste-codec/ts-pack/TsPackageInfo",
)<TsPackageInfoTag, ReadonlyArray<PackageInfo>>() {}

export const makeTsProject = (worktreePath: string): Effect.Effect<Project> =>
  Effect.gen(function* () {
    const packages = yield* discoverPackages(worktreePath)
    return buildMergedProject(worktreePath, packages)
  })

export const makeTsProjectWithOptions = (
  worktreePath: string,
  options?: TsProjectOptions,
): Effect.Effect<Project> =>
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
  const globs = [
    `${worktreePath}/**/*.{ts,tsx}`,
    `!${worktreePath}/**/.agents/**`,
    `!${worktreePath}/**/node_modules/**`,
    `!${worktreePath}/**/dist/**`,
    `!${worktreePath}/**/build/**`,
    `!${worktreePath}/**/.next/**`,
    `!${worktreePath}/**/.nuxt/**`,
    `!${worktreePath}/**/.output/**`,
    `!${worktreePath}/**/coverage/**`,
    `!${worktreePath}/**/.turbo/**`,
    `!${worktreePath}/**/.cache/**`,
    `!${worktreePath}/**/vendor/**`,
    `!${worktreePath}/**/gen/**`,
    `!${worktreePath}/**/*.gen.ts`,
    `!${worktreePath}/**/*.gen.tsx`,
    `!${worktreePath}/**/*.generated.ts`,
    `!${worktreePath}/**/*.generated.tsx`,
    `!${worktreePath}/**/sst-env.d.ts`,
  ]

  if (options?.productionOnly === true) {
    globs.push(
      `!${worktreePath}/**/*.test.ts`,
      `!${worktreePath}/**/*.test.tsx`,
      `!${worktreePath}/**/*.spec.ts`,
      `!${worktreePath}/**/*.spec.tsx`,
      `!${worktreePath}/**/*.stories.ts`,
      `!${worktreePath}/**/*.stories.tsx`,
      `!${worktreePath}/**/__tests__/**`,
      `!${worktreePath}/**/test/**`,
      `!${worktreePath}/**/tests/**`,
      `!${worktreePath}/**/test-support/**`,
      `!${worktreePath}/**/*test-support.ts`,
      `!${worktreePath}/**/*test-support.tsx`,
      `!${worktreePath}/**/*test-helpers.ts`,
      `!${worktreePath}/**/*test-helpers.tsx`,
      `!${worktreePath}/**/*test-mocks.ts`,
      `!${worktreePath}/**/*test-mocks.tsx`,
      `!${worktreePath}/**/*test-harness.ts`,
      `!${worktreePath}/**/*test-harness.tsx`,
      `!${worktreePath}/**/happydom.ts`,
    )
  }

  project.addSourceFilesAtPaths(globs)
  removeIgnoredSourceFiles(project)
}

const removeIgnoredSourceFiles = (project: Project): void => {
  for (const sourceFile of project.getSourceFiles()) {
    if (hasIgnoredPathSegment(sourceFile.getFilePath())) {
      project.removeSourceFile(sourceFile)
    }
  }
}

const hasIgnoredPathSegment = (filePath: string): boolean =>
  filePath.split(/[\\/]+/).includes(".agents")

const listProductionTypeScriptFiles = (
  worktreePath: string,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.tryPromise({
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
        .filter(isProductionTypeScriptFile)
        .map((file) => `${worktreePath}/${file}`)
    },
    catch: (cause) => new Error(String(cause)),
  }).pipe(Effect.orElseSucceed(() => []))

const isProductionTypeScriptFile = (file: string): boolean => {
  if (!(file.endsWith(".ts") || file.endsWith(".tsx"))) return false
  if (
    file.endsWith(".gen.ts") ||
    file.endsWith(".gen.tsx") ||
    file.endsWith(".generated.ts") ||
    file.endsWith(".generated.tsx") ||
    file.endsWith("sst-env.d.ts") ||
    file.endsWith("happydom.ts")
  ) {
    return false
  }

  if (
    file.endsWith(".test.ts") ||
    file.endsWith(".test.tsx") ||
    file.endsWith(".spec.ts") ||
    file.endsWith(".spec.tsx") ||
    file.endsWith(".stories.ts") ||
    file.endsWith(".stories.tsx") ||
    file.endsWith("test-support.ts") ||
    file.endsWith("test-support.tsx") ||
    file.endsWith("test-helpers.ts") ||
    file.endsWith("test-helpers.tsx") ||
    file.endsWith("test-mocks.ts") ||
    file.endsWith("test-mocks.tsx") ||
    file.endsWith("test-harness.ts") ||
    file.endsWith("test-harness.tsx")
  ) {
    return false
  }

  return ![
    "node_modules",
    "dist",
    "build",
    ".next",
    ".nuxt",
    ".output",
    "coverage",
    ".turbo",
    ".cache",
    ".agents",
    "vendor",
    "gen",
    "__tests__",
    "test",
    "tests",
    "test-support",
  ].some((segment) => file.split("/").includes(segment))
}

export const TsProjectLayer = (
  worktreePath: string,
  options?: TsProjectOptions,
): Layer.Layer<TsProjectTag | TsPackageInfoTag> =>
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
