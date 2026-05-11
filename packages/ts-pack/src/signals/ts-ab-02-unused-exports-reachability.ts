import {
  CalibrationContextTag,
  computeDiagnosticHash,
  type CalibrationDecision,
  type CalibrationProcessorError,
  type CalibrationSlotOutput,
  type Diagnostic,
  type ResolvedCalibrationContext,
  type Signal,
  SignalComputeError,
  type TypeScriptExportReachabilityValue,
} from "@skastr0/pulsar-core"
import { Effect, Option, Schema } from "effect"
import { Node } from "ts-morph"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import {
  countSameFileReferences,
  type ExportConsumer,
} from "./shared-export-analysis.js"
import {
  buildReachabilityAnalysis,
  declarationFactForExport,
  isReExportedByPublicEntrypoint,
  matchingConsumers,
  type ExportBinding,
  type TypeScriptSourceExportFacts,
} from "./ts-ab-02-reachability-analysis.js"
import { boundaryOfFile, type BoundaryRule } from "./shared-workspace.js"

const BoundaryRuleSchema = Schema.Struct({
  name: Schema.String,
  globs: Schema.Array(Schema.String),
})

export const TsAb02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  public_entry_globs: Schema.Array(Schema.String),
  boundary_rules: Schema.Array(BoundaryRuleSchema),
  top_n_diagnostics: Schema.Number,
})
export type TsAb02Config = typeof TsAb02Config.Type

export type ExportClassification = "unused" | "internal-only" | "cross-module" | "cross-package"
export type ExportEvidence = "runtime" | "type-only" | "test-hook"

export interface ExportReachability {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly classification: ExportClassification
  readonly evidence: ExportEvidence
  readonly penaltyWeight: number
  readonly viaReExport: boolean
  readonly referenceFiles: ReadonlyArray<string>
  readonly sameFileReferenceCount: number
  readonly boundaryStatus: "cross-boundary" | "same-boundary" | "unmapped"
  readonly crossBoundaryFiles: ReadonlyArray<string>
}

export interface TsAb02Output {
  readonly exports: ReadonlyArray<ExportReachability>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly counts: Readonly<Record<ExportClassification, number>>
  readonly boundaryConfined: ReadonlyArray<ExportReachability>
  readonly diagnosticLimit: number
}

