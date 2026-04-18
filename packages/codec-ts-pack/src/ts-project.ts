import { Context, Effect, Layer } from "effect"
import { Project } from "ts-morph"
import { discoverPackages, type PackageInfo } from "./discovery.js"

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

const buildMergedProject = (
  worktreePath: string,
  packages: ReadonlyArray<PackageInfo>,
): Project => {
  if (packages.length === 0) {
    return buildUntypedProject(worktreePath)
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
    addWorktreeGlob(project, worktreePath)
  }
  return project
}

const buildUntypedProject = (worktreePath: string): Project => {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  })
  addWorktreeGlob(project, worktreePath)
  return project
}

const addWorktreeGlob = (project: Project, worktreePath: string): void => {
  project.addSourceFilesAtPaths([
    `${worktreePath}/**/*.{ts,tsx}`,
    `!${worktreePath}/**/node_modules/**`,
    `!${worktreePath}/**/dist/**`,
    `!${worktreePath}/**/.turbo/**`,
  ])
}

export const TsProjectLayer = (worktreePath: string): Layer.Layer<TsProjectTag> =>
  Layer.effect(TsProjectTag, makeTsProject(worktreePath))

export const TsPackageInfoLayer = (
  worktreePath: string,
): Layer.Layer<TsPackageInfoTag> =>
  Layer.effect(TsPackageInfoTag, discoverPackages(worktreePath))
