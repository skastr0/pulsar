import { readFile, readdir } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import {
  SignalContextTag,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { Node, Project, SyntaxKind, ts, type SourceFile } from "ts-morph"
import type { PackageInfo, PackageManifest } from "../discovery.js"
import { readBunLockFile } from "../lockfiles/bun-lock.js"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import {
  dependencyNamesOf,
  isBuiltinModuleName,
  normalizePackageSpecifier,
  packageDisplayName,
  workspacePackageNames,
} from "./shared-workspace.js"
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
  readonly usageKind?: "type-only"
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

type UsageBucket = {
  readonly files: Set<string>
  readonly prodFiles: Set<string>
  readonly toolingFiles: Set<string>
  readonly typeOnlyFiles: Set<string>
  readonly specifiers: Set<string>
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

type ModuleSpecifierUsage = {
  readonly specifier: string
  readonly typeOnly: boolean
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
  id: "TS-DE-04",
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
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
      "**/*test-support.ts",
      "**/*test-support.tsx",
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
        try: async (): Promise<TsDe04Output> => {
          const resolvedPackageNames = await readResolvedPackageNames(context.worktreePath)
          const activePackages = packages.filter((pkg) => !isExcluded(pkg.path, config.exclude_globs))
          const pathAliasesByPackage = await readPathAliasesByPackage(activePackages)
          const workspaceNames = workspacePackageNames(activePackages)
          const sourceFiles = await dependencySourceFiles(project, activePackages, config.exclude_globs)
          const packageForPath = createPackagePathMatcher(packages)
          const usageByPackage = new Map<string, Map<string, UsageBucket>>()
          const rootManifest = packages.find((pkg) => pkg.name === "(root)")?.manifest
          const rootDevDependencyNames = dependencyNamesOf(rootManifest, ["devDependencies"])
          const rootToolingDependencyNames = dependencyNamesOf(rootManifest, [
            "dependencies",
            "devDependencies",
            "optionalDependencies",
          ])
          const rootToolingUsedDependencyNames = new Set<string>()
          const localPathAliasUsageCache = new Map<string, boolean>()

          for (const sourceFile of sourceFiles) {
            const owningPackage = packageForPath(sourceFile.getFilePath())
            if (owningPackage?.manifest === undefined) continue
            const packageKey = owningPackage.path
            const isToolingFile =
              isPackageToolingFile(owningPackage.path, sourceFile.getFilePath()) ||
              isBundledCliSourceFile(
                owningPackage.manifest,
                owningPackage.path,
                sourceFile.getFilePath(),
              )
            const isProdFile =
              !isToolingFile && !matchesAnyGlob(sourceFile.getFilePath(), config.test_globs)
            const bucket = usageByPackage.get(packageKey) ?? new Map<string, UsageBucket>()

            for (const moduleUsage of externalModuleSpecifiers(sourceFile)) {
              const moduleSpecifier = moduleUsage.specifier
              const packageName = normalizePackageSpecifier(moduleSpecifier)
              if (packageName === undefined || isBuiltinModuleName(packageName)) continue
              if (isGeneratedVirtualModuleSpecifier(moduleSpecifier)) continue
              if (packageName === owningPackage.manifest.name) continue
              if (isToolingFile && rootToolingDependencyNames.has(packageName)) {
                rootToolingUsedDependencyNames.add(packageName)
              }
              const localPathAliasUsageCacheKey = `${owningPackage.path}\0${packageName}\0${moduleSpecifier}`
              let localPathAliasUsage = localPathAliasUsageCache.get(localPathAliasUsageCacheKey)
              if (localPathAliasUsage === undefined) {
                localPathAliasUsage = isLocalPathAliasUsage(
                  moduleSpecifier,
                  packageName,
                  owningPackage,
                  pathAliasesByPackage.get(owningPackage.path),
                  workspaceNames,
                  context.worktreePath,
                )
                localPathAliasUsageCache.set(localPathAliasUsageCacheKey, localPathAliasUsage)
              }
              if (localPathAliasUsage) {
                continue
              }

              const usage = bucket.get(packageName) ?? {
                files: new Set<string>(),
                prodFiles: new Set<string>(),
                toolingFiles: new Set<string>(),
                typeOnlyFiles: new Set<string>(),
                specifiers: new Set<string>(),
              }
              usage.files.add(sourceFile.getFilePath())
              usage.specifiers.add(moduleSpecifier)
              if (moduleUsage.typeOnly) {
                usage.typeOnlyFiles.add(sourceFile.getFilePath())
              }
              if (isProdFile && !moduleUsage.typeOnly) {
                usage.prodFiles.add(sourceFile.getFilePath())
              }
              if (isToolingFile) {
                usage.toolingFiles.add(sourceFile.getFilePath())
              }
              bucket.set(packageName, usage)
            }

            usageByPackage.set(packageKey, bucket)
          }

          const packageHealth = activePackages
            .filter((pkg): pkg is PackageInfo & { manifest: PackageManifest } => pkg.manifest !== undefined)
            .map((pkg) =>
              analyzePackageHealth(
                pkg,
                usageByPackage.get(pkg.path),
                workspaceNames,
                resolvedPackageNames,
                rootDevDependencyNames,
                rootToolingDependencyNames,
                rootToolingUsedDependencyNames,
                config.dependency_aliases,
                new Set(config.allow_dev_dependency_in_prod),
              ),
            )
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
    const diagnostics: Array<Diagnostic> = []

    for (const pkg of out.packages) {
      for (const mismatch of pkg.importedButNotDeclared) {
        const severity = missingDependencySeverity(pkg, mismatch)
        const severityReason = missingDependencySeverityReason(pkg, mismatch)
        diagnostics.push({
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
        })
      }

      if (pkg.declaredButUnused.length > 0) {
        const dependencyNames = pkg.declaredButUnused.map((unused) => unused.dependencyName)
        diagnostics.push({
          severity: "warn" as const,
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
        })
      }

      for (const mismatch of pkg.transitiveUsedDirectly) {
        diagnostics.push({
          severity: "warn" as const,
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
        })
      }

      for (const mismatch of pkg.devInProd) {
        diagnostics.push({
          severity: "warn" as const,
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
        })
      }
    }

    return diagnostics
      .sort(compareDependencyDiagnostics)
      .slice(0, out.diagnosticLimit)
  },
}

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
    case "type-only-missing-dependency":
      return 3
    default:
      return 4
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
  if (mismatch.usageKind === "type-only") return 0.2
  if (pkg.private) return 0.45
  return 1
}

const missingDependencySeverityReason = (
  pkg: PackageDependencyHealth,
  mismatch: DependencyMismatch,
): string => {
  if (isToolingOnlyMissingDependency(pkg, mismatch)) return "tooling-only-missing-dependency"
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

const isPackageToolingFile = (packagePath: string, file: string): boolean => {
  const rel = relative(packagePath, file).split(sep).join("/")
  if (rel.startsWith("script/") || rel.startsWith("scripts/")) return true
  return /\.(?:config|conf)\.(?:cjs|cts|js|mjs|mts|ts|tsx)$/.test(rel)
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
        mergeModuleSpecifierUsage(specifiers, { specifier, typeOnly: false })
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
  })
}

