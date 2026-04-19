import {
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  buildExportConsumerIndex,
  collectExportBindings,
  collectSameFileReferences,
} from "./shared-export-analysis.js"
import {
  boundaryOfFile,
  packageDisplayName,
  packageForFile,
  type BoundaryRule,
} from "./shared-workspace.js"

const BoundaryRuleSchema = Schema.Struct({
  name: Schema.String,
  globs: Schema.Array(Schema.String),
})

export const TsAb02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  boundary_rules: Schema.Array(BoundaryRuleSchema),
  top_n_diagnostics: Schema.Number,
})
export type TsAb02Config = typeof TsAb02Config.Type

export type ExportClassification = "unused" | "internal-only" | "cross-module" | "cross-package"

export interface ExportReachability {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly classification: ExportClassification
  readonly viaReExport: boolean
  readonly referenceFiles: ReadonlyArray<string>
  readonly sameFileReferenceCount: number
  readonly boundaryStatus: "cross-boundary" | "same-boundary" | "unmapped"
  readonly crossBoundaryFiles: ReadonlyArray<string>
}

export interface TsAb02Output {
  readonly exports: ReadonlyArray<ExportReachability>
  readonly counts: Readonly<Record<ExportClassification, number>>
  readonly boundaryConfined: ReadonlyArray<ExportReachability>
  readonly diagnosticLimit: number
}

export const TsAb02: Signal<TsAb02Config, TsAb02Output, TsProjectTag | TsPackageInfoTag> = {
  id: "TS-AB-02",
  tier: 1,
  category: "abstraction-bloat",
  kind: "structural",
  configSchema: TsAb02Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    boundary_rules: [],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const result = yield* Effect.try({
        try: (): TsAb02Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          const consumerIndex = buildExportConsumerIndex(sourceFiles, packages)
          const entries = sourceFiles
            .flatMap((sourceFile) => collectExportBindings(sourceFile))
            .map((binding) => classifyExport(binding, consumerIndex.get(binding.exportFile) ?? [], packages, config.boundary_rules))
            .sort(compareReachability)

          return {
            exports: entries,
            counts: {
              unused: entries.filter((entry) => entry.classification === "unused").length,
              "internal-only": entries.filter((entry) => entry.classification === "internal-only").length,
              "cross-module": entries.filter((entry) => entry.classification === "cross-module").length,
              "cross-package": entries.filter((entry) => entry.classification === "cross-package").length,
            },
            boundaryConfined: entries.filter(
              (entry) =>
                config.boundary_rules.length > 0 &&
                entry.boundaryStatus === "same-boundary" &&
                entry.classification !== "cross-package",
            ),
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-02",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.exports.length === 0) return 1
    const weightedUnused = out.counts.unused + out.counts["internal-only"] * 0.5
    return Math.max(0, 1 - weightedUnused / out.exports.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []

    diagnostics.push(
      ...out.boundaryConfined.map((entry) => ({
        severity: "block" as const,
        message:
          `Export ${entry.exportName} is not used across its declared boundary: ` +
          `${entry.exportFile}`,
        location: { file: entry.exportFile },
        data: {
          hash: computeDiagnosticHash(`${entry.exportFile}|${entry.exportName}|boundary-confined`),
          exportFile: entry.exportFile,
          exportName: entry.exportName,
          classification: entry.classification,
          referenceFiles: entry.referenceFiles.slice(),
        },
      })),
    )

    diagnostics.push(
      ...out.exports.map((entry) => ({
        severity:
          entry.classification === "unused"
            ? ("warn" as const)
            : entry.classification === "internal-only"
              ? ("info" as const)
              : ("info" as const),
        message:
          `Export ${entry.exportName} in ${entry.exportFile}: ` +
          `${entry.classification}`,
        location: { file: entry.exportFile },
        data: {
          exportFile: entry.exportFile,
          exportName: entry.exportName,
          declarationFiles: entry.declarationFiles.slice(),
          classification: entry.classification,
          referenceFiles: entry.referenceFiles.slice(),
          sameFileReferenceCount: entry.sameFileReferenceCount,
          viaReExport: entry.viaReExport,
          boundaryStatus: entry.boundaryStatus,
          crossBoundaryFiles: entry.crossBoundaryFiles.slice(),
        },
      })),
    )

    return diagnostics.slice(0, out.diagnosticLimit)
  },
}

const classifyExport = (
  binding: ReturnType<typeof collectExportBindings>[number],
  consumers: ReadonlyArray<ReturnType<typeof buildExportConsumerIndex> extends ReadonlyMap<string, infer T> ? T extends ReadonlyArray<infer E> ? E : never : never>,
  packages: ReadonlyArray<(typeof TsPackageInfoTag.Service)[number]>,
  boundaryRules: ReadonlyArray<BoundaryRule>,
): ExportReachability => {
  const sameFileReferences = collectSameFileReferences(binding)
  const ownPackage = packageDisplayName(packageForFile(binding.exportFile, packages))
  const referenceFiles = consumers
    .filter((consumer) => consumerMatches(binding.exportName, consumer.exportName))
    .map((consumer) => consumer.consumerFile)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right))

  const crossPackage = consumers.some(
    (consumer) =>
      consumerMatches(binding.exportName, consumer.exportName) &&
      consumer.consumerPackage !== undefined &&
      ownPackage !== undefined &&
      consumer.consumerPackage !== ownPackage,
  )

  const classification: ExportClassification =
    referenceFiles.length > 0
      ? crossPackage
        ? "cross-package"
        : "cross-module"
      : sameFileReferences.length > 0
        ? "internal-only"
        : "unused"

  const exportBoundary = boundaryOfFile(binding.exportFile, boundaryRules)
  const crossBoundaryFiles = referenceFiles.filter((file) => {
    const consumerBoundary = boundaryOfFile(file, boundaryRules)
    return exportBoundary !== undefined && consumerBoundary !== undefined && consumerBoundary !== exportBoundary
  })

  return {
    exportFile: binding.exportFile,
    exportName: binding.exportName,
    declarationFiles: binding.declarationFiles,
    classification,
    viaReExport: binding.viaReExport,
    referenceFiles,
    sameFileReferenceCount: sameFileReferences.length,
    boundaryStatus:
      exportBoundary === undefined
        ? "unmapped"
        : crossBoundaryFiles.length > 0
          ? "cross-boundary"
          : "same-boundary",
    crossBoundaryFiles,
  }
}

const consumerMatches = (exportName: string, consumerName: string | "*"): boolean =>
  consumerName === exportName || (consumerName === "*" && exportName !== "default")

const compareReachability = (left: ExportReachability, right: ExportReachability): number => {
  const rank = (entry: ExportReachability): number => {
    switch (entry.classification) {
      case "unused":
        return 0
      case "internal-only":
        return 1
      case "cross-module":
        return 2
      case "cross-package":
        return 3
    }
  }

  const rankCompare = rank(left) - rank(right)
  if (rankCompare !== 0) return rankCompare
  const fileCompare = left.exportFile.localeCompare(right.exportFile)
  if (fileCompare !== 0) return fileCompare
  return left.exportName.localeCompare(right.exportName)
}
