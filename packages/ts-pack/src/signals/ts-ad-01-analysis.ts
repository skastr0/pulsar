import { relative } from "node:path"
import type { BoundaryConvention } from "@skastr0/pulsar-core/reference-data"
import type { ExportDeclaration, ImportDeclaration, SourceFile } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import type { BoundaryViolation } from "./ts-ad-01-boundary-violations.js"
import {
  isBuiltinModuleName,
  normalizePackageSpecifier,
  packageDisplayName,
  packageForFile,
} from "./shared-workspace.js"

type ImportLikeDeclaration = ImportDeclaration | ExportDeclaration

interface BoundaryLookup {
  readonly worktreePath: string
  readonly rulesByKey: ReadonlyMap<string, BoundaryConvention>
  readonly packagesByManifestName: ReadonlyMap<string, PackageInfo>
}

interface TargetResolution {
  readonly specifier: string
  readonly resolvedFilePath: string | undefined
  readonly targetPackage: PackageInfo | undefined
  readonly targetName: string
  readonly candidateKeys: ReadonlySet<string>
  readonly builtin: boolean
}

interface BoundaryViolationContext {
  readonly declaration: ImportLikeDeclaration
  readonly sourceFile: SourceFile
  readonly sourcePackage: PackageInfo | undefined
  readonly sourceRule: BoundaryConvention | undefined
  readonly target: TargetResolution
  readonly targetRule: BoundaryConvention | undefined
  readonly fromPackageName: string
  readonly samePackage: boolean
}

export const collectBoundaryViolations = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
  conventions: Readonly<Record<string, BoundaryConvention>>,
  worktreePath: string,
): Array<BoundaryViolation> => {
  const lookup = buildBoundaryLookup(conventions, packages, worktreePath)
  const violations: Array<BoundaryViolation> = []

  for (const sourceFile of sourceFiles) {
    const sourcePackage = packageForFile(sourceFile.getFilePath(), packages)
    const sourceRule =
      sourcePackage === undefined ? undefined : lookupBoundaryRule(lookup, sourcePackage)

    for (const declaration of collectImportLikeDeclarations(sourceFile)) {
      const violation = classifyBoundaryViolation({
        declaration,
        sourceFile,
        sourcePackage,
        sourceRule,
        packages,
        lookup,
      })
      if (violation !== undefined) {
        violations.push(violation)
      }
    }
  }

  return violations
}

export const collectImportLikeDeclarations = (
  sourceFile: SourceFile,
): ReadonlyArray<ImportLikeDeclaration> => [
  ...sourceFile.getImportDeclarations(),
  ...sourceFile
    .getExportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() !== undefined),
]

export const summarizeViolationsByPackage = (
  violations: ReadonlyArray<BoundaryViolation>,
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()

  for (const violation of violations) {
    counts.set(violation.fromPackage, (counts.get(violation.fromPackage) ?? 0) + 1)
  }

  return counts
}

export const compareBoundaryViolations = (
  left: BoundaryViolation,
  right: BoundaryViolation,
): number => {
  if (left.fromFile !== right.fromFile) return left.fromFile.localeCompare(right.fromFile)
  if (left.line !== right.line) return left.line - right.line
  if (left.kind !== right.kind) return left.kind.localeCompare(right.kind)
  return left.specifier.localeCompare(right.specifier)
}

const classifyBoundaryViolation = ({
  declaration,
  sourceFile,
  sourcePackage,
  sourceRule,
  packages,
  lookup,
}: {
  readonly declaration: ImportLikeDeclaration
  readonly sourceFile: SourceFile
  readonly sourcePackage: PackageInfo | undefined
  readonly sourceRule: BoundaryConvention | undefined
  readonly packages: ReadonlyArray<PackageInfo>
  readonly lookup: BoundaryLookup
}): BoundaryViolation | undefined => {
  const specifier = declaration.getModuleSpecifierValue()
  if (specifier === undefined) return undefined

  const target = resolveTargetResolution(specifier, declaration, packages, lookup)
  const fromPackageName = packageDisplayName(sourcePackage) ?? sourceFile.getFilePath()
  const targetRule =
    target.targetPackage === undefined ? undefined : lookupBoundaryRule(lookup, target.targetPackage)
  const context = {
    declaration,
    sourceFile,
    sourcePackage,
    sourceRule,
    target,
    targetRule,
    fromPackageName,
    samePackage: isSamePackage(sourcePackage, target.targetPackage),
  } satisfies BoundaryViolationContext

  return (
    classifyBlockedTargetViolation(context) ??
    classifyDeepReachViolation(context) ??
    classifyAllowlistViolation(context)
  )
}

const classifyBlockedTargetViolation = (
  context: BoundaryViolationContext,
): BoundaryViolation | undefined => {
  if (context.samePackage || context.sourceRule === undefined) return undefined
  if (!matchesRuleEntry(context.sourceRule.blocked_imports, context.target)) return undefined
  return boundaryViolation(context, "blocked-target")
}

