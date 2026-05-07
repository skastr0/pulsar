import { access } from "node:fs/promises"
import { join } from "node:path"
import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { readBunLockFile, type BunResolvedPackage } from "../lockfiles/bun-lock.js"
import { readNpmLockFile, type NpmResolvedPackage } from "../lockfiles/npm-lock.js"
import { readPnpmLockFile, type PnpmResolvedPackage } from "../lockfiles/pnpm-lock.js"

export const TsDe05Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
export type TsDe05Config = typeof TsDe05Config.Type

export interface DuplicateGroup {
  readonly name: string
  readonly versions: ReadonlyArray<string>
  readonly directVersions: ReadonlyArray<string>
  readonly instanceCount: number
  readonly directInstanceCount: number
  readonly evidenceKind: "direct-workspace-duplicate" | "transitive-lockfile-duplicate"
  readonly pullInChains: ReadonlyArray<{ version: string; chain: ReadonlyArray<string> }>
}

export interface TsDe05Output {
  readonly duplicates: ReadonlyArray<DuplicateGroup>
  readonly totalPackages: number
  readonly totalDuplicateInstances: number
  readonly diagnosticLimit: number
  readonly lockfileStatus: "bun" | "npm" | "pnpm" | "unsupported" | "missing"
  readonly lockfileFiles: ReadonlyArray<string>
}

const UNSUPPORTED_LOCKFILES = ["yarn.lock"] as const

