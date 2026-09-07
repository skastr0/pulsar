import {
  SignalContextTag,
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { textOf } from "../ast.js"
import {
  SyntaxKind,
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isNamedExports,
  isNamespaceExport,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableStatement,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import { TsAnalysisTag, TsPackageInfoTag } from "../ts-analysis.js"
import { hasExportModifier, hasDefaultModifier } from "../ast.js"
import type { PackageInfo } from "../discovery.js"
import { createModuleResolver } from "../graph/module-graph.js"
import { publicEntrypointSourceFiles } from "./ts-ab-02-public-entrypoints.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  changedHunkCovers,
  isAnalyzableSourceFile,
  locationOf,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"

const TsBp01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  public_entry_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsBp01Config = typeof TsBp01Config.Type

export interface PublicApiSignature {
  readonly exportName: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly declarationKind: string
  readonly signature: string
  readonly changedInDiff: boolean
}

export interface PublicApiSignatureFinding extends SourceLocation {
  readonly exportName: string
  readonly declarationKind: string
  readonly signature: string
  readonly missingEvidence: string
}

export interface TsBp01Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly analyzedFiles: number
  readonly exportedSignatures: ReadonlyArray<PublicApiSignature>
  readonly changedPublicSignatures: ReadonlyArray<PublicApiSignatureFinding>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsBp01: Signal<TsBp01Config, TsBp01Output, TsAnalysisTag | TsPackageInfoTag | SignalContextTag> = {
  id: "TS-BP-01-public-api-signature-diff",
  title: "Public API signature diff",
  aliases: ["TS-BP-01"],
  tier: 1,
  category: "behavior-preservation",
  kind: "structural",
  evidenceClass: "deterministic-ast",
  cacheVersion: "public-api-signature-diff-v3-reexport-targets",
  configSchema: TsBp01Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    public_entry_globs: [
      "**/src/index.ts",
      "**/index.ts",
      "**/*.config.ts",
      "**/*.config.tsx",
      "**/*.config.mts",
      "**/*.config.cts",
    ],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const packages = yield* TsPackageInfoTag
      const context = yield* SignalContextTag
      const sourceFiles = yield* analysis.mapFiles(async (fileContext) => fileContext.sourceFile).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-BP-01-public-api-signature-diff",
            message: cause.message,
            cause,
          }),
        ),
      )
      return yield* Effect.try({
        try: (): TsBp01Output =>
          computePublicApiSignatureDiff(sourceFiles, packages, config, context),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-BP-01-public-api-signature-diff",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) =>
    out.state === "present" ? 1 / (1 + out.changedPublicSignatures.length / 3) : 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.changedPublicSignatures.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "warn",
      message: `Public ${finding.declarationKind} \`${finding.exportName}\` changed in the diff; route for behavior-preservation review`,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.exportName}:${finding.signature}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "document-api-change",
        title: "Prove behavior preservation",
        summary:
          "Confirm this exported contract change is intentional, update dependent tests/docs, or restore the previous public signature.",
        confidence: "medium",
        autoApplicable: false,
        data: { exportName: finding.exportName, declarationKind: finding.declarationKind },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const computePublicApiSignatureDiff = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
  config: TsBp01Config,
  context: {
    readonly worktreePath: string
    readonly changedHunks: ReadonlyArray<{
      readonly file: string
      readonly oldStart: number
      readonly oldLines: number
      readonly newStart: number
      readonly newLines: number
    }>
  },
): TsBp01Output => {
  const signatures: Array<PublicApiSignature> = []
  let analyzedFiles = 0
  const seen = new Set<string>()
  const publicEntryFiles = publicEntrypointSourceFiles(
    sourceFiles,
    packages,
    config.public_entry_globs,
  )
  const sourceFileByPath = new Map(sourceFiles.map((sourceFile) => [sourceFile.fileName, sourceFile]))
  const resolver = createModuleResolver(sourceFiles, packages)

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    if (!publicEntryFiles.has(sourceFile.fileName)) continue
    analyzedFiles += 1
    for (const exported of collectExportedDeclarations(sourceFile, sourceFileByPath, resolver)) {
      const location = locationOf(exported.declaration)
      const signature = signatureOf(exported.exportName, exported.declaration)
      const key = `${location.file}:${location.line}:${exported.exportName}:${signature}`
      if (seen.has(key)) continue
      seen.add(key)
      signatures.push({
        exportName: exported.exportName,
        ...location,
        declarationKind: SyntaxKind[exported.declaration.kind] ?? String(exported.declaration.kind),
        signature,
        changedInDiff: changedHunkCovers(context.worktreePath, location, context.changedHunks),
      })
    }
  }

  const changedPublicSignatures = signatures
    .filter((signature) => signature.changedInDiff)
    .map((signature) => ({
      file: signature.file,
      line: signature.line,
      column: signature.column,
      exportName: signature.exportName,
      declarationKind: signature.declarationKind,
      signature: signature.signature,
      missingEvidence: "Diff changed an exported declaration; behavior-preservation review evidence is required",
    }))
    .sort(compareFindings)

  return {
    state: analyzedFiles === 0 || signatures.length === 0
      ? "not_applicable"
      : changedPublicSignatures.length === 0 ? "zero" : "present",
    analyzedFiles,
    exportedSignatures: signatures.sort(compareSignatures),
    changedPublicSignatures,
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: ["behavior-preservation review route", "agent trust readout"],
    cacheContributors: [
      "source tree",
      "changed hunks",
      "config.exclude_globs",
      "config.public_entry_globs",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config.exclude_globs + config.public_entry_globs",
    enforcementCeiling: ["review-route"],
  }
}