const isTypeOnlyModuleDeclaration = (
  declaration: import("ts-morph").ImportDeclaration | import("ts-morph").ExportDeclaration,
  getIdentifierUsage: () => ReadonlyMap<string, "type-only" | "value">,
): boolean => {
  if (declaration.isTypeOnly()) return true
  if (Node.isImportDeclaration(declaration)) {
    return isTypeOnlyImportDeclaration(declaration, getIdentifierUsage)
  }

  if (declaration.getNamespaceExport() !== undefined) return false
  const namedExports = declaration.getNamedExports()
  return namedExports.length > 0 && namedExports.every((specifier) => specifier.isTypeOnly())
}

const isTypeOnlyImportDeclaration = (
  declaration: import("ts-morph").ImportDeclaration,
  getIdentifierUsage: () => ReadonlyMap<string, "type-only" | "value">,
): boolean => {
  const clause = declaration.getImportClause()
  if (clause === undefined) return false
  if (clause.isTypeOnly()) return true

  const typeOnlyBindings = new Set<string>()
  const valueBindings = new Set<string>()

  const defaultImport = clause.getDefaultImport()
  if (defaultImport !== undefined) {
    valueBindings.add(defaultImport.getText())
  }

  const namespaceImport = clause.getNamespaceImport()
  if (namespaceImport !== undefined) {
    valueBindings.add(namespaceImport.getText())
  }

  for (const specifier of clause.getNamedImports()) {
    const localName = specifier.getAliasNode()?.getText() ?? specifier.getName()
    if (specifier.isTypeOnly()) {
      typeOnlyBindings.add(localName)
    } else {
      valueBindings.add(localName)
    }
  }

  if (valueBindings.size === 0) return typeOnlyBindings.size > 0

  const identifierUsage = getIdentifierUsage()
  for (const bindingName of valueBindings) {
    if (identifierUsage.get(bindingName) !== "type-only") return false
  }
  return true
}

