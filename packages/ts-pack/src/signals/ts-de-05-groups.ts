import type { LockWorkspace, ResolvedLockPackage } from "./ts-de-05-lockfile.js"

export interface DuplicateGroup {
  readonly name: string
  readonly versions: ReadonlyArray<string>
  readonly directVersions: ReadonlyArray<string>
  readonly instanceCount: number
  readonly directInstanceCount: number
  readonly evidenceKind: "direct-workspace-duplicate" | "transitive-lockfile-duplicate"
  readonly pullInChains: ReadonlyArray<{ version: string; chain: ReadonlyArray<string> }>
}

export const findDuplicateGroups = (
  packages: ReadonlyArray<ResolvedLockPackage>,
  workspaces: ReadonlyArray<LockWorkspace>,
): ReadonlyArray<DuplicateGroup> => {
  const byName = new Map<string, Array<ResolvedLockPackage>>()
  for (const pkg of packages) {
    const bucket = byName.get(pkg.name) ?? []
    bucket.push(pkg)
    byName.set(pkg.name, bucket)
  }

  return [...byName.entries()]
    .map(([name, groupedPackages]) => toDuplicateGroup(name, groupedPackages, workspaces))
    .filter((group) => group.versions.length > 1)
    .sort(compareDuplicateGroups)
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
