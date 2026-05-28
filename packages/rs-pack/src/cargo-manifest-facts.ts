import { readFile } from "node:fs/promises"
import { Effect } from "effect"

export interface ParsedRustDependencyInfo {
  readonly alias: string
  readonly packageName: string
  readonly inheritedFromWorkspace: boolean
}

export interface CargoManifestFacts {
  readonly packageName: string | undefined
  readonly dependencies: ReadonlyArray<ParsedRustDependencyInfo>
  readonly workspaceDependencies: ReadonlyArray<ParsedRustDependencyInfo>
}

type DependencySectionKind = "manifest" | "workspace"

interface CargoManifestParseState {
  packageName: string | undefined
  inPackage: boolean
  inDependencySection: boolean
  dependencySectionKind: DependencySectionKind | undefined
  tableDependencySectionKind: DependencySectionKind | undefined
  tableAlias: string | undefined
  tablePackageName: string | undefined
  tableInheritedFromWorkspace: boolean
  readonly dependencies: Map<string, ParsedRustDependencyInfo>
  readonly workspaceDependencies: Map<string, ParsedRustDependencyInfo>
}

const DEPENDENCY_SECTION_PATTERN =
  /^\[(?:target\.[^\]]+\.)?(?:dev-|build-)?dependencies\]$/
const DEPENDENCY_TABLE_SECTION_PATTERN =
  /^\[(?:target\.[^\]]+\.)?(?:dev-|build-)?dependencies\.([A-Za-z0-9_-]+)\]$/
const WORKSPACE_DEPENDENCY_SECTION_PATTERN = /^\[workspace\.dependencies\]$/
const WORKSPACE_DEPENDENCY_TABLE_SECTION_PATTERN =
  /^\[workspace\.dependencies\.([A-Za-z0-9_-]+)\]$/
const DEPENDENCY_KEY_PATTERN = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/
const PACKAGE_KEY_PATTERN = /^package\s*=\s*"([^"]+)"$/
const WORKSPACE_TRUE_KEY_PATTERN = /^workspace\s*=\s*true$/
const PACKAGE_INLINE_PATTERN = /(?:^|[,{]\s*)package\s*=\s*"([^"]+)"/
const WORKSPACE_TRUE_INLINE_PATTERN = /(?:^|[,{]\s*)workspace\s*=\s*true(?:\s*[,}]|$)/

export const readCargoManifestFacts = (
  manifestPath: string,
): Effect.Effect<CargoManifestFacts, unknown> =>
  Effect.tryPromise({
    try: async () => parseCargoManifestFacts(await readFile(manifestPath, "utf8")),
    catch: (error: unknown) => error,
  })

export const parseCargoManifestFacts = (raw: string): CargoManifestFacts => {
  const state = makeCargoManifestParseState()

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = stripTomlLineComment(line).trim()
    if (trimmed.length === 0) continue

    if (trimmed.startsWith("[")) {
      startCargoManifestSection(state, trimmed)
      continue
    }

    if (state.inPackage) {
      readCargoPackageField(state, trimmed)
      continue
    }

    if (state.tableAlias !== undefined) {
      readCargoTableDependencyField(state, trimmed)
      continue
    }

    readCargoInlineDependency(state, trimmed)
  }

  flushCargoTableDependency(state)
  return {
    packageName: state.packageName,
    dependencies: [...state.dependencies.values()],
    workspaceDependencies: [...state.workspaceDependencies.values()],
  }
}

const makeCargoManifestParseState = (): CargoManifestParseState => ({
  packageName: undefined,
  inPackage: false,
  inDependencySection: false,
  dependencySectionKind: undefined,
  tableDependencySectionKind: undefined,
  tableAlias: undefined,
  tablePackageName: undefined,
  tableInheritedFromWorkspace: false,
  dependencies: new Map(),
  workspaceDependencies: new Map(),
})

