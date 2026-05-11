import type { SignalContext } from "@skastr0/pulsar-core/signal"
import { Schema } from "effect"
import type { SourceFile } from "ts-morph"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import type { UsageBucket } from "./ts-de-04-package-health.js"
import type { TsconfigPathAlias } from "./ts-de-04-path-aliases.js"

export const TsDe04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  dependency_aliases: Schema.Record({ key: Schema.String, value: Schema.String }),
  allow_dev_dependency_in_prod: Schema.Array(Schema.String),
})
export type TsDe04Config = typeof TsDe04Config.Type

export interface TsDe04Output {
  readonly packages: ReadonlyArray<import("./ts-de-04-package-health.js").PackageDependencyHealth>
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

export type PackagePathMatcher = (filePath: string) => PackageInfo | undefined
export type UsageByPackage = Map<string, Map<string, UsageBucket>>

export type DependencyAnalysisFacts = {
  readonly resolvedPackageNames: ReadonlySet<string>
  readonly activePackages: ReadonlyArray<PackageInfo>
  readonly pathAliasesByPackage: ReadonlyMap<string, ReadonlyArray<TsconfigPathAlias>>
  readonly bundledInfoByPackage: ReadonlyMap<string, BundledPackageInfo>
  readonly workspaceNames: ReadonlySet<string>
  readonly sourceFiles: ReadonlyArray<SourceFile>
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

export type ManifestPackageInfo = PackageInfo & { manifest: PackageManifest }

export type De04SignalContext = SignalContext
