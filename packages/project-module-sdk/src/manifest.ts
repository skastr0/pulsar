import { Effect, Schema } from "effect"
import { hashCalibrationValue } from "@skastr0/pulsar-core/calibration"

const NonEmptyString = Schema.String.pipe(Schema.check(Schema.isPattern(/.+/)))

export const ProjectModuleRefConfig = Schema.Record(
  Schema.String,
  Schema.Unknown,
)
export type ProjectModuleRefConfig = typeof ProjectModuleRefConfig.Type

const ProjectModuleRefBase = Schema.Struct({
  id: NonEmptyString,
  enabled: Schema.Boolean.pipe(
    Schema.withDecodingDefaultType(Effect.succeed(true)),
  ),
  exportName: Schema.optional(NonEmptyString),
  config: Schema.optional(ProjectModuleRefConfig),
})

export const RepoLocalProjectModuleRef = ProjectModuleRefBase.pipe(
  Schema.fieldsAssign({
    kind: Schema.Literal("repo-local"),
    path: NonEmptyString,
  }),
)
export type RepoLocalProjectModuleRef = typeof RepoLocalProjectModuleRef.Type

export const WorkspaceProjectModuleRef = ProjectModuleRefBase.pipe(
  Schema.fieldsAssign({
    kind: Schema.Literal("workspace"),
    packageName: NonEmptyString,
  }),
)
export type WorkspaceProjectModuleRef = typeof WorkspaceProjectModuleRef.Type

export const PackageProjectModuleRef = ProjectModuleRefBase.pipe(
  Schema.fieldsAssign({
    kind: Schema.Literal("package"),
    packageName: NonEmptyString,
    version: Schema.optional(NonEmptyString),
  }),
)
export type PackageProjectModuleRef = typeof PackageProjectModuleRef.Type

export const BuiltinProjectModuleRef = ProjectModuleRefBase.pipe(
  Schema.fieldsAssign({
    kind: Schema.Literal("builtin"),
  }),
)
export type BuiltinProjectModuleRef = typeof BuiltinProjectModuleRef.Type

export const ProjectModuleRef = Schema.Union([
  BuiltinProjectModuleRef,
  RepoLocalProjectModuleRef,
  WorkspaceProjectModuleRef,
  PackageProjectModuleRef,
])
export type ProjectModuleRef = typeof ProjectModuleRef.Type

export const ProjectModuleManifest = Schema.Struct({
  schema: Schema.Literal("pulsar/project-modules/v1").pipe(
    Schema.withDecodingDefaultType(Effect.succeed("pulsar/project-modules/v1")),
  ),
  modules: Schema.Array(ProjectModuleRef),
})
export type ProjectModuleManifest = typeof ProjectModuleManifest.Type

export const decodeProjectModuleManifest =
  Schema.decodeUnknownEffect(ProjectModuleManifest)

export const fingerprintProjectModuleManifest = (
  manifest: ProjectModuleManifest,
): string =>
  hashCalibrationValue({
    schema: manifest.schema,
    modules: normalizeProjectModuleRefs(manifest.modules),
  })

const normalizeProjectModuleRefs = (
  refs: ReadonlyArray<ProjectModuleRef>,
): ReadonlyArray<ProjectModuleRef> =>
  [...refs].sort((left, right) =>
    left.id.localeCompare(right.id) ||
    left.kind.localeCompare(right.kind) ||
    moduleRefTarget(left).localeCompare(moduleRefTarget(right)),
  )

const moduleRefTarget = (ref: ProjectModuleRef): string => {
  switch (ref.kind) {
    case "builtin":
      return ref.id
    case "repo-local":
      return ref.path
    case "workspace":
    case "package":
      return ref.packageName
  }
}
