import { readFile } from "node:fs/promises"

interface PnpmLockWorkspace {
  readonly path: string
  readonly name: string | undefined
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
}

export interface PnpmResolvedPackage {
  readonly lockKey: string
  readonly name: string
  readonly version: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly chain: ReadonlyArray<string>
  readonly direct: boolean
}

interface ParsedPnpmLock {
  readonly workspaces: ReadonlyArray<PnpmLockWorkspace>
  readonly packages: ReadonlyArray<PnpmResolvedPackage>
  readonly packageNames: ReadonlySet<string>
}

type DependencyKind = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies"

type MutablePnpmWorkspace = {
  path: string
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  peerDependencies: Record<string, string>
  optionalDependencies: Record<string, string>
}

interface ImporterParseState {
  readonly workspaces: Array<MutablePnpmWorkspace>
  inImporters: boolean
  current: MutablePnpmWorkspace | undefined
  dependencyKind: DependencyKind | undefined
  pendingDependency: string | undefined
  done: boolean
}

interface MutablePnpmPackage {
  readonly lockKey: string
  readonly name: string
  readonly version: string
  readonly dependencies: Record<string, string>
}

interface PackageParseState {
  readonly packages: Array<MutablePnpmPackage>
  inPackages: boolean
  current: MutablePnpmPackage | undefined
  dependencyKind: DependencyKind | undefined
  pendingDependency: string | undefined
}

export const readPnpmLockFile = async (filePath: string): Promise<ParsedPnpmLock> => {
  const text = await readFile(filePath, "utf8")
  return parsePnpmLock(text)
}

const parsePnpmLock = (text: string): ParsedPnpmLock => {
  const workspaces = parseImporters(text)
  const packages = parsePackages(text, workspaces)
  return {
    workspaces,
    packages,
    packageNames: new Set(packages.map((pkg) => pkg.name)),
  }
}

const parseImporters = (text: string): ReadonlyArray<PnpmLockWorkspace> => {
  const state: ImporterParseState = {
    workspaces: [],
    inImporters: false,
    current: undefined,
    dependencyKind: undefined,
    pendingDependency: undefined,
    done: false,
  }
  for (const line of text.split("\n")) {
    parseImporterLine(line, state)
    if (state.done) break
  }

  return state.workspaces
    .map(finalizeWorkspaceImporter)
    .sort((left, right) => left.path.localeCompare(right.path))
}

const parseImporterLine = (line: string, state: ImporterParseState): void => {
  if (line === "importers:") {
    state.inImporters = true
    return
  }
  if (!state.inImporters) return
  if (line === "packages:" || /^\S/.test(line)) {
    state.done = true
    return
  }

  const importer = /^  (\S.*):$/.exec(line)
  if (importer !== null) {
    startWorkspaceImporter(importer[1] ?? "", state)
    return
  }
  const dependencySection = /^    (dependencies|devDependencies|peerDependencies|optionalDependencies):$/.exec(line)
  if (dependencySection !== null) {
    state.dependencyKind = dependencySection[1] as DependencyKind
    state.pendingDependency = undefined
    return
  }
  parseImporterDependencyLine(line, state)
}

const startWorkspaceImporter = (
  rawPath: string,
  state: ImporterParseState,
): void => {
  state.current = {
    path: unquote(rawPath),
    dependencies: {},
    devDependencies: {},
    peerDependencies: {},
    optionalDependencies: {},
  }
  state.workspaces.push(state.current)
  state.dependencyKind = undefined
  state.pendingDependency = undefined
}

const parseImporterDependencyLine = (line: string, state: ImporterParseState): void => {
  if (state.current === undefined || state.dependencyKind === undefined) return

  const dependency = /^      (\S.*):(?:\s*(.+))?$/.exec(line)
  if (dependency !== null) {
    state.pendingDependency = unquote(dependency[1] ?? "")
    const inlineVersion = dependency[2]
    if (inlineVersion !== undefined && inlineVersion.trim().length > 0) {
      state.current[state.dependencyKind][state.pendingDependency] = cleanPnpmVersion(inlineVersion)
    }
    return
  }

  const version = /^        version:\s*(.+)$/.exec(line)
  if (version !== null && state.pendingDependency !== undefined) {
    state.current[state.dependencyKind][state.pendingDependency] = cleanPnpmVersion(version[1] ?? "")
  }
}