const classifyDeepReachViolation = (
  context: BoundaryViolationContext,
): BoundaryViolation | undefined => {
  if (context.samePackage) return undefined
  if (context.sourcePackage === undefined || context.target.targetPackage === undefined) {
    return undefined
  }
  if (context.targetRule?.visibility !== "public-api") return undefined
  if (!isDeepReach(context.target.specifier, context.sourcePackage, context.target.targetPackage)) {
    return undefined
  }
  return boundaryViolation(context, "deep-reach")
}

const classifyAllowlistViolation = (
  context: BoundaryViolationContext,
): BoundaryViolation | undefined => {
  if (context.samePackage || context.sourceRule === undefined) return undefined
  if (context.sourceRule.allowed_imports.length === 0) return undefined
  if (context.target.candidateKeys.size === 0 || context.target.builtin) return undefined
  if (matchesRuleEntry(context.sourceRule.allowed_imports, context.target)) return undefined
  return boundaryViolation(context, "not-in-allowlist")
}

const boundaryViolation = (
  context: BoundaryViolationContext,
  kind: BoundaryViolation["kind"],
): BoundaryViolation => ({
  fromFile: context.sourceFile.getFilePath(),
  fromPackage: context.fromPackageName,
  toPackage: context.target.targetName,
  specifier: context.target.specifier,
  kind,
  line: context.declaration.getStartLineNumber(),
})

const isSamePackage = (
  sourcePackage: PackageInfo | undefined,
  targetPackage: PackageInfo | undefined,
): boolean => {
  return (
    sourcePackage !== undefined &&
    targetPackage !== undefined &&
    sourcePackage.path === targetPackage.path
  )
}

const buildBoundaryLookup = (
  conventions: Readonly<Record<string, BoundaryConvention>>,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
): BoundaryLookup => ({
  worktreePath,
  rulesByKey: new Map(
    Object.entries(conventions).map(([key, value]) => [normalizePath(key), value]),
  ),
  packagesByManifestName: new Map(
    packages.flatMap((pkg) =>
      pkg.manifest?.name === undefined ? [] : [[pkg.manifest.name, pkg] as const],
    ),
  ),
})

const lookupBoundaryRule = (
  lookup: BoundaryLookup,
  pkg: PackageInfo,
): BoundaryConvention | undefined => {
  const relativePackagePath = normalizePath(relative(lookup.worktreePath, pkg.path) || ".")
  return (
    lookup.rulesByKey.get(relativePackagePath) ??
    (pkg.manifest?.name === undefined ? undefined : lookup.rulesByKey.get(pkg.manifest.name))
  )
}

const resolveTargetResolution = (
  specifier: string,
  declaration: ImportLikeDeclaration,
  packages: ReadonlyArray<PackageInfo>,
  lookup: BoundaryLookup,
): TargetResolution => {
  const normalizedPackageName = normalizePackageSpecifier(specifier)
  const builtin =
    normalizedPackageName !== undefined && isBuiltinModuleName(normalizedPackageName)
  const resolvedFilePath = declaration.getModuleSpecifierSourceFile()?.getFilePath()
  const targetPackage =
    (resolvedFilePath === undefined ? undefined : packageForFile(resolvedFilePath, packages)) ??
    (normalizedPackageName === undefined
      ? undefined
      : lookup.packagesByManifestName.get(normalizedPackageName))

  const candidateKeys = new Set<string>()
  if (normalizedPackageName !== undefined) candidateKeys.add(normalizedPackageName)
  if (targetPackage !== undefined) {
    const relativePackagePath = normalizePath(relative(lookup.worktreePath, targetPackage.path) || ".")
    candidateKeys.add(relativePackagePath)
    if (targetPackage.manifest?.name !== undefined) {
      candidateKeys.add(targetPackage.manifest.name)
    }
  }

  return {
    specifier,
    resolvedFilePath,
    targetPackage,
    targetName: packageDisplayName(targetPackage) ?? normalizedPackageName ?? specifier,
    candidateKeys,
    builtin,
  }
}

const matchesRuleEntry = (
  entries: ReadonlyArray<string> | undefined,
  target: TargetResolution,
): boolean => {
  if (entries === undefined || entries.length === 0) return false
  return entries.some((entry) => target.candidateKeys.has(entry))
}

const isDeepReach = (
  specifier: string,
  sourcePackage: PackageInfo,
  targetPackage: PackageInfo,
): boolean => {
  if (sourcePackage.path === targetPackage.path) return false

  const manifestName = targetPackage.manifest?.name
  if (manifestName !== undefined) {
    return specifier !== manifestName
  }

  return true
}

const normalizePath = (value: string): string => value.replaceAll("\\", "/")
