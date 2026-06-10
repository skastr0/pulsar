import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { readFile } from "node:fs/promises"
import { relative, sep } from "node:path"
import { Effect, Schema } from "effect"
import {
  findDuplicateCargoLockPackages,
  type CargoLockPackage,
} from "../lock-file.js"
import { RustProjectTag, type RustManifestInfo, type RustProject } from "../project.js"

const RsDe02Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
type RsDe02Config = typeof RsDe02Config.Type

interface DependencyDuplicateGroup {
  readonly name: string
  readonly versions: ReadonlyArray<string>
  readonly instanceCount: number
  readonly platformShim: boolean
}

interface TopLevelDependencyDepth {
  readonly name: string
  readonly rootInstances: number
  readonly maxDepth: number
  readonly reachablePackages: number
}

interface UnusedDependencyInfo {
  readonly manifestName: string
  readonly manifestFile: string
  readonly alias: string
  readonly packageName: string
  readonly libName: string
}

interface RsDe02Output {
  readonly duplicates: ReadonlyArray<DependencyDuplicateGroup>
  readonly topLevelDependencies: ReadonlyArray<TopLevelDependencyDepth>
  readonly duplicateCount: number
  readonly lockfileStatus: "loaded" | "missing"
  readonly packageCount: number
  readonly dependencyPackageCount: number
  readonly maxDependencyDepth: number
  readonly unusedDependencies: ReadonlyArray<UnusedDependencyInfo>
  readonly unusedDependencyCount: number
  readonly scannedSourceFileCount: number
  readonly manifestCount: number
  readonly directDependencyCount: number
  readonly diagnosticLimit: number
  readonly analysisMode: "cargo-lock"
}

