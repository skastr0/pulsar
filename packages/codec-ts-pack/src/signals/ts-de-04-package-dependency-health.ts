import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
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

type TsconfigPathAlias = {
  readonly pattern: string
  readonly replacements: ReadonlyArray<string>
  readonly baseDir: string
}

type TsconfigAliasConfig = {
  readonly aliases: ReadonlyArray<TsconfigPathAlias>
  readonly baseDir: string
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
          const pathAliasesByPackage = await readPathAliasesByPackage(packages)
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
              const moduleSpecifier = declaration.getModuleSpecifierValue()
              if (moduleSpecifier === undefined) continue
              const packageName = normalizePackageSpecifier(moduleSpecifier)
              if (packageName === undefined || isBuiltinModuleName(packageName)) continue

              const target = declaration.getModuleSpecifierSourceFile()?.getFilePath()
              if (target !== undefined && !target.includes("/node_modules/")) {
                const targetPackage = packageForFile(target, packages)
                if (targetPackage?.path === owningPackage.path) continue
              }
              if (
                isLocalPathAliasUsage(
                  moduleSpecifier,
                  packageName,
                  owningPackage,
                  pathAliasesByPackage.get(owningPackage.path),
                  workspaceNames,
                  context.worktreePath,
                )
              ) {
                continue
              }

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

const readPathAliasesByPackage = async (
  packages: ReadonlyArray<PackageInfo>,
): Promise<ReadonlyMap<string, ReadonlyArray<TsconfigPathAlias>>> => {
  const entries = await Promise.all(
    packages.map(async (pkg): Promise<[string, ReadonlyArray<TsconfigPathAlias>]> => [
      pkg.path,
      await readPathAliases(pkg.tsconfigPath),
    ]),
  )
  return new Map(entries)
}

const readPathAliases = async (tsconfigPath: string): Promise<ReadonlyArray<TsconfigPathAlias>> => {
  const config = await readPathAliasConfig(tsconfigPath, new Set<string>())
  return config.aliases
}

const readPathAliasConfig = async (
  tsconfigPath: string,
  visited: Set<string>,
): Promise<TsconfigAliasConfig> => {
  const loaded = await readTsconfig(tsconfigPath)
  if (loaded === undefined) return { aliases: [], baseDir: dirname(tsconfigPath) }

  const normalizedPath = resolve(loaded.path)
  if (visited.has(normalizedPath)) return { aliases: [], baseDir: dirname(normalizedPath) }
  visited.add(normalizedPath)

  const inherited = await readInheritedAliasConfig(loaded.config, normalizedPath, visited)
  const compilerOptions = asRecord(loaded.config.compilerOptions)
  const baseUrl = asString(compilerOptions?.baseUrl)
  const baseDir = baseUrl === undefined ? inherited.baseDir : resolve(dirname(normalizedPath), baseUrl)
  const paths = asRecord(compilerOptions?.paths)

  if (paths === undefined) return { aliases: inherited.aliases, baseDir }

  return {
    aliases: pathAliasesFromCompilerOptions(paths, baseDir),
    baseDir,
  }
}

const readInheritedAliasConfig = async (
  config: Record<string, unknown>,
  tsconfigPath: string,
  visited: Set<string>,
): Promise<TsconfigAliasConfig> => {
  const extendedConfigs = asStringArray(config.extends)
  let inherited: TsconfigAliasConfig = { aliases: [], baseDir: dirname(tsconfigPath) }

  for (const extendedConfig of extendedConfigs) {
    const extendedPath = resolveTsconfigExtendsPath(extendedConfig, tsconfigPath)
    inherited = await readPathAliasConfig(extendedPath, visited)
  }

  return inherited
}

const readTsconfig = async (
  tsconfigPath: string,
): Promise<{ readonly path: string; readonly config: Record<string, unknown> } | undefined> => {
  for (const candidate of tsconfigCandidates(tsconfigPath)) {
    try {
      const parsed = asRecord(JSON.parse(await readFile(candidate, "utf8")))
      if (parsed !== undefined) return { path: candidate, config: parsed }
    } catch {
      continue
    }
  }
  return undefined
}

const tsconfigCandidates = (tsconfigPath: string): ReadonlyArray<string> => {
  if (tsconfigPath.endsWith(".json")) return [tsconfigPath]
  return [tsconfigPath, `${tsconfigPath}.json`, join(tsconfigPath, "tsconfig.json")]
}

const resolveTsconfigExtendsPath = (extendedConfig: string, tsconfigPath: string): string => {
  if (extendedConfig.startsWith(".") || extendedConfig.startsWith("/")) {
    return resolve(dirname(tsconfigPath), extendedConfig)
  }
  return resolve(dirname(tsconfigPath), extendedConfig)
}

const pathAliasesFromCompilerOptions = (
  paths: Record<string, unknown>,
  baseDir: string,
): ReadonlyArray<TsconfigPathAlias> =>
  Object.entries(paths).flatMap(([pattern, rawReplacements]) => {
    const replacements = asStringArray(rawReplacements)
    return replacements.length > 0 ? [{ pattern, replacements, baseDir }] : []
  })

const isLocalPathAliasUsage = (
  moduleSpecifier: string,
  packageName: string,
  owningPackage: PackageInfo,
  aliases: ReadonlyArray<TsconfigPathAlias> | undefined,
  workspaceNames: ReadonlySet<string>,
  worktreePath: string,
): boolean => {
  if (aliases === undefined || aliases.length === 0) return false
  if (workspaceNames.has(packageName)) return false

  return aliases.some((alias) =>
    resolvePathAliasTargets(alias, moduleSpecifier).some(
      (target) =>
        !target.includes("/node_modules/") &&
        (target === owningPackage.path ||
          target.startsWith(`${owningPackage.path}/`) ||
          target.startsWith(`${worktreePath}/`)),
    ),
  )
}

const resolvePathAliasTargets = (
  alias: TsconfigPathAlias,
  moduleSpecifier: string,
): ReadonlyArray<string> => {
  const starIndex = alias.pattern.indexOf("*")
  if (starIndex === -1) {
    if (moduleSpecifier !== alias.pattern) return []
    return alias.replacements.map((replacement) => resolve(alias.baseDir, replacement))
  }

  const prefix = alias.pattern.slice(0, starIndex)
  const suffix = alias.pattern.slice(starIndex + 1)
  if (!moduleSpecifier.startsWith(prefix) || !moduleSpecifier.endsWith(suffix)) return []

  const matched = moduleSpecifier.slice(prefix.length, moduleSpecifier.length - suffix.length)
  return alias.replacements.map((replacement) =>
    resolve(alias.baseDir, replacement.replace("*", matched)),
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

const asStringArray = (value: unknown): ReadonlyArray<string> =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : []

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
