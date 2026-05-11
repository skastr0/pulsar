import {
  SignalContextTag,
  computeDiagnosticHash,
  type Diagnostic,
  ReferenceDataTag,
  type SchemaConventions,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Option, Schema } from "effect"
import type { SourceFile } from "ts-morph"
import { discoverPackages, type PackageInfo } from "../discovery.js"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  collectBoundaryViolations,
  collectImportLikeDeclarations,
  compareBoundaryViolations,
  summarizeViolationsByPackage,
} from "./ts-ad-01-analysis.js"

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
          const sourceFiles = selectBoundarySourceFiles(project.getSourceFiles(), config)
          const totalImports = countImportLikeDeclarations(sourceFiles)
          const rawConventions = Effect.runSync(
            referenceData.get<SchemaConventions>("schema-conventions"),
          )

          if (Option.isNone(rawConventions)) {
            return missingBoundaryOutput(totalImports, config.top_n_diagnostics)
          }

          return computeBoundaryOutput({
            conventions: rawConventions.value,
            packages,
            diagnosticLimit: config.top_n_diagnostics,
            sourceFiles,
            totalImports,
            worktreePath: context.worktreePath,
          })
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

const selectBoundarySourceFiles = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsAd01Config,
): ReadonlyArray<SourceFile> =>
  sourceFiles.filter(
    (sourceFile) =>
      !sourceFile.isDeclarationFile() &&
      !isExcluded(sourceFile.getFilePath(), config.exclude_globs),
  )

const countImportLikeDeclarations = (sourceFiles: ReadonlyArray<SourceFile>): number =>
  sourceFiles.reduce(
    (count, sourceFile) => count + collectImportLikeDeclarations(sourceFile).length,
    0,
  )

const missingBoundaryOutput = (
  totalImports: number,
  diagnosticLimit: number,
): TsAd01Output => ({
  violations: [],
  totalImports,
  violationsByPackage: new Map(),
  referenceDataStatus: "missing",
  diagnosticLimit,
})

const computeBoundaryOutput = ({
  conventions,
  packages,
  diagnosticLimit,
  sourceFiles,
  totalImports,
  worktreePath,
}: {
  readonly conventions: SchemaConventions
  readonly packages: ReadonlyArray<PackageInfo>
  readonly diagnosticLimit: number
  readonly sourceFiles: ReadonlyArray<SourceFile>
  readonly totalImports: number
  readonly worktreePath: string
}): TsAd01Output => {
  const sortedViolations = collectBoundaryViolations(
    sourceFiles,
    packages,
    conventions.boundaries,
    worktreePath,
  ).sort(compareBoundaryViolations)

  return {
    violations: sortedViolations,
    totalImports,
    violationsByPackage: summarizeViolationsByPackage(sortedViolations),
    referenceDataStatus: "loaded",
    diagnosticLimit,
  }
}
