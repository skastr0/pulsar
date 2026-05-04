import { readFile } from "node:fs/promises"

export interface PnpmLockWorkspace {
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

export interface ParsedPnpmLock {
  readonly workspaces: ReadonlyArray<PnpmLockWorkspace>
  readonly packages: ReadonlyArray<PnpmResolvedPackage>
  readonly packageNames: ReadonlySet<string>
}

type DependencyKind = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies"

export const readPnpmLockFile = async (filePath: string): Promise<ParsedPnpmLock> => {
  const text = await readFile(filePath, "utf8")
  return parsePnpmLock(text)
}

export const parsePnpmLock = (text: string): ParsedPnpmLock => {
  const workspaces = parseImporters(text)
  const packages = parsePackages(text, workspaces)
  return {
    workspaces,
    packages,
    packageNames: new Set(packages.map((pkg) => pkg.name)),
  }
}

const parseImporters = (text: string): ReadonlyArray<PnpmLockWorkspace> => {
  const workspaces: Array<{
    path: string
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    peerDependencies: Record<string, string>
    optionalDependencies: Record<string, string>
  }> = []
  let inImporters = false
  let current: (typeof workspaces)[number] | undefined
  let dependencyKind: DependencyKind | undefined
  let pendingDependency: string | undefined

  for (const line of text.split("\n")) {
    if (line === "importers:") {
      inImporters = true
      continue
    }
    if (!inImporters) continue
    if (line === "packages:" || /^\S/.test(line)) break

    const importer = /^  (\S.*):$/.exec(line)
    if (importer !== null) {
      current = {
        path: unquote(importer[1] ?? ""),
        dependencies: {},
        devDependencies: {},
        peerDependencies: {},
        optionalDependencies: {},
      }
      workspaces.push(current)
      dependencyKind = undefined
      pendingDependency = undefined
      continue
    }

    const dependencySection = /^    (dependencies|devDependencies|peerDependencies|optionalDependencies):$/.exec(line)
    if (dependencySection !== null) {
      dependencyKind = dependencySection[1] as DependencyKind
      pendingDependency = undefined
      continue
    }
    if (current === undefined || dependencyKind === undefined) continue

    const dependency = /^      (\S.*):(?:\s*(.+))?$/.exec(line)
    if (dependency !== null) {
      pendingDependency = unquote(dependency[1] ?? "")
      const inlineVersion = dependency[2]
      if (inlineVersion !== undefined && inlineVersion.trim().length > 0) {
        current[dependencyKind][pendingDependency] = cleanPnpmVersion(inlineVersion)
      }
      continue
    }

    const version = /^        version:\s*(.+)$/.exec(line)
    if (version !== null && pendingDependency !== undefined) {
      current[dependencyKind][pendingDependency] = cleanPnpmVersion(version[1] ?? "")
    }
  }

  return workspaces
    .map((workspace) => ({
      path: workspace.path,
      name: workspace.path === "." ? "workspace" : workspace.path,
      dependencies: workspace.dependencies,
      devDependencies: workspace.devDependencies,
      peerDependencies: workspace.peerDependencies,
      optionalDependencies: workspace.optionalDependencies,
    }))
    .sort((left, right) => left.path.localeCompare(right.path))
}

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