const finalizeWorkspaceImporter = (workspace: MutablePnpmWorkspace): PnpmLockWorkspace => ({
  path: workspace.path,
  name: workspace.path === "." ? "workspace" : workspace.path,
  dependencies: workspace.dependencies,
  devDependencies: workspace.devDependencies,
  peerDependencies: workspace.peerDependencies,
  optionalDependencies: workspace.optionalDependencies,
})

const parsePackages = (
  text: string,
  workspaces: ReadonlyArray<PnpmLockWorkspace>,
): ReadonlyArray<PnpmResolvedPackage> => {
  const state: PackageParseState = {
    packages: [],
    inPackages: false,
    current: undefined,
    dependencyKind: undefined,
    pendingDependency: undefined,
  }

  for (const line of text.split("\n")) {
    parsePackageLine(line, state)
  }

  const packageIndex = indexPackages(state.packages)
  return state.packages
    .map((entry): PnpmResolvedPackage => ({
      lockKey: entry.lockKey,
      name: entry.name,
      version: entry.version,
      dependencies: entry.dependencies,
      chain: findPnpmPackageChain(entry, state.packages, packageIndex, workspaces) ?? [entry.name],
      direct: isDirectPnpmPackage(entry.name, entry.version, workspaces),
    }))
    .sort((left, right) => left.lockKey.localeCompare(right.lockKey))
}

const parsePackageLine = (line: string, state: PackageParseState): void => {
  if (line === "packages:") {
    state.inPackages = true
    return
  }
  if (!state.inPackages) return
  if (/^\S/.test(line)) {
    state.inPackages = false
    return
  }

  const entry = /^  (\S.*?):(?:\s*\{.*\})?$/.exec(line)
  if (entry !== null) {
    const lockKey = unquote(entry[1] ?? "")
    const parsed = parsePnpmPackageKey(lockKey)
    state.current = parsed === undefined
      ? undefined
      : {
          lockKey,
          name: parsed.name,
          version: parsed.version,
          dependencies: {},
        }
    if (state.current !== undefined) {
      state.packages.push(state.current)
    }
    state.dependencyKind = undefined
    state.pendingDependency = undefined
    return
  }

  const dependencySection = /^    (dependencies|peerDependencies|optionalDependencies):$/.exec(line)
  if (dependencySection !== null) {
    state.dependencyKind = dependencySection[1] as DependencyKind
    state.pendingDependency = undefined
    return
  }
  parsePackageDependencyLine(line, state)
}

const parsePackageDependencyLine = (line: string, state: PackageParseState): void => {
  if (state.current === undefined || state.dependencyKind === undefined) return

  const dependency = /^      (\S.*):(?:\s*(.+))?$/.exec(line)
  if (dependency !== null) {
    state.pendingDependency = unquote(dependency[1] ?? "")
    const inlineVersion = dependency[2]
    if (inlineVersion !== undefined && inlineVersion.trim().length > 0) {
      state.current.dependencies[state.pendingDependency] = cleanPnpmVersion(inlineVersion)
    }
    return
  }

  const version = /^        version:\s*(.+)$/.exec(line)
  if (version !== null && state.pendingDependency !== undefined) {
    state.current.dependencies[state.pendingDependency] = cleanPnpmVersion(version[1] ?? "")
  }
}

const indexPackages = (
  packages: ReadonlyArray<MutablePnpmPackage>,
): ReadonlyMap<string, ReadonlyArray<MutablePnpmPackage>> => {
  const index = new Map<string, Array<MutablePnpmPackage>>()
  for (const pkg of packages) {
    const key = packageIndexKey(pkg.name, pkg.version)
    const bucket = index.get(key) ?? []
    bucket.push(pkg)
    index.set(key, bucket)
  }
  for (const bucket of index.values()) {
    bucket.sort((left, right) => left.lockKey.localeCompare(right.lockKey))
  }
  return index
}

