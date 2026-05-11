import { Schema } from "effect"
import type { TsconfigPathAlias } from "./ts-de-04-path-aliases.js"

export const TsDe04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  dependency_aliases: Schema.Record({ key: Schema.String, value: Schema.String }),
  allow_dev_dependency_in_prod: Schema.Array(Schema.String),
})
export type TsDe04Config = typeof TsDe04Config.Type

export interface DependencyMismatch {
  readonly dependencyName: string
  readonly files: ReadonlyArray<string>
  readonly usageKind?: "type-only" | "dynamic"
}

export interface UnusedDeclaredDependency {
  readonly dependencyName: string
}

export interface PackageDependencyHealth {
  readonly packagePath: string
  readonly packageName: string
  readonly private: boolean
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

export type BundledPackageInfo = {
  readonly bundlesSource: boolean
  readonly externalPackageNames: ReadonlySet<string>
}

export type ModuleSpecifierUsage = {
  readonly specifier: string
  readonly typeOnly: boolean
  readonly dynamic: boolean
}

export interface UsageBucket {
  readonly files: Set<string>
  readonly prodFiles: Set<string>
  readonly toolingFiles: Set<string>
  readonly typeOnlyFiles: Set<string>
  readonly dynamicFiles: Set<string>
  readonly bundledFiles: Set<string>
  readonly bundledProdFiles: Set<string>
  readonly specifiers: Set<string>
}

interface DependencyPackageManifest {
  readonly name: string | undefined
  readonly version: string | undefined
  readonly private: boolean
  readonly scripts: Readonly<Record<string, string>>
  readonly bin: Readonly<Record<string, string>>
  readonly dependencies: Readonly<Record<string, string>>
  readonly devDependencies: Readonly<Record<string, string>>
  readonly peerDependencies: Readonly<Record<string, string>>
  readonly optionalDependencies: Readonly<Record<string, string>>
  readonly entrypoints: ReadonlyArray<string>
  readonly exportSubpaths: ReadonlyArray<string>
}

interface DependencyPackageInfo {
  readonly name: string
  readonly path: string
  readonly tsconfigPath: string
  readonly packageJsonPath: string | undefined
  readonly manifest: DependencyPackageManifest | undefined
}

type PackagePathMatcher = (filePath: string) => DependencyPackageInfo | undefined
export type UsageByPackage = Map<string, Map<string, UsageBucket>>

export type DependencyAnalysisFacts = {
  readonly resolvedPackageNames: ReadonlySet<string>
  readonly activePackages: ReadonlyArray<DependencyPackageInfo>
  readonly pathAliasesByPackage: ReadonlyMap<string, ReadonlyArray<TsconfigPathAlias>>
  readonly bundledInfoByPackage: ReadonlyMap<string, BundledPackageInfo>
  readonly workspaceNames: ReadonlySet<string>
  readonly sourceFiles: ReadonlyArray<import("ts-morph").SourceFile>
  readonly packageForPath: PackagePathMatcher
  readonly rootDevDependencyNames: ReadonlySet<string>
  readonly rootToolingDependencyNames: ReadonlySet<string>
}

export type DependencyUsageSummary = {
  readonly usageByPackage: UsageByPackage
  readonly rootToolingUsedDependencyNames: ReadonlySet<string>
}

export type DependencyUsageContext = {
  readonly filePath: string
  readonly isToolingFile: boolean
  readonly isProdFile: boolean
}

export type ManifestPackageInfo = DependencyPackageInfo & {
  readonly manifest: DependencyPackageManifest
}
