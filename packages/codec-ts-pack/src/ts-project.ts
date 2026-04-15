import { existsSync } from "node:fs"
import { join } from "node:path"
import { Context, Effect, Layer } from "effect"
import { Project } from "ts-morph"

/**
 * A shared ts-morph Project per scoring run. The compiler is expensive
 * to construct — signals that need AST access pull this service rather
 * than instantiate their own.
 */
export class TsProjectTag extends Context.Tag("@taste-codec/ts-pack/TsProject")<
  TsProjectTag,
  Project
>() {}

export const makeTsProject = (worktreePath: string): Effect.Effect<Project> =>
  Effect.sync(() => {
    const tsConfigFilePath = findTsConfig(worktreePath)
    const project = new Project({
      skipAddingFilesFromTsConfig: false,
      skipFileDependencyResolution: true,
      skipLoadingLibFiles: true,
      ...(tsConfigFilePath !== undefined ? { tsConfigFilePath } : {}),
    })
    if (project.getSourceFiles().length === 0) {
      project.addSourceFilesAtPaths([
        `${worktreePath}/**/*.{ts,tsx}`,
        `!${worktreePath}/**/node_modules/**`,
        `!${worktreePath}/**/dist/**`,
        `!${worktreePath}/**/.turbo/**`,
      ])
    }
    return project
  })

const findTsConfig = (worktreePath: string): string | undefined => {
  const path = join(worktreePath, "tsconfig.json")
  return existsSync(path) ? path : undefined
}

export const TsProjectLayer = (worktreePath: string): Layer.Layer<TsProjectTag> =>
  Layer.effect(TsProjectTag, makeTsProject(worktreePath))