const localIdentifierUsageByName = (
  sourceFile: SourceFile,
  bindingNames: ReadonlySet<string>,
): ReadonlyMap<string, "type-only" | "value"> => {
  const usage = new Map<string, "type-only" | "value">()
  const valueNames = new Set<string>()
  const compilerSourceFile = sourceFile.compilerNode

  const visit = (node: ts.Node, inTypePosition: boolean): void => {
    if (valueNames.size === bindingNames.size) return
    if (ts.isImportDeclaration(node)) return

    const nextInTypePosition = inTypePosition || ts.isTypeNode(node)
    if (ts.isIdentifier(node)) {
      const name = node.text
      if (!bindingNames.has(name)) return
      if (!nextInTypePosition) {
        usage.set(name, "value")
        valueNames.add(name)
        return
      }
      if (usage.get(name) !== "value") {
        usage.set(name, "type-only")
      }
      return
    }

    ts.forEachChild(node, (child) => visit(child, nextInTypePosition))
  }

  visit(compilerSourceFile, false)

  return usage
}

const valueImportBindingNames = (
  declarations: ReadonlyArray<import("ts-morph").ImportDeclaration>,
): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const declaration of declarations) {
    const clause = declaration.getImportClause()
    if (clause === undefined || clause.isTypeOnly()) continue

    const defaultImport = clause.getDefaultImport()
    if (defaultImport !== undefined) {
      names.add(defaultImport.getText())
    }

    const namespaceImport = clause.getNamespaceImport()
    if (namespaceImport !== undefined) {
      names.add(namespaceImport.getText())
    }

    for (const specifier of clause.getNamedImports()) {
      if (!specifier.isTypeOnly()) {
        names.add(specifier.getAliasNode()?.getText() ?? specifier.getName())
      }
    }
  }
  return names
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
  rootDevDependencyNames: ReadonlySet<string>,
  rootToolingDependencyNames: ReadonlySet<string>,
  rootToolingUsedDependencyNames: ReadonlySet<string>,
  dependencyAliases: Readonly<Record<string, string>>,
  allowDevDependencyInProd: ReadonlySet<string>,
): PackageDependencyHealth => {
  const productionDeclared = dependencyNamesOf(pkg.manifest, [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ])
  const unusedEligible = dependencyNamesOf(pkg.manifest, ["dependencies", "optionalDependencies"])
  const devDeclared = new Set([
    ...dependencyNamesOf(pkg.manifest, ["devDependencies"]),
    ...rootDevDependencyNames,
  ])
  const bundledAppDevDependenciesAllowed = allowsBundledAppDevDependencies(pkg.manifest)

  const importedButNotDeclared: Array<DependencyMismatch> = []
  const transitiveUsedDirectly: Array<DependencyMismatch> = []
  const devInProd: Array<DependencyMismatch> = []
  const usedDeclaredNames = new Set<string>()
  if (pkg.name === "(root)") {
    for (const dependencyName of rootToolingUsedDependencyNames) {
      usedDeclaredNames.add(dependencyName)
    }
  }

  for (const dependencyName of [...(usage?.keys() ?? [])].sort((left, right) => left.localeCompare(right))) {
    const usageBucket = usage?.get(dependencyName)
    if (usageBucket === undefined) continue
    const files = [...usageBucket.files].sort((left, right) => left.localeCompare(right))
    const inferredHostFacadeAlias = inferHostFacadeAlias(
      dependencyName,
      usageBucket.specifiers,
      productionDeclared,
      devDeclared,
    )
    const aliasedName = dependencyAliases[dependencyName] ?? inferredHostFacadeAlias
    const effectiveDependencyName =
      aliasedName !== undefined &&
      (productionDeclared.has(aliasedName) || devDeclared.has(aliasedName))
        ? aliasedName
        : dependencyName
    usedDeclaredNames.add(effectiveDependencyName)

    if (productionDeclared.has(effectiveDependencyName)) continue

    if (devDeclared.has(effectiveDependencyName)) {
      if (
        usageBucket.prodFiles.size > 0 &&
        effectiveDependencyName !== inferredHostFacadeAlias &&
        !bundledAppDevDependenciesAllowed &&
        !allowDevDependencyInProd.has(dependencyName) &&
        !allowDevDependencyInProd.has(effectiveDependencyName)
      ) {
        devInProd.push({
          dependencyName: effectiveDependencyName,
          files: [...usageBucket.prodFiles].sort((left, right) => left.localeCompare(right)),
        })
      }
      continue
    }

    if (
      rootToolingDependencyNames.has(effectiveDependencyName) &&
      isToolingOnlyUsage(usageBucket)
    ) {
      usedDeclaredNames.add(effectiveDependencyName)
      continue
    }

    if (workspaceNames.has(dependencyName) || !resolvedPackageNames.has(dependencyName)) {
      importedButNotDeclared.push({
        dependencyName,
        files,
        ...(isTypeOnlyUsage(usageBucket) ? { usageKind: "type-only" as const } : {}),
      })
      continue
    }

    transitiveUsedDirectly.push({ dependencyName, files })
  }

  const declaredButUnused = [...unusedEligible]
    .filter((dependencyName) => !usedDeclaredNames.has(dependencyName))
    .sort((left, right) => left.localeCompare(right))
    .map((dependencyName) => ({ dependencyName }))

  return {
    packagePath: pkg.path,
    packageName: packageDisplayName(pkg) ?? pkg.name,
    private: pkg.manifest.private,
    importedButNotDeclared,
    declaredButUnused,
    transitiveUsedDirectly,
    devInProd,
  }
}

