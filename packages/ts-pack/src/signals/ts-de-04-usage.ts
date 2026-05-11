import type { SignalContext } from "@skastr0/pulsar-core/signal"
import type { PackageInfo } from "../discovery.js"
import { isLocalPathAliasUsage } from "./ts-de-04-path-aliases.js"
import { isBundledPackageSourceUsage } from "./ts-de-04-bundled-info.js"
import {
  dependencyUsageContext,
  manifestDeclaresDependency,
} from "./ts-de-04-package-classification.js"
import {
  externalModuleSpecifiers,
  recordedDependencyNameForModuleUsage,
} from "./ts-de-04-module-specifiers.js"
import type {
  DependencyAnalysisFacts,
  DependencyUsageSummary,
  DependencyUsageContext,
  ManifestPackageInfo,
  ModuleSpecifierUsage,
  TsDe04Config,
  UsageBucket,
  UsageByPackage,
} from "./ts-de-04-model.js"

export const collectDependencyUsage = (
  facts: DependencyAnalysisFacts,
  context: SignalContext,
  config: TsDe04Config,
): DependencyUsageSummary => {
  const usageByPackage: UsageByPackage = new Map()
  const rootToolingUsedDependencyNames = new Set<string>()
  const localPathAliasUsageCache = new Map<string, boolean>()
  for (const sourceFile of facts.sourceFiles) {
    recordSourceFileDependencyUsage(
      sourceFile,
      facts,
      context,
      config,
      usageByPackage,
      rootToolingUsedDependencyNames,
      localPathAliasUsageCache,
    )
  }
  return { usageByPackage, rootToolingUsedDependencyNames }
}

const recordSourceFileDependencyUsage = (
  sourceFile: import("ts-morph").SourceFile,
  facts: DependencyAnalysisFacts,
  context: SignalContext,
  config: TsDe04Config,
  usageByPackage: UsageByPackage,
  rootToolingUsedDependencyNames: Set<string>,
  localPathAliasUsageCache: Map<string, boolean>,
): void => {
  const owningPackage = facts.packageForPath(sourceFile.getFilePath())
  if (!hasPackageManifest(owningPackage)) return
  const filePath = sourceFile.getFilePath()
  const usageContext = dependencyUsageContext(owningPackage, filePath, config)
  const bucket = usageByPackage.get(owningPackage.path) ?? new Map<string, UsageBucket>()
  for (const moduleUsage of externalModuleSpecifiers(sourceFile)) {
    recordModuleSpecifierUsage(
      moduleUsage,
      owningPackage,
      usageContext,
      facts,
      context,
      bucket,
      rootToolingUsedDependencyNames,
      localPathAliasUsageCache,
    )
  }
  usageByPackage.set(owningPackage.path, bucket)
}

const hasPackageManifest = (
  pkg: PackageInfo | undefined,
): pkg is ManifestPackageInfo => pkg?.manifest !== undefined

const recordModuleSpecifierUsage = (
  moduleUsage: ModuleSpecifierUsage,
  owningPackage: ManifestPackageInfo,
  usageContext: DependencyUsageContext,
  facts: DependencyAnalysisFacts,
  context: SignalContext,
  bucket: Map<string, UsageBucket>,
  rootToolingUsedDependencyNames: Set<string>,
  localPathAliasUsageCache: Map<string, boolean>,
): void => {
  const packageName = recordedDependencyNameForModuleUsage(
    moduleUsage,
    owningPackage,
    facts.workspaceNames,
  )
  if (packageName === undefined) return
  if (usageContext.isToolingFile && facts.rootToolingDependencyNames.has(packageName)) {
    rootToolingUsedDependencyNames.add(packageName)
  }
  if (
    isUndeclaredLocalPathAliasUsage(
      moduleUsage,
      packageName,
      owningPackage,
      facts,
      context,
      localPathAliasUsageCache,
    )
  ) {
    return
  }
  addUsageBucketEntry(moduleUsage, packageName, owningPackage, usageContext, facts, bucket)
}

const isUndeclaredLocalPathAliasUsage = (
  moduleUsage: ModuleSpecifierUsage,
  packageName: string,
  owningPackage: ManifestPackageInfo,
  facts: DependencyAnalysisFacts,
  context: SignalContext,
  cache: Map<string, boolean>,
): boolean => {
  const cacheKey = `${owningPackage.path}\0${packageName}\0${moduleUsage.specifier}`
  const cached = cache.get(cacheKey)
  if (cached !== undefined) {
    return cached && !manifestDeclaresDependency(owningPackage.manifest, packageName)
  }
  const isLocal = isLocalPathAliasUsage(
    moduleUsage.specifier,
    packageName,
    owningPackage,
    facts.pathAliasesByPackage.get(owningPackage.path),
    context.worktreePath,
  )
  cache.set(cacheKey, isLocal)
  return isLocal && !manifestDeclaresDependency(owningPackage.manifest, packageName)
}

const addUsageBucketEntry = (
  moduleUsage: ModuleSpecifierUsage,
  packageName: string,
  owningPackage: ManifestPackageInfo,
  usageContext: DependencyUsageContext,
  facts: DependencyAnalysisFacts,
  bucket: Map<string, UsageBucket>,
): void => {
  const usage = bucket.get(packageName) ?? emptyUsageBucket()
  usage.files.add(usageContext.filePath)
  usage.specifiers.add(moduleUsage.specifier)
  recordBundledUsage(usage, moduleUsage, packageName, owningPackage, usageContext, facts)
  if (moduleUsage.typeOnly) usage.typeOnlyFiles.add(usageContext.filePath)
  if (moduleUsage.dynamic) usage.dynamicFiles.add(usageContext.filePath)
  if (usageContext.isProdFile && !moduleUsage.typeOnly) usage.prodFiles.add(usageContext.filePath)
  if (usageContext.isToolingFile) usage.toolingFiles.add(usageContext.filePath)
  bucket.set(packageName, usage)
}

const emptyUsageBucket = (): UsageBucket => ({
  files: new Set<string>(),
  prodFiles: new Set<string>(),
  toolingFiles: new Set<string>(),
  typeOnlyFiles: new Set<string>(),
  dynamicFiles: new Set<string>(),
  bundledFiles: new Set<string>(),
  bundledProdFiles: new Set<string>(),
  specifiers: new Set<string>(),
})

const recordBundledUsage = (
  usage: UsageBucket,
  moduleUsage: ModuleSpecifierUsage,
  packageName: string,
  owningPackage: PackageInfo,
  usageContext: DependencyUsageContext,
  facts: DependencyAnalysisFacts,
): void => {
  if (
    !isBundledPackageSourceUsage(
      owningPackage,
      usageContext.filePath,
      packageName,
      facts.bundledInfoByPackage.get(owningPackage.path),
    )
  ) {
    return
  }
  usage.bundledFiles.add(usageContext.filePath)
  if (usageContext.isProdFile && !moduleUsage.typeOnly) {
    usage.bundledProdFiles.add(usageContext.filePath)
  }
}
