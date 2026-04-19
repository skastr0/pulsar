import { join } from "node:path"
import {
  SignalContextTag,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { readBunLockFile } from "../lockfiles/bun-lock.js"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import {
  dependencyNamesOf,
  isBuiltinModuleName,
  normalizePackageSpecifier,
  packageDisplayName,
  packageForFile,
  workspacePackageNames,
} from "./shared-workspace.js"

export const TsDe04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsDe04Config = typeof TsDe04Config.Type

export interface DependencyMismatch {
  readonly dependencyName: string
  readonly files: ReadonlyArray<string>
}

export interface UnusedDeclaredDependency {
  readonly dependencyName: string
}

export interface PackageDependencyHealth {
  readonly packagePath: string
  readonly packageName: string
  readonly importedButNotDeclared: ReadonlyArray<DependencyMismatch>
  readonly declaredButUnused: ReadonlyArray<UnusedDeclaredDependency>
  readonly transitiveUsedDirectly: ReadonlyArray<DependencyMismatch>
  readonly devInProd: ReadonlyArray<DependencyMismatch>
}

export interface TsDe04Output {
  readonly packages: ReadonlyArray<PackageDependencyHealth>
  readonly missingCount: number
  readonly unusedCount: number
  readonly diagnosticLimit: number
}

type UsageBucket = {
  readonly files: Set<string>
  readonly prodFiles: Set<string>
}

export const TsDe04: Signal<
  TsDe04Config,
  TsDe04Output,
  TsProjectTag | TsPackageInfoTag | SignalContextTag
> = {
  id: "TS-DE-04",
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: TsDe04Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    test_globs: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const context = yield* SignalContextTag

      const result = yield* Effect.tryPromise({
        try: async (): Promise<TsDe04Output> => {
          const resolvedPackageNames = await readResolvedPackageNames(context.worktreePath)
          const workspaceNames = workspacePackageNames(packages)
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          const usageByPackage = new Map<string, Map<string, UsageBucket>>()

          for (const sourceFile of sourceFiles) {
            const owningPackage = packageForFile(sourceFile.getFilePath(), packages)
            if (owningPackage?.manifest === undefined) continue
            const packageKey = owningPackage.path
            const isProdFile = !matchesAnyGlob(sourceFile.getFilePath(), config.test_globs)
            const bucket = usageByPackage.get(packageKey) ?? new Map<string, UsageBucket>()

            for (const declaration of [
              ...sourceFile.getImportDeclarations(),
              ...sourceFile.getExportDeclarations(),
            ]) {
              const target = declaration.getModuleSpecifierSourceFile()?.getFilePath()
              if (target !== undefined) continue
              const moduleSpecifier = declaration.getModuleSpecifierValue()
              if (moduleSpecifier === undefined) continue
              const packageName = normalizePackageSpecifier(moduleSpecifier)
              if (packageName === undefined || isBuiltinModuleName(packageName)) continue

              const usage = bucket.get(packageName) ?? { files: new Set<string>(), prodFiles: new Set<string>() }
              usage.files.add(sourceFile.getFilePath())
              if (isProdFile) {
                usage.prodFiles.add(sourceFile.getFilePath())
              }
              bucket.set(packageName, usage)
            }

            usageByPackage.set(packageKey, bucket)
          }

          const packageHealth = packages
            .filter((pkg): pkg is PackageInfo & { manifest: PackageManifest } => pkg.manifest !== undefined)
            .map((pkg) => analyzePackageHealth(pkg, usageByPackage.get(pkg.path), workspaceNames, resolvedPackageNames))
            .sort((left, right) => left.packageName.localeCompare(right.packageName))

          return {
            packages: packageHealth,
            missingCount: packageHealth.reduce(
              (sum, pkg) => sum + pkg.importedButNotDeclared.length,
              0,
            ),
            unusedCount: packageHealth.reduce((sum, pkg) => sum + pkg.declaredButUnused.length, 0),
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-04",
            message: String(cause),
            cause,
          }),
      })

      return result
    }),
  score: (out) => {
    if (out.missingCount > 0 || out.unusedCount > 0) return 0
    const packageCount = Math.max(1, out.packages.length)
    const softViolations = out.packages.reduce(
      (sum, pkg) => sum + pkg.transitiveUsedDirectly.length + pkg.devInProd.length,
      0,
    )
    return Math.max(0, 1 - softViolations / packageCount)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []

    for (const pkg of out.packages) {
      for (const mismatch of pkg.importedButNotDeclared) {
        diagnostics.push({
          severity: "block" as const,
          message:
            `Missing dependency in ${pkg.packageName}: ${mismatch.dependencyName} ` +
            `imported in ${mismatch.files.join(", ")}`,
          location: { file: mismatch.files[0] ?? pkg.packagePath },
          data: {
            hash: computeDiagnosticHash(`${pkg.packageName}|missing|${mismatch.dependencyName}`),
            packageName: pkg.packageName,
            dependencyName: mismatch.dependencyName,
            files: mismatch.files.slice(),
          },
        })
      }

      for (const unused of pkg.declaredButUnused) {
        diagnostics.push({
          severity: "block" as const,
          message: `Unused declared dependency in ${pkg.packageName}: ${unused.dependencyName}`,
          location: { file: join(pkg.packagePath, "package.json") },
          data: {
            hash: computeDiagnosticHash(`${pkg.packageName}|unused|${unused.dependencyName}`),
            packageName: pkg.packageName,
            dependencyName: unused.dependencyName,
          },
        })
      }

      for (const mismatch of pkg.transitiveUsedDirectly) {
        diagnostics.push({
          severity: "warn" as const,
          message:
            `Transitive dependency used directly in ${pkg.packageName}: ` +
            `${mismatch.dependencyName} via ${mismatch.files.join(", ")}`,
          location: { file: mismatch.files[0] ?? pkg.packagePath },
          data: {
            packageName: pkg.packageName,
            dependencyName: mismatch.dependencyName,
            files: mismatch.files.slice(),
          },
        })
      }

      for (const mismatch of pkg.devInProd) {
        diagnostics.push({
          severity: "warn" as const,
          message:
            `Production code imports devDependency in ${pkg.packageName}: ` +
            `${mismatch.dependencyName} via ${mismatch.files.join(", ")}`,
          location: { file: mismatch.files[0] ?? pkg.packagePath },
          data: {
            packageName: pkg.packageName,
            dependencyName: mismatch.dependencyName,
            files: mismatch.files.slice(),
          },
        })
      }
    }

    return diagnostics.slice(0, out.diagnosticLimit)
  },
}

