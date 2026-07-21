import cliManifest from "../package.json" with { type: "json" }

declare const __PULSAR_BUILD_COMMIT__: string | undefined
declare const __PULSAR_BUILD_DIRTY__: boolean | undefined
declare const __PULSAR_BUILD_TARGET__: string | undefined
declare const __PULSAR_ARTIFACT_KIND__: "native" | undefined

export const CLI_VERSION = cliManifest.version

export interface CliBuildInfo {
  readonly schema_version: "pulsar/build-info/v1"
  readonly version: string
  readonly commit: string
  readonly dirty: boolean | null
  readonly artifact: "source" | "native"
  readonly distribution: "source" | "native" | "npm"
  readonly target: string
}

const embeddedCommit =
  typeof __PULSAR_BUILD_COMMIT__ === "undefined" ? undefined : __PULSAR_BUILD_COMMIT__
const embeddedDirty =
  typeof __PULSAR_BUILD_DIRTY__ === "undefined" ? undefined : __PULSAR_BUILD_DIRTY__
const embeddedTarget =
  typeof __PULSAR_BUILD_TARGET__ === "undefined" ? undefined : __PULSAR_BUILD_TARGET__
const embeddedArtifact =
  typeof __PULSAR_ARTIFACT_KIND__ === "undefined" ? undefined : __PULSAR_ARTIFACT_KIND__

const artifact = embeddedArtifact ?? "source"
const requestedDistribution = process.env.PULSAR_DISTRIBUTION
const distribution =
  artifact === "native" && requestedDistribution === "npm" ? "npm" : artifact
const sourceDirty = process.env.PULSAR_SOURCE_DIRTY

export const CLI_BUILD_INFO: CliBuildInfo = Object.freeze({
  schema_version: "pulsar/build-info/v1",
  version: CLI_VERSION,
  commit: embeddedCommit ?? process.env.PULSAR_SOURCE_COMMIT ?? "unknown",
  dirty:
    embeddedDirty ??
    (sourceDirty === "true" ? true : sourceDirty === "false" ? false : null),
  artifact,
  distribution,
  target: embeddedTarget ?? `${process.platform}-${process.arch}`,
})
