import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { readFile } from "node:fs/promises"
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

export interface DependencyDuplicateGroup {
  readonly name: string
  readonly versions: ReadonlyArray<string>
  readonly instanceCount: number
}

export interface TopLevelDependencyDepth {
  readonly name: string
  readonly rootInstances: number
  readonly maxDepth: number
  readonly reachablePackages: number
}

export interface RsDe02Output {
  readonly duplicates: ReadonlyArray<DependencyDuplicateGroup>
  readonly topLevelDependencies: ReadonlyArray<TopLevelDependencyDepth>
  readonly duplicateCount: number
  readonly lockfileStatus: "loaded" | "missing"
  readonly analysisMode: "cargo-lock"
}

export const RsDe02: Signal<RsDe02Config, RsDe02Output, RustProjectTag> = {
  id: "RS-DE-02-dependency-tree",
  title: "Dependency tree",
  aliases: ["RS-DE-02"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: RsDe02Config,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsDe02Output> => {
          if (project.cargoLock === undefined) {
            return {
              duplicates: [],
              topLevelDependencies: [],
              duplicateCount: 0,
              lockfileStatus: "missing",
              analysisMode: "cargo-lock",
            }
          }

          const topLevelNames = new Set<string>()
          for (const manifest of project.manifests) {
            for (const dependencyName of await parseManifestDependencyNames(manifest.manifestPath)) {
              topLevelNames.add(dependencyName)
            }
          }
          const workspacePackages = new Set(
            project.manifests
              .map((manifest) => manifest.packageName)
              .filter((name): name is string => name !== undefined),
          )
          for (const workspacePackage of workspacePackages) {
            topLevelNames.delete(workspacePackage)
          }

          const packageByKey = new Map(
            project.cargoLock.packages.map((pkg) => [packageKey(pkg.name, pkg.version), pkg] as const),
          )
          const packagesByName = new Map<string, Array<CargoLockPackage>>()
          for (const pkg of project.cargoLock.packages) {
            const bucket = packagesByName.get(pkg.name) ?? []
            bucket.push(pkg)
            packagesByName.set(pkg.name, bucket)
          }

          const topLevelDependencies = [...topLevelNames]
            .map((name) => describeTopLevelDependency(name, packagesByName, packageByKey))
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
    return Math.max(0, 1 - depthPenalty - duplicatePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.lockfileStatus === "missing") {
      return [{ severity: "warn", message: "RS-DE-02 could not find Cargo.lock for dependency analysis" }]
    }

    const duplicateDiagnostics = out.duplicates.map((group) => ({
      severity: "warn" as const,
      message: `Duplicate crate versions for ${group.name}: ${group.versions.join(", ")}`,
      data: {
        name: group.name,
        versions: group.versions,
        instanceCount: group.instanceCount,
      },
    }))
    const depthDiagnostics = out.topLevelDependencies.slice(0, 5).map((entry) => ({
      severity: entry.maxDepth >= 5 ? ("warn" as const) : ("info" as const),
      message: `Top-level dependency ${entry.name} reaches depth ${entry.maxDepth}`,
      data: {
        name: entry.name,
        maxDepth: entry.maxDepth,
        reachablePackages: entry.reachablePackages,
        rootInstances: entry.rootInstances,
      },
    }))
    return [...duplicateDiagnostics, ...depthDiagnostics].slice(0, 10)
  },
}

const describeTopLevelDependency = (
  name: string,
  packagesByName: ReadonlyMap<string, ReadonlyArray<CargoLockPackage>>,
  packageByKey: ReadonlyMap<string, CargoLockPackage>,
): TopLevelDependencyDepth | undefined => {
  const roots = packagesByName.get(name)
  if (roots === undefined || roots.length === 0) return undefined

  const visited = new Set<string>()
  const queue = roots.map((pkg) => ({ key: packageKey(pkg.name, pkg.version), depth: 0 }))
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
    rootInstances: roots.length,
    maxDepth,
    reachablePackages: visited.size,
  }
}

const parseDependencyKeys = (
  dependency: string,
  packagesByName: ReadonlyMap<string, ReadonlyArray<CargoLockPackage>>,
): ReadonlyArray<string> => {
  const match = /^(\S+)\s+([^\s]+)(?:\s+\(.+\))?$/.exec(dependency.trim())
  if (match === null) return []
  const name = match[1]!
  const version = match[2]!
  const exactKey = packageKey(name, version)
  const sameName = packagesByName.get(name) ?? []
  return sameName.some((pkg) => packageKey(pkg.name, pkg.version) === exactKey)
    ? [exactKey]
    : sameName.map((pkg) => packageKey(pkg.name, pkg.version))
}

const packageKey = (name: string, version: string): string => `${name}@${version}`

const parseManifestDependencyNames = async (manifestPath: string): Promise<ReadonlySet<string>> => {
  const raw = await readFile(manifestPath, "utf8")
  const names = new Set<string>()
  let inDependencies = false
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith("[")) {
      inDependencies =
        /^\[(?:workspace\.)?(?:target\..+\.)?(?:dev-|build-)?dependencies\]$/.test(trimmed)
      continue
    }
    if (!inDependencies || trimmed.length === 0 || trimmed.startsWith("#")) continue
    const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(trimmed)
    if (match === null) continue
    const key = match[1]!
    const value = match[2]!
    const packageMatch = /package\s*=\s*"([^"]+)"/.exec(value)
    names.add(packageMatch?.[1] ?? key)
  }
  return names
}