export const TsAb02: Signal<TsAb02Config, TsAb02Output, TsProjectTag | TsPackageInfoTag> = {
  id: "TS-AB-02-unused-exports",
  title: "Unused exports",
  aliases: ["TS-AB-02"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "structural",
  cacheVersion: "calibrated-export-reachability-v2",
  configSchema: TsAb02Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/docs/**",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "fixtures/**",
      "**/fixtures/**",
      "playground/**",
      "playground-*/**",
      "playgrounds/**",
      "**/playground/**",
      "**/playground-*/**",
      "**/playgrounds/**",
      "**/_generated/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/prototypes/**",
      "**/explorations/**",
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
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    public_entry_globs: [
      "**/src/index.ts",
      "**/index.ts",
      "**/runtime-api.ts",
      "**/setup-api.ts",
      "**/*.config.ts",
      "**/*.config.tsx",
      "**/*.config.mts",
      "**/*.config.cts",
    ],
    boundary_rules: [],
    top_n_diagnostics: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const exportReachabilityCalibration =
        Option.isSome(calibration) &&
        calibration.value.processors.some((processor) =>
          processor.slot === "typescript.export-reachability"
        )
          ? calibration.value
          : undefined
      const analysis = yield* Effect.try({
        try: () => buildReachabilityAnalysis(project.getSourceFiles(), packages, config),
        catch: toSignalComputeError,
      })
      const entries: Array<ExportReachability> = []
      const calibrationDecisions: Array<CalibrationDecision> = []

      for (const binding of analysis.bindings) {
        const consumers = matchingConsumers(
          analysis.consumerLookup.get(binding.exportFile),
          binding.exportName,
        )
        const defaultPublicEntrypoint =
          analysis.publicEntryFiles.has(binding.exportFile) ||
          isReExportedByPublicEntrypoint(consumers, analysis.publicEntryFiles)
        const reachability = yield* calibrateExportReachability(
          binding,
          defaultPublicEntrypoint,
          exportReachabilityCalibration,
          analysis.sourceFactsByFile.get(binding.exportFile),
        ).pipe(Effect.mapError(toSignalComputeError))
        calibrationDecisions.push(...reachability.decisions)
        entries.push(classifyExport(
          binding,
          consumers,
          analysis.packageNameByFile.get(binding.exportFile),
          config.boundary_rules,
          reachability.value.isPublicEntrypoint,
        ))
      }

      const sortedEntries = entries.sort(compareReachability)
      return {
        exports: sortedEntries,
        calibrationDecisions,
        counts: {
          unused: sortedEntries.filter((entry) => entry.classification === "unused").length,
          "internal-only": sortedEntries.filter((entry) => entry.classification === "internal-only").length,
          "cross-module": sortedEntries.filter((entry) => entry.classification === "cross-module").length,
          "cross-package": sortedEntries.filter((entry) => entry.classification === "cross-package").length,
        },
        boundaryConfined: sortedEntries.filter(
          (entry) =>
            config.boundary_rules.length > 0 &&
            entry.boundaryStatus === "same-boundary" &&
            entry.classification !== "cross-package",
        ),
        diagnosticLimit: config.top_n_diagnostics,
      }
    }),
  score: (out) => {
    if (out.exports.length === 0) return 1
    const weightedUnused = out.exports.reduce((sum, entry) => sum + reachabilityPenalty(entry), 0)
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
      ...out.exports
        .filter(
          (entry) =>
            entry.classification === "unused" ||
            entry.classification === "internal-only",
        )
        .map((entry) => ({
          severity:
            reachabilityPenalty(entry) >= 1
              ? ("warn" as const)
              : ("info" as const),
          message:
            `Export ${entry.exportName} in ${entry.exportFile}: ` +
            `${entry.classification}${entry.evidence !== "runtime" ? ` (${entry.evidence})` : ""}`,
          location: { file: entry.exportFile },
          data: {
            exportFile: entry.exportFile,
            exportName: entry.exportName,
            declarationFiles: entry.declarationFiles.slice(),
            classification: entry.classification,
            evidence: entry.evidence,
            penaltyWeight: entry.penaltyWeight,
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

const calibrateExportReachability = (
  binding: ExportBinding,
  isPublicEntrypoint: boolean,
  calibration: ResolvedCalibrationContext | undefined,
  sourceFacts: TypeScriptSourceExportFacts | undefined,
): Effect.Effect<
  CalibrationSlotOutput<"typescript.export-reachability">,
  CalibrationProcessorError,
  never
> => {
  const input: TypeScriptExportReachabilityValue = {
    exportFile: binding.exportFile,
    exportName: binding.exportName,
    declarationFiles: binding.declarationFiles,
    declarationKinds: binding.localDeclarations.map((declaration) => declaration.getKindName()),
    declarations: binding.localDeclarations.map((declaration) =>
      declarationFactForExport(binding.exportName, declaration)
    ),
    ...(sourceFacts === undefined
      ? {}
      : {
          sourceImports: sourceFacts.imports,
          sourceLocalBindings: sourceFacts.localBindings,
          sourceExportSpecifiers: sourceFacts.exportSpecifiers,
        }),
    isPublicEntrypoint,
  }
  if (calibration === undefined) {
    return Effect.succeed({ value: input, decisions: [] })
  }
  return calibration.runSlot("typescript.export-reachability", input)
}

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  new SignalComputeError({
    signalId: "TS-AB-02-unused-exports",
    message: String(cause),
    cause,
  })

const classifyExport = (
  binding: ExportBinding,
  consumers: ReadonlyArray<ExportConsumer>,
  ownPackage: string | undefined,
  boundaryRules: ReadonlyArray<BoundaryRule>,
  isPublicEntrypoint: boolean,
): ExportReachability => {
  const referenceFiles = consumers
    .map((consumer) => consumer.consumerFile)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => left.localeCompare(right))

  const crossPackage = consumers.some(
    (consumer) =>
      consumer.consumerPackage !== undefined &&
      ownPackage !== undefined &&
      consumer.consumerPackage !== ownPackage,
  )

  const sameFileReferences =
    isPublicEntrypoint || referenceFiles.length > 0
      ? 0
      : countSameFileReferences(binding)

  const classification: ExportClassification =
    isPublicEntrypoint
      ? "cross-package"
      : referenceFiles.length > 0
      ? crossPackage
        ? "cross-package"
        : "cross-module"
      : sameFileReferences > 0
        ? "internal-only"
        : "unused"

  const exportBoundary = boundaryOfFile(binding.exportFile, boundaryRules)
  const crossBoundaryFiles = referenceFiles.filter((file) => {
    const consumerBoundary = boundaryOfFile(file, boundaryRules)
    return exportBoundary !== undefined && consumerBoundary !== undefined && consumerBoundary !== exportBoundary
  })

  const evidence = exportEvidence(binding)

  return {
    exportFile: binding.exportFile,
    exportName: binding.exportName,
    declarationFiles: binding.declarationFiles,
    classification,
    evidence,
    penaltyWeight: evidencePenaltyWeight(evidence),
    viaReExport: binding.viaReExport,
    referenceFiles,
    sameFileReferenceCount: sameFileReferences,
    boundaryStatus:
      exportBoundary === undefined
        ? "unmapped"
        : crossBoundaryFiles.length > 0
          ? "cross-boundary"
          : "same-boundary",
    crossBoundaryFiles,
  }
}

const reachabilityPenalty = (entry: ExportReachability): number => {
  if (entry.classification === "unused") return entry.penaltyWeight
  if (entry.classification === "internal-only") return entry.penaltyWeight * 0.5
  return 0
}

const exportEvidence = (binding: ExportBinding): ExportEvidence => {
  if (isTestHookExportName(binding.exportName)) return "test-hook"
  if (binding.localDeclarations.length > 0 && binding.localDeclarations.every(isTypeOnlyDeclaration)) {
    return "type-only"
  }
  return "runtime"
}

const isTestHookExportName = (name: string): boolean =>
  /(?:ForTest|ForTesting|Test|Testing|Fixture|Mock)(?:$|[A-Z_])/u.test(name)

const isTypeOnlyDeclaration = (node: Node): boolean =>
  Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)

const evidencePenaltyWeight = (evidence: ExportEvidence): number => {
  if (evidence === "runtime") return 1
  if (evidence === "type-only") return 0.35
  return 0.2
}

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
  const penaltyCompare = reachabilityPenalty(right) - reachabilityPenalty(left)
  if (penaltyCompare !== 0) return penaltyCompare
  const fileCompare = left.exportFile.localeCompare(right.exportFile)
  if (fileCompare !== 0) return fileCompare
  return left.exportName.localeCompare(right.exportName)
}
