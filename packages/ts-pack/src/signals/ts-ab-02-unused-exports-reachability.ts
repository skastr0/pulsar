import { computeDiagnosticHash, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import type { CalibrationDecision, CalibrationProcessorError, CalibrationSlotOutput, ResolvedCalibrationContext, TypeScriptExportReachabilityValue } from "@skastr0/pulsar-core/calibration"
import { Effect, Option, Schema } from "effect"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import {
  buildReachabilityAnalysis,
  type ExportBinding,
  type TypeScriptSourceExportFacts,
} from "./ts-ab-02-reachability-analysis.js"
import {
  isReExportedByPublicEntrypoint,
  matchingConsumers,
} from "./ts-ab-02-consumer-lookup.js"
import {
  classifyExportReachability,
  compareReachability,
  reachabilityPenalty,
  type ExportClassification,
  type ExportReachability,
} from "./ts-ab-02-reachability-output.js"
import { declarationFactForExport } from "./ts-ab-02-source-export-facts.js"

const BoundaryRuleSchema = Schema.Struct({
  name: Schema.String,
  globs: Schema.Array(Schema.String),
})

const TsAb02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  public_entry_globs: Schema.Array(Schema.String),
  boundary_rules: Schema.Array(BoundaryRuleSchema),
  top_n_diagnostics: Schema.Number,
})
export type TsAb02Config = typeof TsAb02Config.Type

export type TsAb02Output = {
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
        entries.push(classifyExportReachability(
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