const findPnpmPackageChain = (
  target: MutablePnpmPackage,
  packages: ReadonlyArray<MutablePnpmPackage>,
  packageIndex: ReadonlyMap<string, ReadonlyArray<MutablePnpmPackage>>,
  workspaces: ReadonlyArray<PnpmLockWorkspace>,
): ReadonlyArray<string> | undefined => {
  if (isDirectPnpmPackage(target.name, target.version, workspaces)) {
    return [target.name]
  }

  const directPackages = packages
    .filter((pkg) => isDirectPnpmPackage(pkg.name, pkg.version, workspaces))
    .sort((left, right) => left.lockKey.localeCompare(right.lockKey))

  for (const directPackage of directPackages) {
    const chain = findDependencyPath(directPackage, target, packageIndex, new Set())
    if (chain !== undefined) return chain
  }
  return undefined
}

const findDependencyPath = (
  current: MutablePnpmPackage,
  target: MutablePnpmPackage,
  packageIndex: ReadonlyMap<string, ReadonlyArray<MutablePnpmPackage>>,
  seen: ReadonlySet<string>,
): ReadonlyArray<string> | undefined => {
  if (current.lockKey === target.lockKey) return [current.name]
  if (seen.has(current.lockKey)) return undefined

  const nextSeen = new Set(seen)
  nextSeen.add(current.lockKey)
  const dependencies = Object.entries(current.dependencies)
    .sort(([leftName, leftVersion], [rightName, rightVersion]) =>
      leftName.localeCompare(rightName) || leftVersion.localeCompare(rightVersion),
    )

  for (const [name, version] of dependencies) {
    const candidates = packageIndex.get(packageIndexKey(name, version)) ?? []
    for (const candidate of candidates) {
      const chain = findDependencyPath(candidate, target, packageIndex, nextSeen)
      if (chain !== undefined) return [current.name, ...chain]
    }
  }
  return undefined
}

const parsePnpmPackageKey = (
  lockKey: string,
): { readonly name: string; readonly version: string } | undefined => {
  const normalized = lockKey.startsWith("/") ? lockKey.slice(1) : lockKey
  const withoutPeers = normalized.replace(/\(.+\)$/, "")
  if (withoutPeers.startsWith("@")) {
    const scopeSeparator = withoutPeers.indexOf("/")
    if (scopeSeparator === -1) return undefined
    const versionSeparator = withoutPeers.indexOf("@", scopeSeparator + 1)
    if (versionSeparator === -1) return undefined
    return {
      name: withoutPeers.slice(0, versionSeparator),
      version: withoutPeers.slice(versionSeparator + 1),
    }
  }

  const versionSeparator = withoutPeers.lastIndexOf("@")
  if (versionSeparator <= 0) return undefined
  return {
    name: withoutPeers.slice(0, versionSeparator),
    version: withoutPeers.slice(versionSeparator + 1),
  }
}

const isDirectPnpmPackage = (
  name: string,
  version: string,
  workspaces: ReadonlyArray<PnpmLockWorkspace>,
): boolean =>
  workspaces.some((workspace) =>
    [
      workspace.dependencies,
      workspace.devDependencies,
      workspace.peerDependencies,
      workspace.optionalDependencies,
    ].some((group) => group[name] === version),
  )

const cleanPnpmVersion = (value: string): string => {
  const trimmed = unquote(value.trim())
  const parenIndex = trimmed.indexOf("(")
  return parenIndex === -1 ? trimmed : trimmed.slice(0, parenIndex)
}

const packageIndexKey = (name: string, version: string): string => `${name}@${version}`

const unquote = (value: string): string => {
  const trimmed = value.trim()
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith("\"") && trimmed.endsWith("\""))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}
