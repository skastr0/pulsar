import {
  collectRustProjectFacts,
  isExternallyVisible,
  type RustItemFact,
  type RustModuleFact,
  type RustUseFact,
} from "../rust-analysis.js"
import type { CargoMetadata } from "../cargo-metadata.js"
import { workspacePackages } from "../cargo-metadata.js"
import type { RustManifestInfo } from "../project.js"
import { resolveManifestForFile } from "../rust-analysis-modules.js"
import { isExcluded } from "./shared-globs.js"
import type {
  RsAd02Config,
  RsAd02Violation,
  RustBoundaryRule,
} from "./rs-ad-02-types.js"

type RustProjectFacts = Awaited<ReturnType<typeof collectRustProjectFacts>>

export interface CrateReferenceIndex {
  readonly byIdentifier: ReadonlyMap<string, RustManifestInfo>
  readonly dependencyAliasesByManifestPath: ReadonlyMap<string, ReadonlyMap<string, RustManifestInfo>>
}

export const collectCrossCrateImports = (
  facts: RustProjectFacts,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateIndex: CrateReferenceIndex,
  config: RsAd02Config,
): ReadonlyArray<RustUseFact> =>
  facts.uses.filter((useFact) => {
    if (isExcluded(useFact.file, config.exclude_globs)) return false
    return resolveCrateImportTarget(useFact, manifests, crateIndex) !== undefined
  })

export const evaluateCrateBoundaryViolations = (
  crossCrateImports: ReadonlyArray<RustUseFact>,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateIndex: CrateReferenceIndex,
  rules: ReadonlyMap<string, RustBoundaryRule>,
  facts: RustProjectFacts,
): ReadonlyArray<RsAd02Violation> => {
  const violations = crossCrateImports.flatMap((useFact) =>
    violationForCrossCrateImport(useFact, manifests, crateIndex, rules, facts),
  )
  return violations.sort((a, b) =>
    a.file.localeCompare(b.file) ||
    a.line - b.line ||
    a.importPath.localeCompare(b.importPath) ||
    a.kind.localeCompare(b.kind)
  )
}

const violationForCrossCrateImport = (
  useFact: RustUseFact,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateIndex: CrateReferenceIndex,
  rules: ReadonlyMap<string, RustBoundaryRule>,
  facts: RustProjectFacts,
): ReadonlyArray<RsAd02Violation> => {
  const fromCrate = resolveManifestForFile(useFact.file, manifests)
  if (fromCrate === undefined) return []
  const targetCrate = resolveCrateImportTarget(useFact, manifests, crateIndex)
  if (targetCrate === undefined) return []
  const rule = lookupBoundaryRule(rules, targetCrate)
  if (rule === undefined) return []

  const dependentViolation = dependentRuleViolation(useFact, fromCrate, targetCrate, rule)
  if (dependentViolation !== undefined) return [dependentViolation]

  const targetVisibility = resolveTargetVisibility(
    useFact.segments.slice(1),
    targetCrate.packageName ?? targetCrate.name,
    facts.modulesByPath,
    facts.itemsByModuleAndName,
  )
  const visibilityViolation = visibilityRuleViolation(useFact, fromCrate, targetCrate, targetVisibility)
  if (visibilityViolation !== undefined) return [visibilityViolation]

  const moduleViolation = publicModuleRuleViolation(useFact, fromCrate, targetCrate, rule, targetVisibility)
  return moduleViolation === undefined ? [] : [moduleViolation]
}

const dependentRuleViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  rule: RustBoundaryRule,
): RsAd02Violation | undefined => {
  const dependentIdentifiers = crateIdentifiers(fromCrate)
  if (
    rule.allowedDependents.length === 0 ||
    rule.allowedDependents.some((allowed) => dependentIdentifiers.has(allowed))
  ) {
    return undefined
  }
  return baseViolation(useFact, fromCrate, targetCrate, {
    kind: "dependent-not-allowed",
    detail: `Crate ${fromCrate.packageName ?? fromCrate.name} is not listed in allowed_dependents for ${targetCrate.packageName ?? targetCrate.name}`,
  })
}

const visibilityRuleViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  targetVisibility: ReturnType<typeof resolveTargetVisibility>,
): RsAd02Violation | undefined => {
  if (targetVisibility === undefined || isExternallyVisible(targetVisibility.visibility)) {
    return undefined
  }
  return baseViolation(useFact, fromCrate, targetCrate, {
    kind: "non-public-target",
    detail: `${useFact.path} resolves to a ${targetVisibility.kind} with visibility ${targetVisibility.visibility.kind}`,
  })
}

const publicModuleRuleViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  rule: RustBoundaryRule,
  targetVisibility: ReturnType<typeof resolveTargetVisibility>,
): RsAd02Violation | undefined => {
  const importedModule = importedModulePath(useFact.segments.slice(1), targetVisibility?.kind === "module")
  const isAllowedModule = rule.publicModules.some((prefix) =>
    prefix === "crate"
      ? importedModule === "crate"
      : importedModule === prefix || importedModule.startsWith(`${prefix}::`),
  )
  return isAllowedModule
    ? undefined
    : baseViolation(useFact, fromCrate, targetCrate, {
        kind: "boundary-rule",
        detail: `${useFact.path} bypasses declared public modules (${rule.publicModules.join(", ")})`,
      })
}

const baseViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  violation: Pick<RsAd02Violation, "kind" | "detail">,
): RsAd02Violation => ({
  file: useFact.file,
  line: useFact.line,
  fromCrate: fromCrate.packageName ?? fromCrate.name,
  toCrate: targetCrate.packageName ?? targetCrate.name,
  importPath: useFact.path,
  ...violation,
})

