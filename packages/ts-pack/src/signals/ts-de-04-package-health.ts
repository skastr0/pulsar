import type { PackageInfo, PackageManifest } from "../discovery.js"
import { dependencyNamesOf, packageDisplayName } from "./shared-workspace.js"

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

export type UsageBucket = {
  readonly files: Set<string>
  readonly prodFiles: Set<string>
  readonly toolingFiles: Set<string>
  readonly typeOnlyFiles: Set<string>
  readonly dynamicFiles: Set<string>
  readonly bundledFiles: Set<string>
  readonly bundledProdFiles: Set<string>
  readonly specifiers: Set<string>
}

export const analyzePackageHealth = (
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
  const declarations = packageDependencyDeclarations(pkg, rootDevDependencyNames)
  const classified = classifyPackageDependencyUsage({
    pkg,
    usage,
    workspaceNames,
    resolvedPackageNames,
    rootToolingDependencyNames,
    rootToolingUsedDependencyNames,
    dependencyAliases,
    allowDevDependencyInProd,
    declarations,
  })
  return {
    packagePath: pkg.path,
    packageName: packageDisplayName(pkg) ?? pkg.name,
    private: pkg.manifest.private,
    importedButNotDeclared: classified.importedButNotDeclared,
    declaredButUnused: declaredButUnusedDependencies(
      declarations.unusedEligible,
      classified.usedDeclaredNames,
    ),
    transitiveUsedDirectly: classified.transitiveUsedDirectly,
    devInProd: classified.devInProd,
  }
}

interface PackageDependencyDeclarations {
  readonly productionDeclared: ReadonlySet<string>
  readonly unusedEligible: ReadonlySet<string>
  readonly devDeclared: ReadonlySet<string>
  readonly bundledAppDevDependenciesAllowed: boolean
}

interface PackageDependencyClassificationInput {
  readonly pkg: PackageInfo & { manifest: PackageManifest }
  readonly usage: ReadonlyMap<string, UsageBucket> | undefined
  readonly workspaceNames: ReadonlySet<string>
  readonly resolvedPackageNames: ReadonlySet<string>
  readonly rootToolingDependencyNames: ReadonlySet<string>
  readonly rootToolingUsedDependencyNames: ReadonlySet<string>
  readonly dependencyAliases: Readonly<Record<string, string>>
  readonly allowDevDependencyInProd: ReadonlySet<string>
  readonly declarations: PackageDependencyDeclarations
}

interface PackageDependencyClassification {
  readonly importedButNotDeclared: ReadonlyArray<DependencyMismatch>
  readonly transitiveUsedDirectly: ReadonlyArray<DependencyMismatch>
  readonly devInProd: ReadonlyArray<DependencyMismatch>
  readonly usedDeclaredNames: ReadonlySet<string>
}

const packageDependencyDeclarations = (
  pkg: PackageInfo & { manifest: PackageManifest },
  rootDevDependencyNames: ReadonlySet<string>,
): PackageDependencyDeclarations => ({
  productionDeclared: dependencyNamesOf(pkg.manifest, [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
  ]),
  unusedEligible: isLowSignalUnusedDependencyPackage(pkg)
    ? new Set<string>()
    : dependencyNamesOf(pkg.manifest, ["dependencies", "optionalDependencies"]),
  devDeclared: new Set([
    ...dependencyNamesOf(pkg.manifest, ["devDependencies"]),
    ...rootDevDependencyNames,
  ]),
  bundledAppDevDependenciesAllowed: allowsBundledAppDevDependencies(pkg.manifest),
})

const classifyPackageDependencyUsage = (
  input: PackageDependencyClassificationInput,
): PackageDependencyClassification => {
  const importedButNotDeclared: Array<DependencyMismatch> = []
  const transitiveUsedDirectly: Array<DependencyMismatch> = []
  const devInProd: Array<DependencyMismatch> = []
  const usedDeclaredNames = new Set<string>()
  if (input.pkg.name === "(root)") {
    for (const dependencyName of input.rootToolingUsedDependencyNames) {
      usedDeclaredNames.add(dependencyName)
    }
  }
  for (const dependencyName of sortedUsageDependencyNames(input.usage)) {
    classifyOneDependencyUsage(input, dependencyName, {
      importedButNotDeclared,
      transitiveUsedDirectly,
      devInProd,
      usedDeclaredNames,
    })
  }
  return { importedButNotDeclared, transitiveUsedDirectly, devInProd, usedDeclaredNames }
}

