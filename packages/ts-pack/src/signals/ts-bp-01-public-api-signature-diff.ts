import {
  SignalContextTag,
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  Node,
  type Node as TsMorphNode,
  type SourceFile,
} from "ts-morph"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import type { PackageInfo } from "../discovery.js"
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

export const TsBp01: Signal<TsBp01Config, TsBp01Output, TsProjectTag | TsPackageInfoTag | SignalContextTag> = {
  id: "TS-BP-01-public-api-signature-diff",
  title: "Public API signature diff",
  aliases: ["TS-BP-01"],
  tier: 1,
  category: "behavior-preservation",
  kind: "structural",
  cacheVersion: "public-api-signature-diff-v2-entrypoints",
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
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const context = yield* SignalContextTag
      return yield* Effect.try({
        try: (): TsBp01Output =>
          computePublicApiSignatureDiff(project.getSourceFiles(), packages, config, context),
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

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    if (!publicEntryFiles.has(sourceFile.getFilePath())) continue
    analyzedFiles += 1
    for (const [exportName, declarations] of sourceFile.getExportedDeclarations()) {
      for (const declaration of declarations) {
        const location = locationOf(declaration)
        const signature = signatureOf(exportName, declaration)
        const key = `${location.file}:${location.line}:${exportName}:${signature}`
        if (seen.has(key)) continue
        seen.add(key)
        signatures.push({
          exportName,
          ...location,
          declarationKind: declaration.getKindName(),
          signature,
          changedInDiff: changedHunkCovers(context.worktreePath, location, context.changedHunks),
        })
      }
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

const signatureOf = (exportName: string, declaration: TsMorphNode): string => {
  if (Node.isFunctionDeclaration(declaration)) {
    const params = declaration.getParameters().map((param) => `${param.getName()}: ${param.getType().getText(param)}`)
    return `function ${exportName}(${params.join(", ")}): ${declaration.getReturnType().getText(declaration)}`
  }
  if (Node.isClassDeclaration(declaration)) {
    return `class ${exportName}`
  }
  if (Node.isInterfaceDeclaration(declaration)) {
    return compact(declaration.getText())
  }
  if (Node.isTypeAliasDeclaration(declaration)) {
    return `type ${exportName} = ${declaration.getTypeNode()?.getText() ?? declaration.getType().getText(declaration)}`
  }
  if (Node.isEnumDeclaration(declaration)) {
    return compact(declaration.getText())
  }
  if (Node.isVariableDeclaration(declaration)) {
    return `const ${exportName}: ${declaration.getType().getText(declaration)}`
  }
  return compact(declaration.getText())
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