const isToolingOnlyUsage = (usage: UsageBucket): boolean =>
  usage.files.size > 0 && usage.files.size === usage.toolingFiles.size

const isTypeOnlyUsage = (usage: UsageBucket): boolean =>
  usage.files.size > 0 && usage.files.size === usage.typeOnlyFiles.size

const allowsBundledAppDevDependencies = (manifest: PackageManifest): boolean => {
  if (!manifest.private) return false
  const scriptText = Object.values(manifest.scripts).join("\n")
  return /\b(electron-vite|vite|tauri|next|nuxt|astro|svelte-kit)\b/.test(scriptText)
}

const createPackagePathMatcher = (
  packages: ReadonlyArray<PackageInfo>,
): ((filePath: string) => PackageInfo | undefined) => {
  const sortedPackages = [...packages].sort((left, right) => right.path.length - left.path.length)
  return (filePath: string): PackageInfo | undefined =>
    sortedPackages.find((pkg) => filePath === pkg.path || filePath.startsWith(`${pkg.path}/`))
}

const inferHostFacadeAlias = (
  hostPackageName: string,
  specifiers: ReadonlySet<string>,
  productionDeclared: ReadonlySet<string>,
  devDeclared: ReadonlySet<string>,
): string | undefined => {
  if (hostPackageName === "vscode" && devDeclared.has("@types/vscode")) {
    return "@types/vscode"
  }
  if (specifiers.size === 0) return undefined

  const pluginSdkPrefix = `${hostPackageName}/plugin-sdk`
  const allSpecifiersUsePluginSdkFacade = [...specifiers].every(
    (specifier) => specifier === pluginSdkPrefix || specifier.startsWith(`${pluginSdkPrefix}/`),
  )
  if (!allSpecifiersUsePluginSdkFacade) return undefined

  const declaredPluginSdkPackages = [...productionDeclared, ...devDeclared]
    .filter((dependencyName) => dependencyName.endsWith("/plugin-sdk"))
    .sort((left, right) => left.localeCompare(right))

  return declaredPluginSdkPackages.length === 1 ? declaredPluginSdkPackages[0] : undefined
}
