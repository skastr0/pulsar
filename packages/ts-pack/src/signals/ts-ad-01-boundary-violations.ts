import { relative } from "node:path"
import {
  SignalContextTag,
  computeDiagnosticHash,
  type BoundaryConvention,
  type Diagnostic,
  ReferenceDataTag,
  type SchemaConventions,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Option, Schema } from "effect"
import type { ExportDeclaration, ImportDeclaration, SourceFile } from "ts-morph"
import { discoverPackages, type PackageInfo } from "../discovery.js"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  isBuiltinModuleName,
  normalizePackageSpecifier,
  packageDisplayName,
  packageForFile,
} from "./shared-workspace.js"

export const TsAd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsAd01Config = typeof TsAd01Config.Type

export interface BoundaryViolation {
  readonly fromFile: string
  readonly fromPackage: string
  readonly toPackage: string
  readonly specifier: string
  readonly kind: "deep-reach" | "blocked-target" | "not-in-allowlist"
  readonly line: number
}

export interface TsAd01Output {
  readonly violations: ReadonlyArray<BoundaryViolation>
  readonly totalImports: number
  readonly violationsByPackage: ReadonlyMap<string, number>
  readonly referenceDataStatus: "loaded" | "missing"
  readonly diagnosticLimit: number
}

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

export const TsAd01: Signal<
  TsAd01Config,
  TsAd01Output,
  TsProjectTag | SignalContextTag | ReferenceDataTag
> = {
  id: "TS-AD-01-boundary-violations",
  title: "Module boundary violations",
  aliases: ["TS-AD-01"],
  tier: 2,
  category: "architectural-drift",
  kind: "structural",
  cacheVersion: "reference-data-applicability-v1",
  configSchema: TsAd01Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      const referenceData = yield* ReferenceDataTag
      const packages = yield* Effect.mapError(discoverPackages(context.worktreePath), (cause) =>
        new SignalComputeError({
          signalId: "TS-AD-01-boundary-violations",
          message: String(cause),
          cause,
        }),
      )

      return yield* Effect.try({
        try: (): TsAd01Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter(
              (sourceFile) =>
                !sourceFile.isDeclarationFile() &&
                !isExcluded(sourceFile.getFilePath(), config.exclude_globs),
            )
          const totalImports = sourceFiles.reduce(
            (count, sourceFile) => count + collectImportLikeDeclarations(sourceFile).length,
            0,
          )
          const rawConventions = Effect.runSync(
            referenceData.get<SchemaConventions>("schema-conventions"),
          )

          if (Option.isNone(rawConventions)) {
            return {
              violations: [],
              totalImports,
              violationsByPackage: new Map(),
              referenceDataStatus: "missing",
              diagnosticLimit: config.top_n_diagnostics,
            }
          }

          const lookup = buildBoundaryLookup(
            rawConventions.value,
            packages,
            context.worktreePath,
          )
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

          const sortedViolations = violations.sort(compareBoundaryViolations)
          return {
            violations: sortedViolations,
            totalImports,
            violationsByPackage: summarizeViolationsByPackage(sortedViolations),
            referenceDataStatus: "loaded",
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AD-01-boundary-violations",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.referenceDataStatus === "missing" || out.totalImports === 0) return 1
    return Math.max(0, 1 - out.violations.length / out.totalImports)
  },
  outputMetadata: (out) =>
    out.referenceDataStatus === "missing"
      ? { applicability: "insufficient_evidence" as const }
      : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.referenceDataStatus === "missing") {
      return [{ severity: "warn", message: "no conventions configured" }]
    }

    return out.violations.slice(0, out.diagnosticLimit).map((violation) => ({
      severity: "block" as const,
      message:
        `Module boundary violation (${violation.kind}): ${violation.specifier} ` +
        `from ${violation.fromPackage} to ${violation.toPackage}`,
      location: { file: violation.fromFile, line: violation.line },
      data: {
        hash: computeDiagnosticHash(
          [
            violation.fromPackage,
            violation.toPackage,
            violation.fromFile,
            violation.line,
            violation.specifier,
            violation.kind,
          ].join("|"),
        ),
        ...violation,
      },
    }))
  },
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
  conventions: SchemaConventions,
  packages: ReadonlyArray<PackageInfo>,
  worktreePath: string,
): BoundaryLookup => ({
  worktreePath,
  rulesByKey: new Map(
    Object.entries(conventions.boundaries).map(([key, value]) => [normalizePath(key), value]),
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

const collectImportLikeDeclarations = (
  sourceFile: SourceFile,
): ReadonlyArray<ImportLikeDeclaration> => [
  ...sourceFile.getImportDeclarations(),
  ...sourceFile
    .getExportDeclarations()
    .filter((declaration) => declaration.getModuleSpecifierValue() !== undefined),
]

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

const summarizeViolationsByPackage = (
  violations: ReadonlyArray<BoundaryViolation>,
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()

  for (const violation of violations) {
    counts.set(violation.fromPackage, (counts.get(violation.fromPackage) ?? 0) + 1)
  }

  return counts
}

const compareBoundaryViolations = (
  left: BoundaryViolation,
  right: BoundaryViolation,
): number => {
  if (left.fromFile !== right.fromFile) return left.fromFile.localeCompare(right.fromFile)
  if (left.line !== right.line) return left.line - right.line
  if (left.kind !== right.kind) return left.kind.localeCompare(right.kind)
  return left.specifier.localeCompare(right.specifier)
}

const normalizePath = (value: string): string => value.replaceAll("\\", "/")
