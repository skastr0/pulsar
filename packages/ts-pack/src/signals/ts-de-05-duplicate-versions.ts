import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { findDuplicateGroups, type DuplicateGroup } from "./ts-de-05-groups.js"
import { readTsDe05Lockfile } from "./ts-de-05-lockfile.js"

const TsDe05Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
type TsDe05Config = typeof TsDe05Config.Type

interface TsDe05Output {
  readonly duplicates: ReadonlyArray<DuplicateGroup>
  readonly totalPackages: number
  readonly totalDuplicateInstances: number
  readonly diagnosticLimit: number
  readonly lockfileStatus: "bun" | "npm" | "pnpm" | "unsupported" | "missing"
  readonly lockfileFiles: ReadonlyArray<string>
}

const UNSUPPORTED_LOCKFILES = ["yarn.lock"] as const

export const TsDe05: Signal<TsDe05Config, TsDe05Output, SignalContextTag> = {
  id: "TS-DE-05-duplicate-dependency-versions",
  title: "Duplicate dependency versions",
  aliases: ["TS-DE-05"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: TsDe05Config,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      const result = yield* Effect.tryPromise({
        try: async (): Promise<TsDe05Output> => {
          const lockfile = await readTsDe05Lockfile(context.worktreePath)
          if (lockfile.kind === "missing" || lockfile.kind === "unsupported") {
            return {
              duplicates: [],
              totalPackages: 0,
              totalDuplicateInstances: 0,
              diagnosticLimit: config.top_n_diagnostics,
              lockfileStatus: lockfile.kind,
              lockfileFiles: lockfile.files,
            }
          }

          const resolvedPackages = lockfile.packages.filter(
            (pkg) => !pkg.version.startsWith("workspace:"),
          )
          const duplicates = findDuplicateGroups(resolvedPackages, lockfile.workspaces)

          return {
            duplicates,
            totalPackages: resolvedPackages.length,
            totalDuplicateInstances: duplicates.reduce((sum, group) => sum + group.instanceCount, 0),
            diagnosticLimit: config.top_n_diagnostics,
            lockfileStatus: lockfile.kind,
            lockfileFiles: [lockfile.path],
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-05-duplicate-dependency-versions",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.totalPackages === 0) return 1
    const directGroups = out.duplicates.filter(
      (group) => group.evidenceKind === "direct-workspace-duplicate",
    )
    const transitiveGroups = out.duplicates.filter(
      (group) => group.evidenceKind === "transitive-lockfile-duplicate",
    )
    const directInstanceCount = directGroups.reduce(
      (sum, group) => sum + group.directInstanceCount,
      0,
    )
    const transitiveInstanceCount = transitiveGroups.reduce(
      (sum, group) => sum + group.instanceCount,
      0,
    )
    const directGroupRatio = directGroups.length / out.totalPackages
    const directInstanceRatio = directInstanceCount / out.totalPackages
    const transitiveGroupRatio = transitiveGroups.length / out.totalPackages
    const transitiveInstanceRatio = transitiveInstanceCount / out.totalPackages
    const penalty =
      directGroupRatio * 2 +
      directInstanceRatio * 0.15 +
      transitiveGroupRatio * 0.35 +
      transitiveInstanceRatio * 0.03
    return Math.max(0, 1 - Math.min(1, penalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.lockfileStatus === "missing" || out.lockfileStatus === "unsupported") {
      return [{
        severity: "info" as const,
        message:
          out.lockfileStatus === "missing"
            ? "No supported lockfile found; duplicate-version analysis skipped"
            : `Lockfile format not yet supported: ${out.lockfileFiles.join(", ")}`,
        data: {
          lockfileStatus: out.lockfileStatus,
          files: out.lockfileFiles.slice(),
        },
      }]
    }

    return out.duplicates.slice(0, out.diagnosticLimit).map((group) => ({
      severity: group.evidenceKind === "direct-workspace-duplicate" ? "warn" as const : "info" as const,
      message:
        group.evidenceKind === "direct-workspace-duplicate"
          ? `Duplicate direct dependency versions for ${group.name}: ` +
            `${group.directVersions.join(", ")} (${group.directInstanceCount} direct instances; ` +
            `${group.instanceCount} total instances)`
          : `Duplicate transitive dependency versions for ${group.name}: ` +
            `${group.versions.join(", ")} (${group.instanceCount} lockfile instances)`,
      data: {
        name: group.name,
        versions: group.versions.slice(),
        directVersions: group.directVersions.slice(),
        instanceCount: group.instanceCount,
        directInstanceCount: group.directInstanceCount,
        evidenceKind: group.evidenceKind,
        pullInChains: group.pullInChains.map((chain) => ({
          version: chain.version,
          chain: chain.chain.slice(),
        })),
      },
    }))
  },
}