export const TsDe05: Signal<TsDe05Config, TsDe05Output, SignalContextTag> = {
  id: "TS-DE-05",
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
          const lockfile = await resolveLockfile(context.worktreePath)
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

          const parsed = lockfile.kind === "bun"
            ? await readBunLockFile(lockfile.path)
            : lockfile.kind === "npm"
              ? await readNpmLockFile(lockfile.path)
              : await readPnpmLockFile(lockfile.path)
          const resolvedPackages = parsed.packages.filter(
            (pkg) => !pkg.version.startsWith("workspace:"),
          )
          const byName = new Map<string, Array<ResolvedLockPackage>>()
          for (const pkg of resolvedPackages) {
            const bucket = byName.get(pkg.name) ?? []
            bucket.push(pkg)
            byName.set(pkg.name, bucket)
          }

          const duplicates = [...byName.entries()]
            .map(([name, packages]) => toDuplicateGroup(name, packages, parsed.workspaces))
            .filter((group) => group.versions.length > 1)
            .sort(compareDuplicateGroups)

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
            signalId: "TS-DE-05",
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

const resolveLockfile = async (
  worktreePath: string,
): Promise<
  | { readonly kind: "bun"; readonly path: string }
  | { readonly kind: "npm"; readonly path: string }
  | { readonly kind: "pnpm"; readonly path: string }
  | { readonly kind: "unsupported"; readonly files: ReadonlyArray<string> }
  | { readonly kind: "missing"; readonly files: ReadonlyArray<string> }
> => {
  const bunLockPath = join(worktreePath, "bun.lock")
  if (await exists(bunLockPath)) {
    return { kind: "bun", path: bunLockPath }
  }

  const npmLockPath = join(worktreePath, "package-lock.json")
  if (await exists(npmLockPath)) {
    return { kind: "npm", path: npmLockPath }
  }

  const pnpmLockPath = join(worktreePath, "pnpm-lock.yaml")
  if (await exists(pnpmLockPath)) {
    return { kind: "pnpm", path: pnpmLockPath }
  }

  const unsupported = (
    await Promise.all(
      UNSUPPORTED_LOCKFILES.map(async (filename) => ((await exists(join(worktreePath, filename))) ? filename : undefined)),
    )
  ).reduce<Array<string>>((acc, filename) => {
    if (filename !== undefined) {
      acc.push(filename)
    }
    return acc
  }, [])

  if (unsupported.length > 0) {
    return { kind: "unsupported", files: unsupported }
  }

  return { kind: "missing", files: [] }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

type ResolvedLockPackage = BunResolvedPackage | NpmResolvedPackage | PnpmResolvedPackage

interface LockWorkspace {
  readonly path: string
  readonly name: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
}

const toDuplicateGroup = (
  name: string,
  packages: ReadonlyArray<ResolvedLockPackage>,
  workspaces: ReadonlyArray<LockWorkspace>,
): DuplicateGroup => {
  const versions = [...new Set(packages.map((pkg) => pkg.version))].sort((left, right) =>
    left.localeCompare(right),
  )
  const directPackages = packages.filter((pkg) =>
    isDirectWorkspacePackageRequest(pkg, workspaces),
  )
  const directVersions = [...new Set(directPackages.map((pkg) => pkg.version))].sort(
    (left, right) => left.localeCompare(right),
  )
  const pullInChains = packages
    .flatMap((pkg) => workspaceChainsForPackage(pkg, workspaces))
    .filter((entry, index, entries) => {
      const key = `${entry.version}:${entry.chain.join(">")}`
      return entries.findIndex((candidate) => `${candidate.version}:${candidate.chain.join(">")}` === key) === index
    })
    .sort((left, right) => {
      const versionCompare = left.version.localeCompare(right.version)
      if (versionCompare !== 0) return versionCompare
      return left.chain.join("/").localeCompare(right.chain.join("/"))
    })

  return {
    name,
    versions,
    directVersions,
    instanceCount: packages.length,
    directInstanceCount: directPackages.length,
    evidenceKind:
      directVersions.length > 1
        ? "direct-workspace-duplicate"
        : "transitive-lockfile-duplicate",
    pullInChains,
  }
}

const isDirectWorkspacePackageRequest = (
  pkg: ResolvedLockPackage,
  workspaces: ReadonlyArray<LockWorkspace>,
): boolean => {
  if ("direct" in pkg) return pkg.direct
  const root = pkg.chain[0] ?? pkg.lockKey
  if (root !== pkg.name && !root.startsWith(`${pkg.name}@`)) return false
  return workspaces.some((workspace) =>
    [
      workspace.dependencies,
      workspace.devDependencies,
      workspace.peerDependencies,
      workspace.optionalDependencies,
    ].some((group) => group[pkg.name] !== undefined),
  )
}

const workspaceChainsForPackage = (
  pkg: ResolvedLockPackage,
  workspaces: ReadonlyArray<LockWorkspace>,
): ReadonlyArray<{ version: string; chain: ReadonlyArray<string> }> => {
  const root = pkg.chain[0]
  const matchingWorkspaces = workspaces.filter((workspace) =>
    [
      workspace.dependencies,
      workspace.devDependencies,
      workspace.peerDependencies,
      workspace.optionalDependencies,
    ].some((group) => root !== undefined && group[root] !== undefined),
  )

  if (matchingWorkspaces.length === 0) {
    return [{ version: pkg.version, chain: pkg.chain }]
  }

  return matchingWorkspaces.map((workspace) => ({
    version: pkg.version,
    chain: [workspace.name ?? workspace.path ?? "(root)", ...pkg.chain],
  }))
}

const compareDuplicateGroups = (left: DuplicateGroup, right: DuplicateGroup): number => {
  if (left.evidenceKind !== right.evidenceKind) {
    return left.evidenceKind === "direct-workspace-duplicate" ? -1 : 1
  }
  if (right.directVersions.length !== left.directVersions.length) {
    return right.directVersions.length - left.directVersions.length
  }
  if (right.directInstanceCount !== left.directInstanceCount) {
    return right.directInstanceCount - left.directInstanceCount
  }
  if (right.versions.length !== left.versions.length) {
    return right.versions.length - left.versions.length
  }
  if (right.instanceCount !== left.instanceCount) {
    return right.instanceCount - left.instanceCount
  }
  return left.name.localeCompare(right.name)
}