interface RsDe02ScoreBreakdown {
  readonly duplicateGroupCount: number
  readonly platformShimDuplicateGroupCount: number
  readonly scoredDuplicateGroupCount: number
  readonly dependencyPackageCount: number
  readonly duplicateRatio: number
  readonly duplicatePressure: number
  readonly maxDependencyDepth: number
  readonly depthPressure: number
  readonly breadthPressure: number
  readonly unusedDependencyCount: number
  readonly unusedDependencyPressure: number
  readonly totalPressure: number
  readonly scoreFloor: number
  readonly score: number
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10

// Score-curve constants. Duplicate pressure is a ratio of non-platform-shim
// duplicate groups to lockfile dependency packages (floored denominator so a
// single endemic duplicate in a small lockfile does not dominate). Depth
// pressure starts beyond the ecosystem-normal range (clap-style depth 5 and
// tantivy-style depth 9 stay pressure-free). Breadth saturates at a realistic
// Rust scale (hundreds of lock packages) with a small weight. Per-component
// caps plus the score floor guarantee this signal can never single-handedly
// zero a repository.
const DUPLICATE_RATIO_PACKAGE_FLOOR = 50
const DUPLICATE_PRESSURE_WEIGHT = 2
const DUPLICATE_PRESSURE_CAP = 0.45
const DEPTH_WARN_THRESHOLD = 8
const DEPTH_PRESSURE_START = 10
const DEPTH_PRESSURE_PER_LEVEL = 0.05
const DEPTH_PRESSURE_CAP = 0.25
const BREADTH_PRESSURE_START = 5
const BREADTH_PRESSURE_SCALE = 1200
const BREADTH_PRESSURE_CAP = 0.25
const UNUSED_PRESSURE_PER_DEPENDENCY = 0.04
const UNUSED_PRESSURE_CAP = 0.2
const SCORE_FLOOR = 0.15

// Platform-shim duplicate families every tokio/wasm-adjacent project carries
// transitively. They still appear as informational duplicate diagnostics but
// are excluded from duplicate score pressure.
const PLATFORM_SHIM_PATTERNS: ReadonlyArray<RegExp> = [
  /^windows-sys$/,
  /^windows-targets$/,
  /^windows_[a-z0-9_]+$/,
  /^wasi$/,
  /^redox_syscall$/,
]

const RS_DE_02_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsDe02: Signal<RsDe02Config, RsDe02Output, RustProjectTag> = {
  id: "RS-DE-02-dependency-tree",
  title: "Dependency tree",
  aliases: ["RS-DE-02"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  cacheVersion: "cargo-lock-dependency-tree-ratio-curve-unused-deps-v3-lib-target-names-dotted-keys",
  configSchema: RsDe02Config,
  factorDefinitions: RS_DE_02_FACTOR_DEFINITIONS,
  defaultConfig: {
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsDe02Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsDe02Output> =>
          computeRsDe02Output(project, normalizedConfig),
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-02-dependency-tree", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.lockfileStatus === "missing") return 1
    return computeRsDe02ScoreBreakdown(out).score
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.lockfileStatus === "missing") {
      return [{
        severity: "warn" as const,
        message: "RS-DE-02 could not find Cargo.lock for dependency analysis",
        data: {
          lockfileStatus: out.lockfileStatus,
          manifestCount: out.manifestCount,
          directDependencyCount: out.directDependencyCount,
          packageCount: out.packageCount,
          dependencyPackageCount: out.dependencyPackageCount,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    if (
      out.directDependencyCount > 0 &&
      out.duplicateCount === 0 &&
      out.topLevelDependencies.length === 0
    ) {
      return [{
        severity: "warn" as const,
        message: "RS-DE-02 could not resolve direct Cargo.lock dependencies",
        data: {
          lockfileStatus: out.lockfileStatus,
          directDependencyCount: out.directDependencyCount,
          packageCount: out.packageCount,
          dependencyPackageCount: out.dependencyPackageCount,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    if (out.diagnosticLimit <= 0) return []

    const duplicateDiagnostics = out.duplicates.map((group) => ({
      severity: group.platformShim ? ("info" as const) : ("warn" as const),
      message: group.platformShim
        ? `Duplicate crate versions for ${group.name}: ${group.versions.join(", ")} (platform-shim family, excluded from score pressure)`
        : `Duplicate crate versions for ${group.name}: ${group.versions.join(", ")}`,
      location: { file: "Cargo.lock" },
      data: {
        hash: hashDuplicateGroup(group),
        name: group.name,
        versions: group.versions,
        instanceCount: group.instanceCount,
        platformShim: group.platformShim,
      },
    }))
    const depthDiagnostics = out.topLevelDependencies
      .filter((entry) => entry.maxDepth > 0)
      .map((entry) => ({
        severity: entry.maxDepth >= DEPTH_WARN_THRESHOLD ? ("warn" as const) : ("info" as const),
        message: `Top-level dependency ${entry.name} reaches depth ${entry.maxDepth}`,
        location: { file: "Cargo.lock" },
        data: {
          hash: hashDependencyDepth(entry),
          name: entry.name,
          maxDepth: entry.maxDepth,
          reachablePackages: entry.reachablePackages,
          rootInstances: entry.rootInstances,
        },
      }))
    const unusedDiagnostics = out.unusedDependencies.map((entry) => ({
      severity: "warn" as const,
      message: `Declared dependency ${entry.alias} (crate ${entry.packageName}) has no source references in ${entry.manifestName}`,
      location: { file: entry.manifestFile },
      data: {
        hash: hashUnusedDependency(entry),
        alias: entry.alias,
        packageName: entry.packageName,
        libName: entry.libName,
        manifestName: entry.manifestName,
      },
    }))
    const details = [
      ...duplicateDiagnostics,
      ...depthDiagnostics,
      ...unusedDiagnostics,
    ].slice(0, out.diagnosticLimit)
    const breakdown = computeRsDe02ScoreBreakdown(out)
    // The score-breakdown summary rides above the top_n cap so every
    // score-bearing penalty component stays reconstructible even when detail
    // diagnostics overflow the limit.
    return breakdown.totalPressure > 0
      ? [scoreBreakdownDiagnostic(breakdown), ...details]
      : details
  },
  outputMetadata: (out) => {
    if (out.lockfileStatus === "missing") {
      return { applicability: "insufficient_evidence" as const }
    }
    if (
      out.directDependencyCount > 0 &&
      out.duplicateCount === 0 &&
      out.topLevelDependencies.length === 0
    ) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (
      out.packageCount === 0 ||
      (out.duplicateCount === 0 && out.topLevelDependencies.length === 0)
    ) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsDe02FactorLedger(),
}

type NormalizedRsDe02Config = RsDe02Config

const computeRsDe02ScoreBreakdown = (out: RsDe02Output): RsDe02ScoreBreakdown => {
  const platformShimDuplicateGroupCount = out.duplicates
    .filter((group) => group.platformShim)
    .length
  const scoredDuplicateGroupCount = out.duplicateCount - platformShimDuplicateGroupCount
  const duplicateRatio =
    scoredDuplicateGroupCount /
    Math.max(DUPLICATE_RATIO_PACKAGE_FLOOR, out.dependencyPackageCount)
  const duplicatePressure = Math.min(
    DUPLICATE_PRESSURE_CAP,
    duplicateRatio * DUPLICATE_PRESSURE_WEIGHT,
  )
  const depthPressure = Math.min(
    DEPTH_PRESSURE_CAP,
    Math.max(0, out.maxDependencyDepth - (DEPTH_PRESSURE_START - 1)) *
      DEPTH_PRESSURE_PER_LEVEL,
  )
  const breadthPressure = Math.min(
    BREADTH_PRESSURE_CAP,
    Math.max(0, out.dependencyPackageCount - BREADTH_PRESSURE_START) /
      BREADTH_PRESSURE_SCALE,
  )
  const unusedDependencyPressure = Math.min(
    UNUSED_PRESSURE_CAP,
    out.unusedDependencyCount * UNUSED_PRESSURE_PER_DEPENDENCY,
  )
  const totalPressure =
    duplicatePressure + depthPressure + breadthPressure + unusedDependencyPressure
  return {
    duplicateGroupCount: out.duplicateCount,
    platformShimDuplicateGroupCount,
    scoredDuplicateGroupCount,
    dependencyPackageCount: out.dependencyPackageCount,
    duplicateRatio,
    duplicatePressure,
    maxDependencyDepth: out.maxDependencyDepth,
    depthPressure,
    breadthPressure,
    unusedDependencyCount: out.unusedDependencyCount,
    unusedDependencyPressure,
    totalPressure,
    scoreFloor: SCORE_FLOOR,
    score: Math.max(SCORE_FLOOR, 1 - totalPressure),
  }
}

const scoreBreakdownDiagnostic = (breakdown: RsDe02ScoreBreakdown): Diagnostic => ({
  severity: "info" as const,
  message: [
    `RS-DE-02 score ${breakdown.score.toFixed(3)} (total pressure ${breakdown.totalPressure.toFixed(3)}, floor ${breakdown.scoreFloor.toFixed(2)}):`,
    `duplicates ${breakdown.scoredDuplicateGroupCount} scored of ${breakdown.duplicateGroupCount} groups (${breakdown.platformShimDuplicateGroupCount} platform-shim) across ${breakdown.dependencyPackageCount} packages (+${breakdown.duplicatePressure.toFixed(3)}),`,
    `max depth ${breakdown.maxDependencyDepth} (+${breakdown.depthPressure.toFixed(3)}),`,
    `breadth ${breakdown.dependencyPackageCount} packages (+${breakdown.breadthPressure.toFixed(3)}),`,
    `unused dependencies ${breakdown.unusedDependencyCount} (+${breakdown.unusedDependencyPressure.toFixed(3)})`,
  ].join(" "),
  location: { file: "Cargo.lock" },
  data: {
    hash: hashScoreBreakdown(breakdown),
    kind: "score-breakdown",
    duplicateGroupCount: breakdown.duplicateGroupCount,
    platformShimDuplicateGroupCount: breakdown.platformShimDuplicateGroupCount,
    scoredDuplicateGroupCount: breakdown.scoredDuplicateGroupCount,
    dependencyPackageCount: breakdown.dependencyPackageCount,
    duplicateRatio: breakdown.duplicateRatio,
    duplicatePressure: breakdown.duplicatePressure,
    maxDependencyDepth: breakdown.maxDependencyDepth,
    depthPressure: breakdown.depthPressure,
    breadthPressure: breakdown.breadthPressure,
    unusedDependencyCount: breakdown.unusedDependencyCount,
    unusedDependencyPressure: breakdown.unusedDependencyPressure,
    totalPressure: breakdown.totalPressure,
    scoreFloor: breakdown.scoreFloor,
    score: breakdown.score,
  },
})

const computeRsDe02Output = async (
  project: RustProject,
  config: NormalizedRsDe02Config,
): Promise<RsDe02Output> => {
  const directDependencyNames = collectDirectDependencyNames(project)
  const unusedAnalysis = await detectUnusedDependencies(project)
  if (project.cargoLock === undefined) {
    return missingCargoLockOutput(project, directDependencyNames, unusedAnalysis, config)
  }

  const cargoLock = project.cargoLock
  const workspacePackageNames = collectWorkspacePackageNames(project)
  const packagesByName = groupCargoLockPackagesByName(cargoLock.packages)
  const packageByKey = cargoLockPackagesByKey(cargoLock.packages)
  const topLevelDependencies = topLevelDependencyDepths(
    directDependencyNames,
    workspacePackageNames,
    cargoLock.packages,
    packagesByName,
    packageByKey,
  )
  const duplicates = dependencyDuplicateGroups(cargoLock)

  return loadedCargoLockOutput(
    project,
    cargoLock,
    config,
    directDependencyNames,
    workspacePackageNames,
    topLevelDependencies,
    duplicates,
    unusedAnalysis,
  )
}

const collectDirectDependencyNames = (project: RustProject): ReadonlySet<string> =>
  new Set(
    project.manifests.flatMap((manifest) =>
      (manifest.dependencies ?? []).map((dependency) => dependency.packageName),
    ),
  )

const collectWorkspacePackageNames = (project: RustProject): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const manifest of project.manifests) {
    if (manifest.packageName !== undefined) {
      names.add(manifest.packageName)
    }
  }
  return names
}

interface UnusedDependencyAnalysis {
  readonly unusedDependencies: ReadonlyArray<UnusedDependencyInfo>
  readonly scannedSourceFileCount: number
}

interface DeclaredNormalDependency {
  readonly alias: string
  readonly packageName: string
}

const PLAIN_DEPENDENCIES_SECTION_PATTERN = /^\[dependencies\]$/
const PLAIN_DEPENDENCY_TABLE_SECTION_PATTERN = /^\[dependencies\.([A-Za-z0-9_-]+)\]$/
const MANIFEST_DEPENDENCY_KEY_PATTERN = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/
const MANIFEST_DOTTED_DEPENDENCY_KEY_PATTERN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\s*=\s*(.+)$/
const MANIFEST_PACKAGE_INLINE_PATTERN = /(?:^|[,{]\s*)package\s*=\s*"([^"]+)"/
const MANIFEST_PACKAGE_KEY_PATTERN = /^package\s*=\s*"([^"]+)"$/

// Parses only plain `[dependencies]` entries (not dev-, build-, or
// target-specific dependencies) so unused-dependency claims stay conservative:
// dev/build/conditional dependencies legitimately have no `src/` references.
const parsePlainDependencies = (raw: string): ReadonlyArray<DeclaredNormalDependency> => {
  const declared = new Map<string, string>()
  let inPlainSection = false
  let tableAlias: string | undefined
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = stripManifestLineComment(line).trim()
    if (trimmed.length === 0) continue
    if (trimmed.startsWith("[")) {
      inPlainSection = PLAIN_DEPENDENCIES_SECTION_PATTERN.test(trimmed)
      tableAlias = PLAIN_DEPENDENCY_TABLE_SECTION_PATTERN.exec(trimmed)?.[1]
      if (tableAlias !== undefined && !declared.has(tableAlias)) {
        declared.set(tableAlias, tableAlias)
      }
      continue
    }
    if (tableAlias !== undefined) {
      const packageMatch = MANIFEST_PACKAGE_KEY_PATTERN.exec(trimmed)
      if (packageMatch !== null) declared.set(tableAlias, packageMatch[1]!)
      continue
    }
    if (!inPlainSection) continue
    const dependencyMatch = MANIFEST_DEPENDENCY_KEY_PATTERN.exec(trimmed)
    if (dependencyMatch !== null) {
      const alias = dependencyMatch[1]!
      const value = dependencyMatch[2]!.trim()
      declared.set(alias, MANIFEST_PACKAGE_INLINE_PATTERN.exec(value)?.[1] ?? alias)
      continue
    }
    // Dotted-key declarations (`serde.workspace = true`, `foo.version = "1"`,
    // `bar.package = "real-name"`) were previously invisible to the parser.
    const dottedMatch = MANIFEST_DOTTED_DEPENDENCY_KEY_PATTERN.exec(trimmed)
    if (dottedMatch === null) continue
    const alias = dottedMatch[1]!
    const packageName =
      dottedMatch[2] === "package"
        ? /^"([^"]+)"$/.exec(dottedMatch[3]!.trim())?.[1]
        : undefined
    declared.set(alias, packageName ?? declared.get(alias) ?? alias)
  }
  return [...declared.entries()].map(([alias, packageName]) => ({ alias, packageName }))
}

const stripManifestLineComment = (line: string): string => {
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
    if (char === '"') {
      inString = !inString
      continue
    }
    if (char === "#" && !inString) return line.slice(0, index)
  }
  return line
}

const detectUnusedDependencies = async (
  project: RustProject,
): Promise<UnusedDependencyAnalysis> => {
  const unused: Array<UnusedDependencyInfo> = []
  let scannedSourceFileCount = 0
  // Packages whose lib target name differs from the package name (md-5
  // imports as `md5`, any `[lib] name =` rename) are resolvable from cargo
  // metadata — alias munging alone falsely flags them as unused.
  const libTargetNameByPackage = new Map<string, string>()
  for (const pkg of project.cargoMetadata?.packages ?? []) {
    const libTarget = pkg.targets.find((target) =>
      target.kind.some((kind) =>
        ["lib", "rlib", "dylib", "cdylib", "staticlib", "proc-macro"].includes(kind),
      ),
    )
    if (libTarget !== undefined) {
      libTargetNameByPackage.set(pkg.name, libTarget.name.replace(/-/g, "_"))
    }
  }
  for (const manifest of project.manifests) {
    const declared = parsePlainDependencies(
      await readFile(manifest.manifestPath, "utf8"),
    )
    if (declared.length === 0) continue
    const sourceFiles = project.sourceFiles.filter((file) =>
      file.startsWith(`${manifest.path}${sep}`),
    )
    // No scannable sources means absence of references cannot be proven, so
    // no unused-dependency claim is made for this manifest.
    if (sourceFiles.length === 0) continue
    const pending = new Map(
      declared.map((dependency) => {
        const aliasLibName = dependency.alias.replace(/-/g, "_")
        const metadataLibName = libTargetNameByPackage.get(
          resolveDeclaredPackageName(manifest, dependency),
        )
        const candidates = [
          ...new Set([aliasLibName, metadataLibName]),
        ].filter((candidate): candidate is string => candidate !== undefined)
        return [
          dependency.alias,
          {
            ...dependency,
            libName: metadataLibName ?? aliasLibName,
            pattern: new RegExp(
              candidates.map((candidate) => `\\b${candidate}\\b`).join("|"),
            ),
          },
        ] as const
      }),
    )
    for (const file of sourceFiles) {
      if (pending.size === 0) break
      const content = await readFile(file, "utf8")
      scannedSourceFileCount += 1
      for (const [alias, dependency] of [...pending]) {
        if (dependency.pattern.test(content)) pending.delete(alias)
      }
    }
    const manifestFile = relative(project.worktreePath, manifest.manifestPath)
    for (const dependency of [...pending.values()].sort((left, right) =>
      left.alias.localeCompare(right.alias),
    )) {
      unused.push({
        manifestName: manifest.name,
        manifestFile,
        alias: dependency.alias,
        packageName: resolveDeclaredPackageName(manifest, dependency),
        libName: dependency.libName,
      })
    }
  }
  return { unusedDependencies: unused, scannedSourceFileCount }
}

const resolveDeclaredPackageName = (
  manifest: RustManifestInfo,
  dependency: DeclaredNormalDependency,
): string => {
  if (dependency.packageName !== dependency.alias) return dependency.packageName
  const resolved = (manifest.dependencies ?? []).find(
    (entry) => entry.alias === dependency.alias,
  )
  return resolved?.packageName ?? dependency.packageName
}

const missingCargoLockOutput = (
  project: RustProject,
  directDependencyNames: ReadonlySet<string>,
  unusedAnalysis: UnusedDependencyAnalysis,
  config: NormalizedRsDe02Config,
): RsDe02Output => ({
  duplicates: [],
  topLevelDependencies: [],
  duplicateCount: 0,
  lockfileStatus: "missing",
  packageCount: 0,
  dependencyPackageCount: 0,
  maxDependencyDepth: 0,
  unusedDependencies: unusedAnalysis.unusedDependencies,
  unusedDependencyCount: unusedAnalysis.unusedDependencies.length,
  scannedSourceFileCount: unusedAnalysis.scannedSourceFileCount,
  manifestCount: project.manifests.length,
  directDependencyCount: directDependencyNames.size,
  diagnosticLimit: config.top_n_diagnostics,
  analysisMode: "cargo-lock",
})

const loadedCargoLockOutput = (
  project: RustProject,
  cargoLock: NonNullable<RustProject["cargoLock"]>,
  config: NormalizedRsDe02Config,
  directDependencyNames: ReadonlySet<string>,
  workspacePackageNames: ReadonlySet<string>,
  topLevelDependencies: ReadonlyArray<TopLevelDependencyDepth>,
  duplicates: ReadonlyArray<DependencyDuplicateGroup>,
  unusedAnalysis: UnusedDependencyAnalysis,
): RsDe02Output => ({
  duplicates,
  topLevelDependencies,
  duplicateCount: duplicates.length,
  lockfileStatus: "loaded",
  packageCount: cargoLock.packages.length,
  dependencyPackageCount: countDependencyPackages(cargoLock.packages, workspacePackageNames),
  maxDependencyDepth: topLevelDependencies.reduce(
    (max, entry) => Math.max(max, entry.maxDepth),
    0,
  ),
  unusedDependencies: unusedAnalysis.unusedDependencies,
  unusedDependencyCount: unusedAnalysis.unusedDependencies.length,
  scannedSourceFileCount: unusedAnalysis.scannedSourceFileCount,
  manifestCount: project.manifests.length,
  directDependencyCount: directDependencyNames.size,
  diagnosticLimit: config.top_n_diagnostics,
  analysisMode: "cargo-lock",
})

const cargoLockPackagesByKey = (
  packages: ReadonlyArray<CargoLockPackage>,
): ReadonlyMap<string, CargoLockPackage> =>
  new Map(
    packages.map((pkg) => [
      packageKey(pkg.name, pkg.version, pkg.source),
      pkg,
    ] as const),
  )

const groupCargoLockPackagesByName = (
  packages: ReadonlyArray<CargoLockPackage>,
): ReadonlyMap<string, ReadonlyArray<CargoLockPackage>> => {
  const packagesByName = new Map<string, Array<CargoLockPackage>>()
  for (const pkg of packages) {
    const bucket = packagesByName.get(pkg.name) ?? []
    bucket.push(pkg)
    packagesByName.set(pkg.name, bucket)
  }
  return packagesByName
}

const topLevelDependencyDepths = (
  directDependencyNames: ReadonlySet<string>,
  workspacePackageNames: ReadonlySet<string>,
  lockPackages: ReadonlyArray<CargoLockPackage>,
  packagesByName: ReadonlyMap<string, ReadonlyArray<CargoLockPackage>>,
  packageByKey: ReadonlyMap<string, CargoLockPackage>,
): ReadonlyArray<TopLevelDependencyDepth> =>
  [...topLevelDependencyRoots(
    directDependencyNames,
    workspacePackageNames,
    lockPackages,
    packagesByName,
  ).entries()]
    .map(([name, roots]) =>
      describeTopLevelDependency(name, roots, packageByKey, packagesByName)
    )
    .filter((entry): entry is TopLevelDependencyDepth => entry !== undefined)
    .sort((left, right) => right.maxDepth - left.maxDepth || left.name.localeCompare(right.name))

const isPlatformShimCrate = (name: string): boolean =>
  PLATFORM_SHIM_PATTERNS.some((pattern) => pattern.test(name))

const dependencyDuplicateGroups = (
  cargoLock: NonNullable<RustProject["cargoLock"]>,
): ReadonlyArray<DependencyDuplicateGroup> =>
  findDuplicateCargoLockPackages(cargoLock).map((group) => ({
    name: group.name,
    versions: group.versions,
    instanceCount: group.packages.length,
    platformShim: isPlatformShimCrate(group.name),
  }))

const countDependencyPackages = (
  packages: ReadonlyArray<CargoLockPackage>,
  workspacePackageNames: ReadonlySet<string>,
): number => packages.filter((pkg) => !workspacePackageNames.has(pkg.name)).length

const normalizeRsDe02Config = (config: RsDe02Config): NormalizedRsDe02Config => ({
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsDe02FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-DE-02-dependency-tree", RS_DE_02_FACTOR_DEFINITIONS)

const hashDuplicateGroup = (group: DependencyDuplicateGroup): string =>
  computeDiagnosticHash(
    [
      "duplicate",
      group.name,
      ...group.versions,
      group.instanceCount,
    ].join("|"),
  )

const hashDependencyDepth = (entry: TopLevelDependencyDepth): string =>
  computeDiagnosticHash(
    [
      "depth",
      entry.name,
      entry.rootInstances,
      entry.maxDepth,
      entry.reachablePackages,
    ].join("|"),
  )

const hashUnusedDependency = (entry: UnusedDependencyInfo): string =>
  computeDiagnosticHash(
    [
      "unused-dependency",
      entry.manifestName,
      entry.alias,
      entry.packageName,
      entry.libName,
    ].join("|"),
  )

const hashScoreBreakdown = (breakdown: RsDe02ScoreBreakdown): string =>
  computeDiagnosticHash(
    [
      "score-breakdown",
      breakdown.duplicateGroupCount,
      breakdown.platformShimDuplicateGroupCount,
      breakdown.scoredDuplicateGroupCount,
      breakdown.dependencyPackageCount,
      breakdown.maxDependencyDepth,
      breakdown.unusedDependencyCount,
    ].join("|"),
  )

const describeTopLevelDependency = (
  name: string,
  rootKeys: ReadonlySet<string>,
  packageByKey: ReadonlyMap<string, CargoLockPackage>,
  packagesByName: ReadonlyMap<string, ReadonlyArray<CargoLockPackage>>,
): TopLevelDependencyDepth | undefined => {
  if (rootKeys.size === 0) return undefined

  const visited = new Set<string>()
  const queue = [...rootKeys].map((key) => ({ key, depth: 0 }))
  let maxDepth = 0

  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined || visited.has(current.key)) continue
    visited.add(current.key)
    maxDepth = Math.max(maxDepth, current.depth)
    const pkg = packageByKey.get(current.key)
    if (pkg === undefined) continue
    for (const dependency of pkg.dependencies) {
      for (const nextKey of parseDependencyKeys(dependency, packagesByName)) {
        if (!visited.has(nextKey)) {
          queue.push({ key: nextKey, depth: current.depth + 1 })
        }
      }
    }
  }

  return {
    name,
    rootInstances: rootKeys.size,
    maxDepth,
    reachablePackages: visited.size,
  }
}

const topLevelDependencyRoots = (
  directDependencyNames: ReadonlySet<string>,
  workspacePackages: ReadonlySet<string>,
  lockPackages: ReadonlyArray<CargoLockPackage>,
  packagesByName: ReadonlyMap<string, ReadonlyArray<CargoLockPackage>>,
): ReadonlyMap<string, ReadonlySet<string>> => {
  const topLevelNames = new Set(
    [...directDependencyNames].filter((name) => !workspacePackages.has(name)),
  )
  const roots = new Map<string, Set<string>>()

  for (const workspacePackage of lockPackages.filter((pkg) => workspacePackages.has(pkg.name))) {
    for (const dependency of workspacePackage.dependencies) {
      const name = dependencyName(dependency)
      if (!topLevelNames.has(name)) continue
      const bucket = roots.get(name) ?? new Set<string>()
      for (const key of parseDependencyKeys(dependency, packagesByName)) {
        bucket.add(key)
      }
      roots.set(name, bucket)
    }
  }

  for (const name of topLevelNames) {
    if (roots.has(name)) continue
    roots.set(
      name,
      new Set(
        (packagesByName.get(name) ?? []).map((pkg) =>
          packageKey(pkg.name, pkg.version, pkg.source),
        ),
      ),
    )
  }

  return roots
}

const parseDependencyKeys = (
  dependency: string,
  packagesByName: ReadonlyMap<string, ReadonlyArray<CargoLockPackage>>,
): ReadonlyArray<string> => {
  const trimmed = dependency.trim()
  const match = /^(\S+)\s+([^\s]+)(?:\s+\((.+)\))?$/.exec(trimmed)
  if (match === null) {
    const candidates = packagesByName.get(trimmed) ?? []
    return disambiguatedPackageKeys(candidates)
  }
  const name = match[1]!
  const version = match[2]!
  const source = match[3]
  const exactKey = packageKey(name, version, source)
  const sameName = packagesByName.get(name) ?? []
  if (source !== undefined) {
    return sameName.some((pkg) => packageKey(pkg.name, pkg.version, pkg.source) === exactKey)
      ? [exactKey]
      : []
  }
  const sameVersion = sameName.filter((pkg) => pkg.version === version)
  return sameVersion.some((pkg) => packageKey(pkg.name, pkg.version, pkg.source) === exactKey)
    ? [exactKey]
    : disambiguatedPackageKeys(sameVersion)
}

const dependencyName = (dependency: string): string => dependency.trim().split(/\s+/, 1)[0] ?? ""

const disambiguatedPackageKeys = (
  candidates: ReadonlyArray<CargoLockPackage>,
): ReadonlyArray<string> => {
  if (candidates.length === 1) {
    const [pkg] = candidates
    return pkg === undefined ? [] : [packageKey(pkg.name, pkg.version, pkg.source)]
  }
  const pathCandidates = candidates.filter((pkg) => pkg.source === undefined)
  if (pathCandidates.length === 1) {
    const [pkg] = pathCandidates
    return pkg === undefined ? [] : [packageKey(pkg.name, pkg.version, pkg.source)]
  }
  return []
}

const packageKey = (
  name: string,
  version: string,
  source: string | undefined,
): string => `${name}@${version}@${source ?? "path"}`