const signatureOf = (exportName: string, declaration: Node): string => {
  if (isFunctionDeclaration(declaration)) {
    const params = declaration.parameters.map((param) => {
      const name = isIdentifier(param.name) ? param.name.text : textOf(param.name)
      const typeText = param.type === undefined ? "" : textOf(param.type)
      return `${name}: ${typeText}`
    })
    const returnType = declaration.type === undefined ? "" : textOf(declaration.type)
    return returnType.length === 0
      ? `function ${exportName}(${params.join(", ")})`
      : `function ${exportName}(${params.join(", ")}): ${returnType}`
  }
  if (isClassDeclaration(declaration)) {
    return `class ${exportName}`
  }
  if (isInterfaceDeclaration(declaration)) {
    return compact(textOf(declaration))
  }
  if (isTypeAliasDeclaration(declaration)) {
    return `type ${exportName} = ${declaration.type === undefined ? "unknown" : textOf(declaration.type)}`
  }
  if (isEnumDeclaration(declaration)) {
    return compact(textOf(declaration))
  }
  if (isVariableDeclaration(declaration)) {
    return declaration.type === undefined
      ? `const ${exportName}`
      : `const ${exportName}: ${textOf(declaration.type)}`
  }
  return compact(textOf(declaration))
}

const collectExportedDeclarations = (
  sourceFile: SourceFile,
  sourceFileByPath: ReadonlyMap<string, SourceFile>,
  resolver: ReturnType<typeof createModuleResolver>,
  seen: ReadonlySet<string> = new Set(),
): ReadonlyArray<{ readonly exportName: string; readonly declaration: Node }> => {
  if (seen.has(sourceFile.fileName)) return []
  const nextSeen = new Set(seen).add(sourceFile.fileName)
  const exported: Array<{ exportName: string; declaration: Node }> = []
  for (const statement of sourceFile.statements) {
    if (isFunctionDeclaration(statement) || isClassDeclaration(statement) || isInterfaceDeclaration(statement) || isTypeAliasDeclaration(statement) || isEnumDeclaration(statement)) {
      if (!hasExportModifier(statement)) continue
      const name = statement.name === undefined ? "default" : (isIdentifier(statement.name) ? statement.name.text : textOf(statement.name))
      exported.push({ exportName: hasDefaultModifier(statement) ? "default" : name, declaration: statement })
      continue
    }
    if (isVariableStatement(statement) && hasExportModifier(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!isIdentifier(declaration.name)) continue
        exported.push({ exportName: declaration.name.text, declaration })
      }
      continue
    }
    if (isExportAssignment(statement)) {
      exported.push({ exportName: "default", declaration: statement })
      continue
    }
    if (!isExportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier === undefined
      ? undefined
      : isStringLiteral(statement.moduleSpecifier) || isNoSubstitutionTemplateLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : undefined
    const targetPath = specifier === undefined
      ? undefined
      : resolver.resolveSpecifier(sourceFile.fileName, specifier)
    const targetFile = targetPath === undefined ? undefined : sourceFileByPath.get(targetPath)
    if (statement.exportClause === undefined) {
      if (targetFile === undefined) continue
      exported.push(...collectExportedDeclarations(targetFile, sourceFileByPath, resolver, nextSeen))
      continue
    }
    if (isNamedExports(statement.exportClause)) {
      for (const named of statement.exportClause.elements) {
        const exportName = isIdentifier(named.name) ? named.name.text : textOf(named.name)
        const importedName = named.propertyName === undefined
          ? exportName
          : (isIdentifier(named.propertyName) ? named.propertyName.text : textOf(named.propertyName))
        if (targetFile === undefined) {
          exported.push({ exportName, declaration: named })
          continue
        }
        const resolved = collectExportedDeclarations(targetFile, sourceFileByPath, resolver, nextSeen)
          .find((entry) => entry.exportName === importedName)
        exported.push(resolved === undefined ? { exportName, declaration: named } : { exportName, declaration: resolved.declaration })
      }
    }
  }
  return exported
}

const compact = (value: string): string =>
  value.replace(/\s+/g, " ").trim().slice(0, 240)

const compareSignatures = (
  left: PublicApiSignature,
  right: PublicApiSignature,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.exportName.localeCompare(right.exportName)

const compareFindings = (
  left: PublicApiSignatureFinding,
  right: PublicApiSignatureFinding,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.exportName.localeCompare(right.exportName)