const crateIdentifiers = (manifest: RustManifestInfo): ReadonlySet<string> =>
  new Set(
    [manifest.name, manifest.packageName, rustCrateIdentifier(manifest.packageName)]
      .filter((value): value is string => value !== undefined),
  )

export const buildCrateIdentifierIndex = (
  manifests: ReadonlyArray<RustManifestInfo>,
  cargoMetadata: CargoMetadata | undefined = undefined,
): CrateReferenceIndex => {
  const byIdentifier = new Map<string, RustManifestInfo>()
  const dependencyAliasesByManifestPath = new Map<string, Map<string, RustManifestInfo>>()
  const byPackageName = new Map<string, RustManifestInfo>()

  for (const manifest of manifests) {
    if (manifest.packageName !== undefined) byPackageName.set(manifest.packageName, manifest)
    for (const identifier of crateIdentifiers(manifest)) {
      byIdentifier.set(identifier, manifest)
    }
  }

  const addDependencyAlias = (
    manifest: RustManifestInfo | undefined,
    alias: string | undefined,
    packageName: string | undefined,
  ): void => {
    if (manifest === undefined || alias === undefined || packageName === undefined) return
    const target = byPackageName.get(packageName)
    if (target === undefined) return
    const aliases = dependencyAliasesByManifestPath.get(manifest.manifestPath) ?? new Map<string, RustManifestInfo>()
    aliases.set(alias, target)
    aliases.set(alias.replaceAll("-", "_"), target)
    dependencyAliasesByManifestPath.set(manifest.manifestPath, aliases)
  }

  for (const manifest of manifests) {
    for (const dependency of manifest.dependencies ?? []) {
      addDependencyAlias(manifest, dependency.alias, dependency.packageName)
    }
  }

  if (cargoMetadata !== undefined) {
    const manifestByMetadataPath = new Map(
      manifests.map((manifest) => [normalizePath(manifest.manifestPath), manifest] as const),
    )
    for (const pkg of workspacePackages(cargoMetadata)) {
      const manifest = manifestByMetadataPath.get(normalizePath(pkg.manifestPath))
      for (const dependency of pkg.dependencies) {
        addDependencyAlias(
          manifest,
          dependency.rename ?? rustCrateIdentifier(dependency.name),
          dependency.name,
        )
      }
    }
  }

  return { byIdentifier, dependencyAliasesByManifestPath }
}

const lookupBoundaryRule = (
  rules: ReadonlyMap<string, RustBoundaryRule>,
  manifest: RustManifestInfo,
): RustBoundaryRule | undefined =>
  rules.get(manifest.packageName ?? "") ??
  rules.get(rustCrateIdentifier(manifest.packageName) ?? "") ??
  rules.get(manifest.name)

export const hasBoundaryRuleForUse = (
  useFact: RustUseFact,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateIndex: CrateReferenceIndex,
  rules: ReadonlyMap<string, RustBoundaryRule>,
): boolean => {
  const targetCrate = resolveCrateImportTarget(useFact, manifests, crateIndex)
  return targetCrate !== undefined && lookupBoundaryRule(rules, targetCrate) !== undefined
}

export const resolveCrateImportTarget = (
  useFact: RustUseFact,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateIndex: CrateReferenceIndex,
): RustManifestInfo | undefined => {
  const root = useFact.segments[0]
  if (root === undefined) return undefined
  const fromCrate = resolveManifestForFile(useFact.file, manifests)
  const dependencyTarget =
    fromCrate === undefined
      ? undefined
      : crateIndex.dependencyAliasesByManifestPath.get(fromCrate.manifestPath)?.get(root)
  const targetCrate = dependencyTarget ?? crateIndex.byIdentifier.get(root)
  if (targetCrate === undefined || fromCrate === undefined) return targetCrate
  return targetCrate.manifestPath === fromCrate.manifestPath ? undefined : targetCrate
}

const rustCrateIdentifier = (name: string | undefined): string | undefined =>
  name?.replaceAll("-", "_")

const normalizePath = (path: string): string => path.replaceAll("\\", "/")

const importedModulePath = (segments: ReadonlyArray<string>, importingModule: boolean): string => {
  if (segments.length === 0) return "crate"
  if (importingModule) {
    return `crate::${segments.join("::")}`
  }
  if (segments.length === 1) return "crate"
  return `crate::${segments.slice(0, -1).join("::")}`
}

const resolveTargetVisibility = (
  afterCrateSegments: ReadonlyArray<string>,
  crateName: string,
  modulesByPath: ReadonlyMap<string, RustModuleFact>,
  itemsByModuleAndName: ReadonlyMap<string, RustItemFact>,
): { readonly kind: "module" | "item"; readonly visibility: RustModuleFact["visibility"] | RustItemFact["visibility"] } | undefined => {
  if (afterCrateSegments.length === 0) {
    return { kind: "module", visibility: { kind: "pub" } }
  }

  const moduleCandidate = `${crateName}::crate::${afterCrateSegments.join("::")}`
  const module = modulesByPath.get(moduleCandidate)
  if (module !== undefined) {
    return { kind: "module", visibility: module.visibility }
  }

  const itemModulePath =
    afterCrateSegments.length === 1
      ? `${crateName}::crate`
      : `${crateName}::crate::${afterCrateSegments.slice(0, -1).join("::")}`
  const itemModule = modulesByPath.get(itemModulePath)
  if (itemModule !== undefined && !isExternallyVisible(itemModule.visibility)) {
    return { kind: "module", visibility: itemModule.visibility }
  }

  const item = itemsByModuleAndName.get(`${itemModulePath}::${afterCrateSegments[afterCrateSegments.length - 1]}`)
  if (item !== undefined) {
    return { kind: "item", visibility: item.visibility }
  }

  return undefined
}
