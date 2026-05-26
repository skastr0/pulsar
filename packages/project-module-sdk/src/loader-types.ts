import { Schema } from "effect"
import type { DefinedProjectModule } from "./definition.js"

export class ProjectModuleLoadError extends Schema.TaggedError<ProjectModuleLoadError>()(
  "ProjectModuleLoadError",
  {
    refId: Schema.String,
    target: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export interface ProjectModuleLoadOptions {
  readonly repoRoot: string
  readonly dependencyRoot?: string
  readonly builtinModules?: ReadonlyMap<string, DefinedProjectModule>
}