const startCargoManifestSection = (
  state: CargoManifestParseState,
  section: string,
): void => {
  flushCargoTableDependency(state)
  resetCargoSectionState(state)
  state.inPackage = section === "[package]"

  const dependencyTableMatch = DEPENDENCY_TABLE_SECTION_PATTERN.exec(section)
  if (dependencyTableMatch !== null) {
    state.tableAlias = dependencyTableMatch[1]
    state.tableDependencySectionKind = "manifest"
    return
  }

  const workspaceDependencyTableMatch =
    WORKSPACE_DEPENDENCY_TABLE_SECTION_PATTERN.exec(section)
  if (workspaceDependencyTableMatch !== null) {
    state.tableAlias = workspaceDependencyTableMatch[1]
    state.tableDependencySectionKind = "workspace"
    return
  }

  if (DEPENDENCY_SECTION_PATTERN.test(section)) {
    state.inDependencySection = true
    state.dependencySectionKind = "manifest"
  } else if (WORKSPACE_DEPENDENCY_SECTION_PATTERN.test(section)) {
    state.inDependencySection = true
    state.dependencySectionKind = "workspace"
  }
}

const resetCargoSectionState = (state: CargoManifestParseState): void => {
  state.inPackage = false
  state.inDependencySection = false
  state.dependencySectionKind = undefined
  state.tableAlias = undefined
  state.tablePackageName = undefined
  state.tableInheritedFromWorkspace = false
  state.tableDependencySectionKind = undefined
}

const readCargoPackageField = (
  state: CargoManifestParseState,
  trimmed: string,
): void => {
  const match = /^name\s*=\s*"([^"]+)"$/.exec(trimmed)
  if (match !== null) state.packageName = match[1]
}

const readCargoTableDependencyField = (
  state: CargoManifestParseState,
  trimmed: string,
): void => {
  const packageMatch = PACKAGE_KEY_PATTERN.exec(trimmed)
  if (packageMatch !== null) state.tablePackageName = packageMatch[1]
  if (WORKSPACE_TRUE_KEY_PATTERN.test(trimmed)) state.tableInheritedFromWorkspace = true
}

const readCargoInlineDependency = (
  state: CargoManifestParseState,
  trimmed: string,
): void => {
  if (!state.inDependencySection || state.dependencySectionKind === undefined) return
  const dependencyMatch = DEPENDENCY_KEY_PATTERN.exec(trimmed)
  if (dependencyMatch === null) return
  const alias = dependencyMatch[1]!
  const value = dependencyMatch[2]!.trim()
  setCargoDependency(state, state.dependencySectionKind, {
    alias,
    packageName: PACKAGE_INLINE_PATTERN.exec(value)?.[1] ?? alias,
    inheritedFromWorkspace:
      state.dependencySectionKind === "manifest" && WORKSPACE_TRUE_INLINE_PATTERN.test(value),
  })
}

const flushCargoTableDependency = (state: CargoManifestParseState): void => {
  if (state.tableAlias === undefined || state.tableDependencySectionKind === undefined) return
  setCargoDependency(state, state.tableDependencySectionKind, {
    alias: state.tableAlias,
    packageName: state.tablePackageName ?? state.tableAlias,
    inheritedFromWorkspace:
      state.tableDependencySectionKind === "manifest" && state.tableInheritedFromWorkspace,
  })
  state.tableAlias = undefined
  state.tablePackageName = undefined
  state.tableInheritedFromWorkspace = false
  state.tableDependencySectionKind = undefined
}

const setCargoDependency = (
  state: CargoManifestParseState,
  sectionKind: DependencySectionKind,
  dependency: ParsedRustDependencyInfo,
): void => {
  const target = sectionKind === "workspace" ? state.workspaceDependencies : state.dependencies
  target.set(dependency.alias, dependency)
}

const stripTomlLineComment = (line: string): string => {
  let inString = false
  let escaped = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === "\\") {
      escaped = true
      continue
    }
    if (char === "\"") {
      inString = !inString
      continue
    }
    if (char === "#" && !inString) return line.slice(0, index)
  }
  return line
}