const sortedUsageDependencyNames = (
  usage: ReadonlyMap<string, UsageBucket> | undefined,
): ReadonlyArray<string> =>
  [...(usage?.keys() ?? [])].sort((left, right) => left.localeCompare(right))

const classifyOneDependencyUsage = (
  input: PackageDependencyClassificationInput,
  dependencyName: string,
  output: {
    readonly importedButNotDeclared: Array<DependencyMismatch>
    readonly transitiveUsedDirectly: Array<DependencyMismatch>
    readonly devInProd: Array<DependencyMismatch>
    readonly usedDeclaredNames: Set<string>
  },
): void => {
  const usageBucket = input.usage?.get(dependencyName)
  if (usageBucket === undefined) return
  const classification = dependencyUsageClassification(input, dependencyName, usageBucket)
  output.usedDeclaredNames.add(classification.effectiveDependencyName)
  if (input.declarations.productionDeclared.has(classification.effectiveDependencyName)) return
  if (input.declarations.devDeclared.has(classification.effectiveDependencyName)) {
    recordDevDependencyUsage(classification, usageBucket, input, output.devInProd)
    return
  }
  if (isBundledOnlyUsage(usageBucket)) return
  if (isRootToolingUsage(classification.effectiveDependencyName, usageBucket, input)) {
    output.usedDeclaredNames.add(classification.effectiveDependencyName)
    return
  }
  recordMissingOrTransitiveUsage(input, dependencyName, usageBucket, output)
}

const recordMissingOrTransitiveUsage = (
  input: PackageDependencyClassificationInput,
  dependencyName: string,
  usageBucket: UsageBucket,
  output: {
    readonly importedButNotDeclared: Array<DependencyMismatch>
    readonly transitiveUsedDirectly: Array<DependencyMismatch>
  },
): void => {
  const files = [...usageBucket.files].sort((left, right) => left.localeCompare(right))
  if (input.workspaceNames.has(dependencyName) || !input.resolvedPackageNames.has(dependencyName)) {
    output.importedButNotDeclared.push({
      dependencyName,
      files,
      ...dependencyMismatchUsageKind(usageBucket),
    })
    return
  }
  output.transitiveUsedDirectly.push({ dependencyName, files })
}

const dependencyUsageClassification = (
  input: PackageDependencyClassificationInput,
  dependencyName: string,
  usageBucket: UsageBucket,
): {
  readonly dependencyName: string
  readonly effectiveDependencyName: string
  readonly inferredHostFacadeAlias: string | undefined
} => {
  const inferredHostFacadeAlias = inferHostFacadeAlias(
    dependencyName,
    usageBucket.specifiers,
    input.declarations.productionDeclared,
    input.declarations.devDeclared,
    isTypeOnlyUsage(usageBucket),
  )
  const aliasedName = input.dependencyAliases[dependencyName] ?? inferredHostFacadeAlias
  const effectiveDependencyName =
    aliasedName !== undefined &&
    (input.declarations.productionDeclared.has(aliasedName) ||
      input.declarations.devDeclared.has(aliasedName))
      ? aliasedName
      : dependencyName
  return { dependencyName, effectiveDependencyName, inferredHostFacadeAlias }
}

const recordDevDependencyUsage = (
  classification: {
    readonly dependencyName: string
    readonly effectiveDependencyName: string
    readonly inferredHostFacadeAlias: string | undefined
  },
  usageBucket: UsageBucket,
  input: PackageDependencyClassificationInput,
  devInProd: Array<DependencyMismatch>,
): void => {
  if (!isDisallowedProductionDevDependency(classification, usageBucket, input)) return
  devInProd.push({
    dependencyName: classification.effectiveDependencyName,
    files: [...usageBucket.prodFiles].sort((left, right) => left.localeCompare(right)),
  })
}

const isDisallowedProductionDevDependency = (
  classification: {
    readonly dependencyName: string
    readonly effectiveDependencyName: string
    readonly inferredHostFacadeAlias: string | undefined
  },
  usageBucket: UsageBucket,
  input: PackageDependencyClassificationInput,
): boolean =>
  usageBucket.prodFiles.size > 0 &&
  !isBundledOnlyProdUsage(usageBucket) &&
  classification.effectiveDependencyName !== classification.inferredHostFacadeAlias &&
  !input.declarations.bundledAppDevDependenciesAllowed &&
  !input.allowDevDependencyInProd.has(classification.dependencyName) &&
  !input.allowDevDependencyInProd.has(classification.effectiveDependencyName)

