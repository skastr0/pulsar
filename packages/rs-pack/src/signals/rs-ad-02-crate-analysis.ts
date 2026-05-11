import {
  collectRustProjectFacts,
  isExternallyVisible,
  type RustItemFact,
  type RustModuleFact,
  type RustUseFact,
} from "../rust-analysis.js"
import type { RustManifestInfo } from "../project.js"
import { resolveManifestForFile } from "../rust-analysis-modules.js"
import { isExcluded } from "./shared-globs.js"
import type {
  RsAd02Config,
  RsAd02Violation,
  RustBoundaryRule,
} from "./rs-ad-02-types.js"

type RustProjectFacts = Awaited<ReturnType<typeof collectRustProjectFacts>>

export const collectCrossCrateImports = (
  facts: RustProjectFacts,
  crateByIdentifier: ReadonlyMap<string, RustManifestInfo>,
  config: RsAd02Config,
): ReadonlyArray<RustUseFact> =>
  facts.uses.filter((useFact) => {
    if (isExcluded(useFact.file, config.exclude_globs)) return false
    const root = useFact.segments[0]
    return root !== undefined && crateByIdentifier.has(root)
  })

export const evaluateCrateBoundaryViolations = (
  crossCrateImports: ReadonlyArray<RustUseFact>,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateByIdentifier: ReadonlyMap<string, RustManifestInfo>,
  rules: ReadonlyMap<string, RustBoundaryRule>,
  facts: RustProjectFacts,
): ReadonlyArray<RsAd02Violation> => {
  const violations = crossCrateImports.flatMap((useFact) =>
    violationForCrossCrateImport(useFact, manifests, crateByIdentifier, rules, facts),
  )
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

const violationForCrossCrateImport = (
  useFact: RustUseFact,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateByIdentifier: ReadonlyMap<string, RustManifestInfo>,
  rules: ReadonlyMap<string, RustBoundaryRule>,
  facts: RustProjectFacts,
): ReadonlyArray<RsAd02Violation> => {
  const targetCrate = crateByIdentifier.get(useFact.segments[0]!)
  if (targetCrate === undefined) return []
  const fromCrate = resolveManifestForFile(useFact.file, manifests)
  if (fromCrate === undefined) return []
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
  new Set([manifest.name, manifest.packageName].filter((value): value is string => value !== undefined))

export const buildCrateIdentifierIndex = (
  manifests: ReadonlyArray<RustManifestInfo>,
): ReadonlyMap<string, RustManifestInfo> => {
  const index = new Map<string, RustManifestInfo>()
  for (const manifest of manifests) {
    for (const identifier of crateIdentifiers(manifest)) {
      index.set(identifier, manifest)
    }
  }
  return index
}

const lookupBoundaryRule = (
  rules: ReadonlyMap<string, RustBoundaryRule>,
  manifest: RustManifestInfo,
): RustBoundaryRule | undefined =>
  rules.get(manifest.packageName ?? "") ?? rules.get(manifest.name)

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
