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
  const packages: Array<PnpmResolvedPackage> = []
  let inPackages = false

  for (const line of text.split("\n")) {
    if (line === "packages:") {
      inPackages = true
      continue
    }
    if (!inPackages) continue
    if (/^\S/.test(line)) break

    const entry = /^  (\S.*):$/.exec(line)
    if (entry === null) continue
    const lockKey = unquote(entry[1] ?? "")
    const parsed = parsePnpmPackageKey(lockKey)
    if (parsed === undefined) continue
    packages.push({
      lockKey,
      name: parsed.name,
      version: parsed.version,
      dependencies: {},
      chain: [parsed.name],
      direct: isDirectPnpmPackage(parsed.name, parsed.version, workspaces),
    })
  }

  return packages.sort((left, right) => left.lockKey.localeCompare(right.lockKey))
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
