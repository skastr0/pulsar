import { readFile } from "node:fs/promises"

export interface NpmLockWorkspace {
  readonly path: string
  readonly name: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
}

export interface NpmResolvedPackage {
  readonly lockKey: string
  readonly name: string
  readonly version: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly chain: ReadonlyArray<string>
  readonly direct: boolean
}

export interface ParsedNpmLock {
  readonly workspaces: ReadonlyArray<NpmLockWorkspace>
  readonly packages: ReadonlyArray<NpmResolvedPackage>
  readonly packageNames: ReadonlySet<string>
}

export const readNpmLockFile = async (filePath: string): Promise<ParsedNpmLock> => {
  const text = await readFile(filePath, "utf8")
  return parseNpmLock(text)
}

export const parseNpmLock = (text: string): ParsedNpmLock => {
  const parsed = JSON.parse(text) as {
    readonly packages?: Record<string, Record<string, unknown>>
  }
  const entries = Object.entries(parsed.packages ?? {})
  const workspaces = entries
    .filter(([lockKey, value]) => isWorkspacePackage(lockKey, value))
    .map(([lockKey, value]): NpmLockWorkspace => ({
      path: lockKey,
      name: asOptionalString(value.name),
      dependencies: asDependencyRecord(value.dependencies),
      devDependencies: asDependencyRecord(value.devDependencies),
      peerDependencies: asDependencyRecord(value.peerDependencies),
      optionalDependencies: asDependencyRecord(value.optionalDependencies),
    }))
    .sort((left, right) => left.path.localeCompare(right.path))

  const packages = entries
    .flatMap(([lockKey, value]): ReadonlyArray<NpmResolvedPackage> => {
      const name = packageNameFromPackageLockKey(lockKey)
      const version = asOptionalString(value.version)
      if (name === undefined || version === undefined) return []
      return [{
        lockKey,
        name,
        version,
        dependencies: {
          ...asDependencyRecord(value.dependencies),
          ...asDependencyRecord(value.optionalDependencies),
          ...asDependencyRecord(value.peerDependencies),
        },
        chain: parsePackageLockChain(lockKey),
        direct: isDirectInstalledPackage(lockKey, name, workspaces),
      }]
    })
    .sort((left, right) => left.lockKey.localeCompare(right.lockKey))

  return {
    workspaces,
    packages,
    packageNames: new Set(packages.map((pkg) => pkg.name)),
  }
}

const isWorkspacePackage = (lockKey: string, value: Record<string, unknown>): boolean => {
  if (lockKey.includes("node_modules")) return false
  return lockKey === "" || value.name !== undefined || value.dependencies !== undefined
}

const isDirectInstalledPackage = (
  lockKey: string,
  name: string,
  workspaces: ReadonlyArray<NpmLockWorkspace>,
): boolean =>
  workspaces.some((workspace) => {
    const prefix = workspace.path.length === 0 ? "" : `${workspace.path}/`
    if (lockKey !== `${prefix}node_modules/${name}`) return false
    return [
      workspace.dependencies,
      workspace.devDependencies,
      workspace.peerDependencies,
      workspace.optionalDependencies,
    ].some((group) => group[name] !== undefined)
  })

const packageNameFromPackageLockKey = (lockKey: string): string | undefined => {
  return packageNamesFromPackageLockKey(lockKey).at(-1)
}

const parsePackageLockChain = (lockKey: string): ReadonlyArray<string> =>
  packageNamesFromPackageLockKey(lockKey)

const packageNamesFromPackageLockKey = (lockKey: string): ReadonlyArray<string> => {
  const marker = "node_modules/"
  const names: Array<string> = []
  let index = 0
  while (index < lockKey.length) {
    const markerIndex = lockKey.indexOf(marker, index)
    if (markerIndex === -1) break
    const nameStart = markerIndex + marker.length
    const nextMarkerIndex = lockKey.indexOf(`/${marker}`, nameStart)
    const name = lockKey.slice(
      nameStart,
      nextMarkerIndex === -1 ? lockKey.length : nextMarkerIndex,
    )
    if (name.length > 0) {
      names.push(name)
    }
    index = nextMarkerIndex === -1 ? lockKey.length : nextMarkerIndex + 1
  }
  return names
}

const asDependencyRecord = (value: unknown): Readonly<Record<string, string>> => {
  if (value === null || typeof value !== "object") {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  )
}

const asOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined
