import { readFile, readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import {
  SignalContextTag,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  type SignalContext,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { Node, Project, SyntaxKind, type SourceFile } from "ts-morph"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { readBunLockFile } from "../lockfiles/bun-lock.js"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import {
  isTypeOnlyModuleDeclaration,
  localIdentifierUsageByName,
  valueImportBindingNames,
} from "./shared-module-usage.js"
import {
  dependencyNamesOf,
  isBuiltinModuleName,
  normalizePackageSpecifier,
  workspacePackageNames,
} from "./shared-workspace.js"
import {
  analyzePackageHealth,
  type DependencyMismatch,
  type PackageDependencyHealth,
  type UnusedDeclaredDependency,
  type UsageBucket,
} from "./ts-de-04-package-health.js"
import {
  isLocalPathAliasUsage,
  readPathAliasesByPackage,
  type TsconfigPathAlias,
} from "./ts-de-04-path-aliases.js"
export const TsDe04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  dependency_aliases: Schema.Record({ key: Schema.String, value: Schema.String }),
  allow_dev_dependency_in_prod: Schema.Array(Schema.String),
})
export type TsDe04Config = typeof TsDe04Config.Type

export type { DependencyMismatch, PackageDependencyHealth, UnusedDeclaredDependency }

export interface TsDe04Output {
  readonly packages: ReadonlyArray<PackageDependencyHealth>
  readonly missingCount: number
  readonly unusedCount: number
  readonly diagnosticLimit: number
}

type BundledPackageInfo = {
  readonly bundlesSource: boolean
  readonly externalPackageNames: ReadonlySet<string>
}

type ModuleSpecifierUsage = {
  readonly specifier: string
  readonly typeOnly: boolean
  readonly dynamic: boolean
}

const PACKAGE_ROOT_DEPENDENCY_FILES = [
  "astro.config.cjs",
  "astro.config.js",
  "astro.config.mjs",
  "astro.config.mts",
  "astro.config.ts",
  "drizzle.config.cjs",
  "drizzle.config.js",
  "drizzle.config.mjs",
  "drizzle.config.mts",
  "drizzle.config.ts",
  "eslint.config.cjs",
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.mts",
  "eslint.config.ts",
  "next.config.cjs",
  "next.config.js",
  "next.config.mjs",
  "next.config.mts",
  "next.config.ts",
  "nuxt.config.cjs",
  "nuxt.config.js",
  "nuxt.config.mjs",
  "nuxt.config.mts",
  "nuxt.config.ts",
  "playwright.config.cjs",
  "playwright.config.js",
  "playwright.config.mjs",
  "playwright.config.mts",
  "playwright.config.ts",
  "postcss.config.cjs",
  "postcss.config.js",
  "postcss.config.mjs",
  "postcss.config.mts",
  "postcss.config.ts",
  "sst.config.js",
  "sst.config.mjs",
  "sst.config.mts",
  "sst.config.ts",
  "svelte.config.cjs",
  "svelte.config.js",
  "svelte.config.mjs",
  "svelte.config.mts",
  "svelte.config.ts",
  "tailwind.config.cjs",
  "tailwind.config.js",
  "tailwind.config.mjs",
  "tailwind.config.mts",
  "tailwind.config.ts",
  "vite.config.cjs",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.ts",
  "vite.cjs",
  "vite.js",
  "vite.mjs",
  "vite.mts",
  "vite.ts",
] as const

export const TsDe04: Signal<
  TsDe04Config,
  TsDe04Output,
  TsProjectTag | TsPackageInfoTag | SignalContextTag
> = {
  id: "TS-DE-04-package-dependency-health",
  title: "Package dependency health",
  aliases: ["TS-DE-04"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  cacheVersion: "esbuild-bundled-source-v1",
  configSchema: TsDe04Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/example/**",
      "**/examples/**",
      "**/demo/**",
      "**/demos/**",
      "**/private-demos/**",
      "**/sample/**",
      "**/samples/**",
      "**/sdk-samples/**",
      "**/google_samples/**",
      "**/fixture/**",
      "**/fixtures/**",
      "**/template/**",
      "**/templates/**",
    ],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/test-utils/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*test-utils.ts",
      "**/*test-utils.tsx",
      "**/*.test-utils.ts",
      "**/*.test-utils.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/*.config.ts",
      "**/*.config.tsx",
      "**/*.config.js",
      "**/*.config.mjs",
      "**/*.config.cjs",
      "**/vite.js",
      "**/vite.ts",
      "**/vite.mjs",
      "**/happydom.ts",
    ],
    top_n_diagnostics: 20,
    dependency_aliases: {},
    allow_dev_dependency_in_prod: [],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const context = yield* SignalContextTag

      const result = yield* Effect.tryPromise({
        try: () => computePackageDependencyHealth(project, packages, context, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-04-package-dependency-health",
            message: String(cause),
            cause,
          }),
      })

      return result
    }),
  score: (out) => {
    const packageCount = Math.max(1, out.packages.length)
    const missingPenaltyWeight = out.packages.reduce(
      (sum, pkg) =>
        sum +
        pkg.importedButNotDeclared.reduce(
          (pkgSum, mismatch) => pkgSum + missingDependencyPenaltyWeight(pkg, mismatch),
          0,
        ),
      0,
    )
    const softViolations = out.packages.reduce(
      (sum, pkg) => sum + pkg.transitiveUsedDirectly.length + pkg.devInProd.length,
      0,
    )
    const dependencyBearingPackageCount = Math.max(1, packageCount - 1)
    const penalty =
      (missingPenaltyWeight / dependencyBearingPackageCount) * 1.25 +
      out.unusedCount / (packageCount * 50) +
      softViolations / (packageCount * 20)
    return Math.max(0, 1 - Math.min(1, penalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    return [...packageDependencyDiagnostics(out.packages)]
      .sort(compareDependencyDiagnostics)
      .slice(0, out.diagnosticLimit)
  },
}

const packageDependencyDiagnostics = (
  packages: ReadonlyArray<PackageDependencyHealth>,
): ReadonlyArray<Diagnostic> =>
  packages.flatMap((pkg) => [
    ...missingDependencyDiagnostics(pkg),
    ...unusedDependencyDiagnostics(pkg),
    ...transitiveDirectUsageDiagnostics(pkg),
    ...devDependencyInProductionDiagnostics(pkg),
  ])

const missingDependencyDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> =>
  pkg.importedButNotDeclared.map((mismatch) => {
    const severity = missingDependencySeverity(pkg, mismatch)
    const severityReason = missingDependencySeverityReason(pkg, mismatch)
    return {
      severity,
      message:
        `Missing dependency in ${pkg.packageName}: ${mismatch.dependencyName} ` +
        `imported in ${formatFileExamples(pkg.packagePath, mismatch.files)}`,
      location: { file: mismatch.files[0] ?? pkg.packagePath },
      data: {
        hash: computeDiagnosticHash(`${pkg.packageName}|missing|${mismatch.dependencyName}`),
        issueKind: "missing-dependency",
        packageName: pkg.packageName,
        packagePrivate: pkg.private,
        dependencyName: mismatch.dependencyName,
        usageKind: mismatch.usageKind,
        fileCount: mismatch.files.length,
        files: mismatch.files.slice(),
        severityReason,
      },
    }
  })

const unusedDependencyDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> => {
  if (pkg.declaredButUnused.length === 0) return []
  const dependencyNames = pkg.declaredButUnused.map((unused) => unused.dependencyName)
  return [{
    severity: "warn",
    message:
      `Unused declared dependencies in ${pkg.packageName}: ` +
      formatDependencyExamples(dependencyNames),
    location: { file: join(pkg.packagePath, "package.json") },
    data: {
      hash: computeDiagnosticHash(`${pkg.packageName}|unused|${dependencyNames.join(",")}`),
      issueKind: "unused-dependencies",
      packageName: pkg.packageName,
      dependencyNames,
      dependencyCount: dependencyNames.length,
    },
  }]
}

const transitiveDirectUsageDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> =>
  pkg.transitiveUsedDirectly.map((mismatch) => ({
    severity: "warn",
    message:
      `Transitive dependency used directly in ${pkg.packageName}: ` +
      `${mismatch.dependencyName} via ${formatFileExamples(pkg.packagePath, mismatch.files)}`,
    location: { file: mismatch.files[0] ?? pkg.packagePath },
    data: {
      issueKind: "transitive-direct-usage",
      packageName: pkg.packageName,
      dependencyName: mismatch.dependencyName,
      fileCount: mismatch.files.length,
      files: mismatch.files.slice(),
    },
  }))

const devDependencyInProductionDiagnostics = (
  pkg: PackageDependencyHealth,
): ReadonlyArray<Diagnostic> =>
  pkg.devInProd.map((mismatch) => ({
    severity: "warn",
    message:
      `Production code imports devDependency in ${pkg.packageName}: ` +
      `${mismatch.dependencyName} via ${formatFileExamples(pkg.packagePath, mismatch.files)}`,
    location: { file: mismatch.files[0] ?? pkg.packagePath },
    data: {
      issueKind: "dev-dependency-in-production",
      packageName: pkg.packageName,
      dependencyName: mismatch.dependencyName,
      fileCount: mismatch.files.length,
      files: mismatch.files.slice(),
    },
  }))

type PackagePathMatcher = (filePath: string) => PackageInfo | undefined
type UsageByPackage = Map<string, Map<string, UsageBucket>>

type DependencyAnalysisFacts = {
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

type DependencyUsageSummary = {
  readonly usageByPackage: UsageByPackage
  readonly rootToolingUsedDependencyNames: ReadonlySet<string>
}

const computePackageDependencyHealth = async (
  project: Project,
  packages: ReadonlyArray<PackageInfo>,
  context: SignalContext,
  config: TsDe04Config,
): Promise<TsDe04Output> => {
  const facts = await loadDependencyAnalysisFacts(project, packages, context, config)
  const usage = collectDependencyUsage(facts, context, config)
  const packageHealth = summarizePackageHealth(facts, usage, config)
  return {
    packages: packageHealth,
    missingCount: packageHealth.reduce(
      (sum, pkg) => sum + pkg.importedButNotDeclared.length,
      0,
    ),
    unusedCount: packageHealth.reduce((sum, pkg) => sum + pkg.declaredButUnused.length, 0),
    diagnosticLimit: config.top_n_diagnostics,
  }
}

const loadDependencyAnalysisFacts = async (
  project: Project,
  packages: ReadonlyArray<PackageInfo>,
  context: SignalContext,
  config: TsDe04Config,
): Promise<DependencyAnalysisFacts> => {
  const activePackages = packages.filter((pkg) => !isExcluded(pkg.path, config.exclude_globs))
  const rootManifest = packages.find((pkg) => pkg.name === "(root)")?.manifest
  return {
    resolvedPackageNames: await readResolvedPackageNames(context.worktreePath),
    activePackages,
    pathAliasesByPackage: await readPathAliasesByPackage(activePackages),
    bundledInfoByPackage: await readBundledInfoByPackage(activePackages),
    workspaceNames: workspacePackageNames(activePackages),
    sourceFiles: await dependencySourceFiles(project, activePackages, config.exclude_globs),
    packageForPath: createPackagePathMatcher(packages),
    rootDevDependencyNames: dependencyNamesOf(rootManifest, ["devDependencies"]),
    rootToolingDependencyNames: dependencyNamesOf(rootManifest, [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
    ]),
  }
}

const collectDependencyUsage = (
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
  sourceFile: SourceFile,
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
): pkg is PackageInfo & { manifest: PackageManifest } => pkg?.manifest !== undefined

const dependencyUsageContext = (
  owningPackage: PackageInfo & { manifest: PackageManifest },
  filePath: string,
  config: TsDe04Config,
): {
  readonly filePath: string
  readonly isToolingFile: boolean
  readonly isProdFile: boolean
} => {
  const isToolingFile =
    isPackageToolingFile(owningPackage.path, filePath) ||
    isPackageScriptEntrypoint(owningPackage.manifest, owningPackage.path, filePath) ||
    isBundledCliSourceFile(owningPackage.manifest, owningPackage.path, filePath)
  return {
    filePath,
    isToolingFile,
    isProdFile: !isToolingFile && !matchesAnyGlob(filePath, config.test_globs),
  }
}

const recordModuleSpecifierUsage = (
  moduleUsage: ModuleSpecifierUsage,
  owningPackage: PackageInfo & { manifest: PackageManifest },
  usageContext: ReturnType<typeof dependencyUsageContext>,
  facts: DependencyAnalysisFacts,
  context: SignalContext,
  bucket: Map<string, UsageBucket>,
  rootToolingUsedDependencyNames: Set<string>,
  localPathAliasUsageCache: Map<string, boolean>,
): void => {
  const packageName = packageNameForRecordedUsage(moduleUsage, owningPackage, facts)
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

const packageNameForRecordedUsage = (
  moduleUsage: ModuleSpecifierUsage,
  owningPackage: PackageInfo & { manifest: PackageManifest },
  facts: DependencyAnalysisFacts,
): string | undefined => {
  const moduleSpecifier = moduleUsage.specifier
  const packageName = normalizePackageSpecifier(moduleSpecifier)
  if (packageName === undefined || isBuiltinModuleName(packageName)) return undefined
  if (isGeneratedVirtualModuleSpecifier(moduleSpecifier)) return undefined
  if (isFrameworkVirtualModuleSpecifier(moduleSpecifier, owningPackage.manifest)) return undefined
  return isWorkspaceSelfOrFacadeImport(
    packageName,
    owningPackage.manifest.name,
    facts.workspaceNames,
  )
    ? undefined
    : packageName
}

const isUndeclaredLocalPathAliasUsage = (
  moduleUsage: ModuleSpecifierUsage,
  packageName: string,
  owningPackage: PackageInfo & { manifest: PackageManifest },
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
  owningPackage: PackageInfo & { manifest: PackageManifest },
  usageContext: ReturnType<typeof dependencyUsageContext>,
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
  usageContext: ReturnType<typeof dependencyUsageContext>,
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

const summarizePackageHealth = (
  facts: DependencyAnalysisFacts,
  usage: DependencyUsageSummary,
  config: TsDe04Config,
): ReadonlyArray<PackageDependencyHealth> =>
  facts.activePackages
    .filter((pkg): pkg is PackageInfo & { manifest: PackageManifest } => pkg.manifest !== undefined)
    .map((pkg) =>
      analyzePackageHealth(
        pkg,
        usage.usageByPackage.get(pkg.path),
        facts.workspaceNames,
        facts.resolvedPackageNames,
        facts.rootDevDependencyNames,
        facts.rootToolingDependencyNames,
        usage.rootToolingUsedDependencyNames,
        config.dependency_aliases,
        new Set(config.allow_dev_dependency_in_prod),
      ),
    )
    .sort((left, right) => left.packageName.localeCompare(right.packageName))

const compareDependencyDiagnostics = (left: Diagnostic, right: Diagnostic): number => {
  const kindDelta = issueKindRank(left) - issueKindRank(right)
  if (kindDelta !== 0) return kindDelta
  const missingDependencyDelta = missingDependencyRank(left) - missingDependencyRank(right)
  if (missingDependencyDelta !== 0) return missingDependencyDelta
  const leftPackage = packageNameOf(left)
  const rightPackage = packageNameOf(right)
  const packageDelta = leftPackage.localeCompare(rightPackage)
  if (packageDelta !== 0) return packageDelta
  return left.message.localeCompare(right.message)
}

const issueKindRank = (diagnostic: Diagnostic): number => {
  switch (diagnostic.data?.issueKind) {
    case "missing-dependency":
      return 0
    case "transitive-direct-usage":
      return 1
    case "dev-dependency-in-production":
      return 2
    case "unused-dependencies":
      return 3
    default:
      return 4
  }
}

const missingDependencyRank = (diagnostic: Diagnostic): number => {
  if (diagnostic.data?.issueKind !== "missing-dependency") return 0
  switch (diagnostic.data.severityReason) {
    case "published-runtime-missing-dependency":
      return 0
    case "private-runtime-missing-dependency":
      return 1
    case "tooling-only-missing-dependency":
      return 2
    case "dynamic-missing-dependency":
      return 3
    case "type-only-missing-dependency":
      return 4
    default:
      return 5
  }
}

const packageNameOf = (diagnostic: Diagnostic): string =>
  typeof diagnostic.data?.packageName === "string" ? diagnostic.data.packageName : ""

const missingDependencySeverity = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): Diagnostic["severity"] => {
  return missingDependencyPenaltyWeight(pkg, mismatch) < 1 ? "warn" : "block"
}

const missingDependencyPenaltyWeight = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): number => {
  if (isToolingOnlyMissingDependency(pkg, mismatch)) return 0.2
  if (mismatch.usageKind === "dynamic") return 0.45
  if (mismatch.usageKind === "type-only") return 0.2
  if (pkg.private) return 0.45
  return 1
}

const missingDependencySeverityReason = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): string => {
  if (isToolingOnlyMissingDependency(pkg, mismatch)) return "tooling-only-missing-dependency"
  if (mismatch.usageKind === "dynamic") return "dynamic-missing-dependency"
  if (mismatch.usageKind === "type-only") return "type-only-missing-dependency"
  if (pkg.private) return "private-runtime-missing-dependency"
  return "published-runtime-missing-dependency"
}

const isToolingOnlyMissingDependency = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): boolean => {
  return (
    mismatch.files.length > 0 &&
    mismatch.files.every((file) => isPackageToolingFile(pkg.packagePath, file))
  )
}

const isGeneratedVirtualModuleSpecifier = (specifier: string): boolean =>
  /^[^./#][^:]*\.(?:gen|generated)\.(?:cjs|cts|js|jsx|mjs|mts|ts|tsx)$/.test(specifier)

const isFrameworkVirtualModuleSpecifier = (
  specifier: string,
  manifest: PackageManifest,
): boolean => {
  if (isDocusaurusApp(manifest)) {
    return (
      specifier.startsWith("@theme/") ||
      specifier.startsWith("@site/") ||
      specifier.startsWith("@generated/") ||
      specifier === "@docusaurus/Link" ||
      specifier === "@docusaurus/useDocusaurusContext" ||
      specifier === "@docusaurus/theme-common" ||
      specifier.startsWith("@docusaurus/theme-common/")
    )
  }
  if (isSvelteKitApp(manifest)) {
    return (
      specifier.startsWith("$app/") ||
      specifier.startsWith("$env/") ||
      specifier === "$lib" ||
      specifier.startsWith("$lib/") ||
      specifier === "$service-worker"
    )
  }

  return false
}

const isDocusaurusApp = (manifest: PackageManifest): boolean => {
  const dependencyNames = dependencyNamesOf(manifest, ["dependencies", "devDependencies"])
  if (dependencyNames.has("@docusaurus/core") || dependencyNames.has("@docusaurus/preset-classic")) {
    return true
  }
  return Object.values(manifest.scripts).some((script) => /\bdocusaurus\b/.test(script))
}

const isSvelteKitApp = (manifest: PackageManifest): boolean => {
  const dependencyNames = dependencyNamesOf(manifest, ["dependencies", "devDependencies"])
  if (dependencyNames.has("@sveltejs/kit")) return true
  return Object.values(manifest.scripts).some((script) => /\bsvelte-kit\b/.test(script))
}

const isWorkspaceSelfOrFacadeImport = (
  dependencyName: string,
  packageName: string | undefined,
  workspaceNames: ReadonlySet<string>,
): boolean => {
  if (packageName === undefined) return false
  if (dependencyName === packageName) return true
  return workspaceNames.has(dependencyName) && packageName.startsWith(`${dependencyName}/`)
}

const isPackageToolingFile = (packagePath: string, file: string): boolean => {
  const rel = relative(packagePath, file).split(sep).join("/")
  if (rel.startsWith("script/") || rel.startsWith("scripts/")) return true
  return /\.(?:config|conf)\.(?:cjs|cts|js|mjs|mts|ts|tsx)$/.test(rel)
}

const isPackageScriptEntrypoint = (
  manifest: PackageManifest,
  packagePath: string,
  file: string,
): boolean => {
  const rel = relative(packagePath, file).split(sep).join("/")
  if (rel.startsWith("..") || rel.startsWith("/")) return false
  const relPattern = escapeRegExp(rel)
  const optionalDotSlashRelPattern = `(?:\\./)?${relPattern}`
  const scriptEntrypointPattern = new RegExp(
    `(?:^|[\\s;&|()])(?:bun|node|tsx|ts-node)\\s+${optionalDotSlashRelPattern}(?=$|[\\s;&|()])`,
  )
  const directExecutablePattern = new RegExp(
    `(?:^|[\\s;&|()])${optionalDotSlashRelPattern}(?=$|[\\s;&|()])`,
  )
  return Object.values(manifest.scripts).some(
    (script) => scriptEntrypointPattern.test(script) || directExecutablePattern.test(script),
  )
}

const isBundledCliSourceFile = (
  manifest: PackageManifest,
  packagePath: string,
  file: string,
): boolean => {
  if (Object.keys(manifest.bin ?? {}).length === 0) return false
  if (!hasBundledCliBuildPipeline(manifest)) return false

  const rel = relative(packagePath, file).split(sep).join("/")
  return (
    rel.startsWith("src/cli/") ||
    rel.startsWith("src/bundler/") ||
    rel.startsWith("cli/") ||
    rel.startsWith("bundler/")
  )
}

const hasBundledCliBuildPipeline = (manifest: PackageManifest): boolean => {
  const scriptText = Object.values(manifest.scripts).join("\n")
  const devDependencyNames = dependencyNamesOf(manifest, ["devDependencies"])
  return (
    /\b(?:build|bundle|prepack|pack)\b/.test(scriptText) &&
    ["@vercel/ncc", "bun", "esbuild", "rollup", "tsup", "webpack"].some((dependencyName) =>
      devDependencyNames.has(dependencyName),
    )
  )
}

const formatDependencyExamples = (
  dependencies: ReadonlyArray<string>,
  maxExamples = 5,
): string => {
  const examples = dependencies.slice(0, maxExamples)
  const remaining = dependencies.length - examples.length
  return remaining > 0 ? `${examples.join(", ")} (+${remaining} more)` : examples.join(", ")
}

const formatFileExamples = (
  packagePath: string,
  files: ReadonlyArray<string>,
  maxExamples = 3,
): string => {
  const examples = files.slice(0, maxExamples).map((file) => formatRelativeFile(packagePath, file))
  const remaining = files.length - examples.length
  return remaining > 0
    ? `${examples.join(", ")} (+${remaining} more)`
    : examples.join(", ")
}

const formatRelativeFile = (packagePath: string, file: string): string => {
  const rel = relative(packagePath, file)
  return rel.startsWith("..") ? file : rel
}

const externalModuleSpecifiers = (sourceFile: SourceFile): ReadonlyArray<ModuleSpecifierUsage> => {
  const specifiers = new Map<string, ModuleSpecifierUsage>()
  const importDeclarations = sourceFile.getImportDeclarations()
  const exportDeclarations = sourceFile.getExportDeclarations()
  let identifierUsage: ReadonlyMap<string, "type-only" | "value"> | undefined
  const getIdentifierUsage = (): ReadonlyMap<string, "type-only" | "value"> => {
    identifierUsage ??= localIdentifierUsageByName(
      sourceFile,
      valueImportBindingNames(importDeclarations),
    )
    return identifierUsage
  }

  for (const declaration of [...importDeclarations, ...exportDeclarations]) {
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    if (moduleSpecifier !== undefined) {
      mergeModuleSpecifierUsage(specifiers, {
        specifier: moduleSpecifier,
        typeOnly: isTypeOnlyModuleDeclaration(declaration, getIdentifierUsage),
        dynamic: false,
      })
    }
  }

  if (hasRuntimeLoaderSyntax(sourceFile)) {
    const requireLikeNames = requireLikeIdentifiers(sourceFile)
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const firstArg = call.getArguments()[0]
      if (!Node.isStringLiteral(firstArg)) continue
      if (isExternalLoaderCall(requireLikeNames, call.getExpression().getText())) {
        const specifier = firstArg.getLiteralText()
        mergeModuleSpecifierUsage(specifiers, {
          specifier,
          typeOnly: false,
          dynamic: call.getExpression().getText() === "import",
        })
      }
    }
  }

  return [...specifiers.values()].sort((left, right) =>
    left.specifier.localeCompare(right.specifier),
  )
}

const mergeModuleSpecifierUsage = (
  specifiers: Map<string, ModuleSpecifierUsage>,
  usage: ModuleSpecifierUsage,
): void => {
  const existing = specifiers.get(usage.specifier)
  specifiers.set(usage.specifier, {
    specifier: usage.specifier,
    typeOnly: existing === undefined ? usage.typeOnly : existing.typeOnly && usage.typeOnly,
    dynamic: existing === undefined ? usage.dynamic : existing.dynamic && usage.dynamic,
  })
}

const dependencySourceFiles = async (
  project: Project,
  activePackages: ReadonlyArray<PackageInfo>,
  excludeGlobs: ReadonlyArray<string>,
): Promise<ReadonlyArray<SourceFile>> => {
  const existing = project
    .getSourceFiles()
    .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), excludeGlobs))
  const existingPaths = new Set(existing.map((sourceFile) => sourceFile.getFilePath()))
  const extraPaths = await packageRootDependencyFiles(activePackages, excludeGlobs, existingPaths)
  if (extraPaths.length === 0) return existing

  const extraProject = new Project({
    compilerOptions: {
      allowJs: true,
      checkJs: false,
    },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    skipLoadingLibFiles: true,
  })
  for (const filePath of extraPaths) {
    extraProject.addSourceFileAtPathIfExists(filePath)
  }
  return [
    ...existing,
    ...extraProject.getSourceFiles().filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), excludeGlobs)),
  ]
}

const packageRootDependencyFiles = async (
  activePackages: ReadonlyArray<PackageInfo>,
  excludeGlobs: ReadonlyArray<string>,
  existingPaths: ReadonlySet<string>,
): Promise<ReadonlyArray<string>> => {
  const dependencyFilenames = new Set<string>(PACKAGE_ROOT_DEPENDENCY_FILES)
  const existing = await Promise.all(
    activePackages.map(async (pkg) => {
      try {
        const entries = await readdir(pkg.path, { withFileTypes: true })
        return entries
          .filter((entry) => entry.isFile() && dependencyFilenames.has(entry.name))
          .map((entry) => join(pkg.path, entry.name))
          .filter((filePath) => !existingPaths.has(filePath) && !isExcluded(filePath, excludeGlobs))
      } catch {
        return []
      }
    }),
  )
  return existing.flat().sort((left, right) => left.localeCompare(right))
}

const hasRuntimeLoaderSyntax = (sourceFile: SourceFile): boolean =>
  /\b(?:require|createRequire)\b|import\s*\(/.test(sourceFile.getFullText())

const isExternalLoaderCall = (
  requireLikeNames: ReadonlySet<string>,
  expressionText: string,
): boolean => {
  if (expressionText === "import") return true
  if (requireLikeNames.has(expressionText)) return true

  const [receiver, property] = splitPropertyAccess(expressionText)
  return property === "resolve" && requireLikeNames.has(receiver)
}

const requireLikeIdentifiers = (sourceFile: SourceFile): ReadonlySet<string> => {
  const names = new Set<string>(["require"])

  for (const declaration of sourceFile.getVariableDeclarations()) {
    const name = declaration.getName()
    const initializer = declaration.getInitializer()
    if (!Node.isCallExpression(initializer)) continue
    const callee = initializer.getExpression().getText()
    if (callee === "createRequire" || callee.endsWith(".createRequire")) {
      names.add(name)
    }
  }

  return names
}

const splitPropertyAccess = (expressionText: string): readonly [string, string] => {
  const lastDot = expressionText.lastIndexOf(".")
  if (lastDot === -1) return [expressionText, ""]
  return [expressionText.slice(0, lastDot), expressionText.slice(lastDot + 1)]
}

const readResolvedPackageNames = async (worktreePath: string): Promise<ReadonlySet<string>> => {
  const packageNames = new Set<string>()

  try {
    const parsed = await readBunLockFile(join(worktreePath, "bun.lock"))
    for (const packageName of parsed.packageNames) {
      packageNames.add(packageName)
    }
  } catch {
    // Repos may use a non-Bun lockfile; fall through to the other lightweight readers.
  }

  try {
    const parsed = await readPnpmLockPackageNames(join(worktreePath, "pnpm-lock.yaml"))
    for (const packageName of parsed) {
      packageNames.add(packageName)
    }
  } catch {
    // Missing/unsupported lockfiles should not make the signal fail.
  }

  try {
    const parsed = await readPackageLockPackageNames(join(worktreePath, "package-lock.json"))
    for (const packageName of parsed) {
      packageNames.add(packageName)
    }
  } catch {
    // Missing/unsupported lockfiles should not make the signal fail.
  }

  return packageNames
}

const readPnpmLockPackageNames = async (filePath: string): Promise<ReadonlySet<string>> => {
  const text = await readFile(filePath, "utf8")
  const packageNames = new Set<string>()
  let inPackagesSection = false

  for (const line of text.split("\n")) {
    if (line === "packages:") {
      inPackagesSection = true
      continue
    }
    if (!inPackagesSection) continue
    if (/^\S/.test(line)) break
    const match = /^  (['"]?)(.+)\1:(?:\s.*)?$/.exec(line)
    if (match === null) continue
    const packageName = packageNameFromPnpmLockKey(match[2]!)
    if (packageName !== undefined) {
      packageNames.add(packageName)
    }
  }

  return packageNames
}

const packageNameFromPnpmLockKey = (lockKey: string): string | undefined => {
  const normalized = lockKey.startsWith("/") ? lockKey.slice(1) : lockKey
  if (normalized.startsWith("@")) {
    const scopeSeparator = normalized.indexOf("/")
    if (scopeSeparator === -1) return undefined
    const versionSeparator = normalized.indexOf("@", scopeSeparator + 1)
    return versionSeparator === -1 ? undefined : normalized.slice(0, versionSeparator)
  }

  const versionSeparator = normalized.indexOf("@")
  return versionSeparator <= 0 ? undefined : normalized.slice(0, versionSeparator)
}

const readPackageLockPackageNames = async (filePath: string): Promise<ReadonlySet<string>> => {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
  const packageNames = new Set<string>()
  const packages = asRecord(parsed.packages)
  if (packages !== undefined) {
    for (const key of Object.keys(packages)) {
      const packageName = packageNameFromPackageLockPath(key)
      if (packageName !== undefined) {
        packageNames.add(packageName)
      }
    }
  }

  const dependencies = asRecord(parsed.dependencies)
  if (dependencies !== undefined) {
    for (const dependencyName of Object.keys(dependencies)) {
      if (dependencyName.length > 0) {
        packageNames.add(dependencyName)
      }
    }
  }
  return packageNames
}

const packageNameFromPackageLockPath = (lockPath: string): string | undefined => {
  const marker = "node_modules/"
  const index = lockPath.lastIndexOf(marker)
  if (index === -1) return undefined

  const rest = lockPath.slice(index + marker.length)
  if (rest.length === 0) return undefined
  const parts = rest.split("/")
  if (parts[0]?.startsWith("@")) {
    return parts[1] === undefined ? undefined : `${parts[0]}/${parts[1]}`
  }
  return parts[0]
}

const manifestDeclaresDependency = (
  manifest: PackageManifest,
  dependencyName: string,
): boolean =>
  dependencyNamesOf(manifest, [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
    "peerDependencies",
  ]).has(dependencyName)

const readBundledInfoByPackage = async (
  packages: ReadonlyArray<PackageInfo>,
): Promise<ReadonlyMap<string, BundledPackageInfo>> => {
  const entries = await Promise.all(
    packages.map(async (pkg): Promise<[string, BundledPackageInfo]> => [
      pkg.path,
      await readBundledPackageInfo(pkg.path),
    ]),
  )
  return new Map(entries)
}

const readBundledPackageInfo = async (packagePath: string): Promise<BundledPackageInfo> => {
  const configText = await readFirstExistingText([
    join(packagePath, "tsup.config.ts"),
    join(packagePath, "tsup.config.mts"),
    join(packagePath, "tsup.config.cts"),
    join(packagePath, "tsup.config.js"),
    join(packagePath, "tsup.config.mjs"),
    join(packagePath, "tsup.config.cjs"),
    join(packagePath, "esbuild.config.ts"),
    join(packagePath, "esbuild.config.mts"),
    join(packagePath, "esbuild.config.cts"),
    join(packagePath, "esbuild.config.js"),
    join(packagePath, "esbuild.config.mjs"),
    join(packagePath, "esbuild.config.cjs"),
    join(packagePath, "esbuild.ts"),
    join(packagePath, "esbuild.mts"),
    join(packagePath, "esbuild.cts"),
    join(packagePath, "esbuild.js"),
    join(packagePath, "esbuild.mjs"),
    join(packagePath, "esbuild.cjs"),
  ])

  if (configText === undefined || !/\bbundle\s*:\s*true\b/.test(configText)) {
    return { bundlesSource: false, externalPackageNames: new Set() }
  }

  return {
    bundlesSource: true,
    externalPackageNames: parseBundlerExternalPackageNames(configText),
  }
}

const readFirstExistingText = async (
  paths: ReadonlyArray<string>,
): Promise<string | undefined> => {
  for (const path of paths) {
    try {
      return await readFile(path, "utf8")
    } catch {
      continue
    }
  }
  return undefined
}

const parseBundlerExternalPackageNames = (configText: string): ReadonlySet<string> => {
  const externalNames = new Set<string>()
  const externalMatch = /\bexternal\s*:\s*\[([\s\S]*?)\]/m.exec(configText)
  if (externalMatch === null) return externalNames

  for (const match of externalMatch[1]!.matchAll(/["']([^"']+)["']/g)) {
    const dependencyName = normalizePackageSpecifier(match[1]!)
    if (dependencyName !== undefined) {
      externalNames.add(dependencyName)
    }
  }

  return externalNames
}

const isBundledPackageSourceUsage = (
  owningPackage: PackageInfo,
  file: string,
  dependencyName: string,
  bundledInfo: BundledPackageInfo | undefined,
): boolean => {
  if (bundledInfo?.bundlesSource !== true) return false
  if (bundledInfo.externalPackageNames.has(dependencyName)) return false

  const rel = relative(owningPackage.path, file).split(sep).join("/")
  return rel.startsWith("src/")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined

const createPackagePathMatcher = (
  packages: ReadonlyArray<PackageInfo>,
): ((filePath: string) => PackageInfo | undefined) => {
  const sortedPackages = [...packages].sort((left, right) => right.path.length - left.path.length)
  return (filePath: string): PackageInfo | undefined =>
    sortedPackages.find((pkg) => filePath === pkg.path || filePath.startsWith(`${pkg.path}/`))
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