const readResolvedPackageNames = async (worktreePath: string): Promise<ReadonlySet<string>> => {
  try {
    const parsed = await readBunLockFile(join(worktreePath, "bun.lock"))
    return parsed.packageNames
  } catch {
    return new Set<string>()
  }
}

const analyzePackageHealth = (
  pkg: PackageInfo & { manifest: PackageManifest },
  usage: ReadonlyMap<string, UsageBucket> | undefined,
  workspaceNames: ReadonlySet<string>,
  resolvedPackageNames: ReadonlySet<string>,
): PackageDependencyHealth => {
  const productionDeclared = dependencyNamesOf(pkg.manifest, [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
  const unusedEligible = dependencyNamesOf(pkg.manifest, ["dependencies", "optionalDependencies"])
  const devDeclared = dependencyNamesOf(pkg.manifest, ["devDependencies"])

  const importedButNotDeclared: Array<DependencyMismatch> = []
  const transitiveUsedDirectly: Array<DependencyMismatch> = []
  const devInProd: Array<DependencyMismatch> = []

  for (const dependencyName of [...(usage?.keys() ?? [])].sort((left, right) => left.localeCompare(right))) {
    const usageBucket = usage?.get(dependencyName)
    if (usageBucket === undefined) continue
    const files = [...usageBucket.files].sort((left, right) => left.localeCompare(right))

    if (productionDeclared.has(dependencyName)) continue

    if (devDeclared.has(dependencyName)) {
      if (usageBucket.prodFiles.size > 0) {
        devInProd.push({ dependencyName, files })
      }
      continue
    }

    if (workspaceNames.has(dependencyName) || !resolvedPackageNames.has(dependencyName)) {
      importedButNotDeclared.push({ dependencyName, files })
      continue
    }

    transitiveUsedDirectly.push({ dependencyName, files })
  }

  const declaredButUnused = [...unusedEligible]
    .filter((dependencyName) => usage?.has(dependencyName) !== true)
    .sort((left, right) => left.localeCompare(right))
    .map((dependencyName) => ({ dependencyName }))

  return {
    packagePath: pkg.path,
    packageName: packageDisplayName(pkg) ?? pkg.name,
    importedButNotDeclared,
    declaredButUnused,
    transitiveUsedDirectly,
    devInProd,
  }
}
