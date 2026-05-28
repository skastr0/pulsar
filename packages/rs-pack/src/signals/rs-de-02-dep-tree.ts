import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  findDuplicateCargoLockPackages,
  type CargoLockPackage,
} from "../lock-file.js"
import { RustProjectTag } from "../project.js"

const RsDe02Config = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
type RsDe02Config = typeof RsDe02Config.Type

interface DependencyDuplicateGroup {
  readonly name: string
  readonly versions: ReadonlyArray<string>
  readonly instanceCount: number
}

interface TopLevelDependencyDepth {
  readonly name: string
  readonly rootInstances: number
  readonly maxDepth: number
  readonly reachablePackages: number
}

interface RsDe02Output {
  readonly duplicates: ReadonlyArray<DependencyDuplicateGroup>
  readonly topLevelDependencies: ReadonlyArray<TopLevelDependencyDepth>
  readonly duplicateCount: number
  readonly lockfileStatus: "loaded" | "missing"
  readonly packageCount: number
  readonly dependencyPackageCount: number
  readonly manifestCount: number
  readonly directDependencyCount: number
  readonly diagnosticLimit: number
  readonly analysisMode: "cargo-lock"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10

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
  cacheVersion: "cargo-lock-dependency-tree-workspace-deps-v1",
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
        try: async (): Promise<RsDe02Output> => {
          const directDependencyNames = new Set(
            project.manifests.flatMap((manifest) =>
              (manifest.dependencies ?? []).map((dependency) => dependency.packageName),
            ),
          )
          if (project.cargoLock === undefined) {
            return {
              duplicates: [],
              topLevelDependencies: [],
              duplicateCount: 0,
              lockfileStatus: "missing",
              packageCount: 0,
              dependencyPackageCount: 0,
              manifestCount: project.manifests.length,
              directDependencyCount: directDependencyNames.size,
              diagnosticLimit: normalizedConfig.top_n_diagnostics,
              analysisMode: "cargo-lock",
            }
          }

          const workspacePackages = new Set(
            project.manifests
              .map((manifest) => manifest.packageName)
              .filter((name): name is string => name !== undefined),
          )
          const dependencyPackageCount = project.cargoLock.packages.filter(
            (pkg) => !workspacePackages.has(pkg.name),
          ).length

          const packageByKey = new Map(
            project.cargoLock.packages.map((pkg) => [
              packageKey(pkg.name, pkg.version, pkg.source),
              pkg,
            ] as const),
          )
          const packagesByName = new Map<string, Array<CargoLockPackage>>()
          for (const pkg of project.cargoLock.packages) {
            const bucket = packagesByName.get(pkg.name) ?? []
            bucket.push(pkg)
            packagesByName.set(pkg.name, bucket)
          }
          const topLevelRoots = topLevelDependencyRoots(
            directDependencyNames,
            workspacePackages,
            project.cargoLock.packages,
            packagesByName,
          )

          const topLevelDependencies = [...topLevelRoots.entries()]
            .map(([name, roots]) =>
              describeTopLevelDependency(name, roots, packageByKey, packagesByName)
            )
            .filter((entry): entry is TopLevelDependencyDepth => entry !== undefined)
            .sort((left, right) => right.maxDepth - left.maxDepth || left.name.localeCompare(right.name))

          const duplicates = findDuplicateCargoLockPackages(project.cargoLock).map((group) => ({
            name: group.name,
            versions: group.versions,
            instanceCount: group.packages.length,
          }))

          return {
            duplicates,
            topLevelDependencies,
            duplicateCount: duplicates.length,
            lockfileStatus: "loaded",
            packageCount: project.cargoLock.packages.length,
            dependencyPackageCount,
            manifestCount: project.manifests.length,
            directDependencyCount: directDependencyNames.size,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "cargo-lock",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-02-dependency-tree", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.lockfileStatus === "missing") return 1
    const depthPenalty = Math.min(
      0.5,
      out.topLevelDependencies.reduce((max, entry) => Math.max(max, entry.maxDepth), 0) / 20,
    )
    const duplicatePenalty = Math.min(0.5, out.duplicateCount / 10)
    const breadthPenalty = Math.min(
      0.2,
      Math.max(0, out.dependencyPackageCount - 5) / 100,
    )
    return Math.max(0, 1 - depthPenalty - duplicatePenalty - breadthPenalty)
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

    const duplicateDiagnostics = out.duplicates.map((group) => ({
      severity: "warn" as const,
      message: `Duplicate crate versions for ${group.name}: ${group.versions.join(", ")}`,
      location: { file: "Cargo.lock" },
      data: {
        hash: hashDuplicateGroup(group),
        name: group.name,
        versions: group.versions,
        instanceCount: group.instanceCount,
      },
    }))
    const depthDiagnostics = out.topLevelDependencies
      .filter((entry) => entry.maxDepth > 0)
      .map((entry) => ({
        severity: entry.maxDepth >= 5 ? ("warn" as const) : ("info" as const),
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
    return [...duplicateDiagnostics, ...depthDiagnostics].slice(0, out.diagnosticLimit)
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