const isRootToolingUsage = (
  dependencyName: string,
  usageBucket: UsageBucket,
  input: PackageDependencyClassificationInput,
): boolean =>
  input.rootToolingDependencyNames.has(dependencyName) && isToolingOnlyUsage(usageBucket)

const declaredButUnusedDependencies = (
  unusedEligible: ReadonlySet<string>,
  usedDeclaredNames: ReadonlySet<string>,
): ReadonlyArray<UnusedDeclaredDependency> =>
  [...unusedEligible]
    .filter((dependencyName) => !usedDeclaredNames.has(dependencyName))
    .sort((left, right) => left.localeCompare(right))
    .map((dependencyName) => ({ dependencyName }))

const isLowSignalUnusedDependencyPackage = (
  pkg: PackageInfo & { manifest: PackageManifest },
): boolean => {
  const packageName = packageDisplayName(pkg) ?? pkg.name
  const pathSegments = pkg.path.split(/[\\/]+/)
  return (
    ["docs", "documentation", "example", "examples", "demo", "demos", "sample", "samples", "sdk-samples", "google_samples"]
      .some((segment) => pathSegments.includes(segment)) ||
    /^(?:docs|documentation|example|demo|sample)s?(?:$|[-_/])/.test(packageName)
  )
}

const isToolingOnlyUsage = (usage: UsageBucket): boolean =>
  usage.files.size > 0 && usage.files.size === usage.toolingFiles.size

const isTypeOnlyUsage = (usage: UsageBucket): boolean =>
  usage.files.size > 0 && usage.files.size === usage.typeOnlyFiles.size

const isDynamicOnlyUsage = (usage: UsageBucket): boolean =>
  usage.files.size > 0 && usage.files.size === usage.dynamicFiles.size

const dependencyMismatchUsageKind = (
  usage: UsageBucket,
): Pick<DependencyMismatch, "usageKind"> =>
  isTypeOnlyUsage(usage)
    ? { usageKind: "type-only" }
    : isDynamicOnlyUsage(usage)
      ? { usageKind: "dynamic" }
      : {}

const isBundledOnlyUsage = (usage: UsageBucket): boolean =>
  usage.files.size > 0 && usage.files.size === usage.bundledFiles.size

const isBundledOnlyProdUsage = (usage: UsageBucket): boolean =>
  usage.prodFiles.size > 0 && usage.prodFiles.size === usage.bundledProdFiles.size

const allowsBundledAppDevDependencies = (manifest: PackageManifest): boolean => {
  if (!manifest.private) return false
  const scriptText = Object.values(manifest.scripts).join("\n")
  return /\b(electron-vite|vite|tauri|next|nuxt|astro|svelte-kit)\b/.test(scriptText)
}

const inferHostFacadeAlias = (
  hostPackageName: string,
  specifiers: ReadonlySet<string>,
  productionDeclared: ReadonlySet<string>,
  devDeclared: ReadonlySet<string>,
  typeOnlyUsage: boolean,
): string | undefined => {
  if (hostPackageName === "vscode" && devDeclared.has("@types/vscode")) return "@types/vscode"
  if (typeOnlyUsage) {
    const definitelyTypedPackage = definitelyTypedPackageNameFor(hostPackageName)
    if (
      definitelyTypedPackage !== undefined &&
      (productionDeclared.has(definitelyTypedPackage) || devDeclared.has(definitelyTypedPackage))
    ) {
      return definitelyTypedPackage
    }
  }
  const pluginSdkPrefix = `${hostPackageName}/plugin-sdk`
  if (
    specifiers.size === 0 ||
    ![...specifiers].every(
      (specifier) => specifier === pluginSdkPrefix || specifier.startsWith(`${pluginSdkPrefix}/`),
    )
  ) {
    return undefined
  }
  const declaredPluginSdkPackages = [...productionDeclared, ...devDeclared]
    .filter((dependencyName) => dependencyName.endsWith("/plugin-sdk"))
    .sort((left, right) => left.localeCompare(right))
  return declaredPluginSdkPackages.length === 1 ? declaredPluginSdkPackages[0] : undefined
}

const definitelyTypedPackageNameFor = (packageName: string): string | undefined => {
  if (packageName.startsWith("@types/")) return undefined
  if (packageName.startsWith("@")) {
    const [scope, name] = packageName.slice(1).split("/")
    return scope !== undefined && name !== undefined ? `@types/${scope}__${name}` : undefined
  }
  return `@types/${packageName}`
}
