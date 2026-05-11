import { type SourceFile } from "ts-morph"
import type { CalibrationDecision, CalibrationProcessorError, ResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import { Effect, Option } from "effect"
import { isExcluded } from "./shared-globs.js"
import { collectUnsafeTypeOccurrences } from "./ts-ld-07-classification.js"
import {
  buildUnsafeTypeOutput,
  compareUnsafeOccurrences,
  countNonEmptyLines,
  summarizeFileOccurrences,
} from "./ts-ld-07-output.js"
import type {
  TsLd07Config,
  TsLd07Output,
  UnsafeTypeFileSummary,
  UnsafeTypeOccurrence,
} from "./ts-ld-07-unsafe-type-erosion.js"

export const computeUnsafeTypeErosionOutput = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsLd07Config,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<TsLd07Output, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
  const byFile = new Map<string, UnsafeTypeFileSummary>()
  const occurrences: Array<UnsafeTypeOccurrence> = []
  const calibrationDecisions: Array<CalibrationDecision> = []
  let analyzedFiles = 0
  let analyzedLines = 0

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()
    if (sourceFile.isDeclarationFile() || isExcluded(file, config.exclude_globs)) continue

    analyzedFiles += 1
    analyzedLines += countNonEmptyLines(sourceFile)

    const collectedOccurrences = collectUnsafeTypeOccurrences(sourceFile)
      .map((occurrence) => ({ ...occurrence, file }))
      .sort(compareUnsafeOccurrences)
    const policyResult = yield* applyUnsafeTypePolicy(collectedOccurrences, calibration)
    const fileOccurrences = policyResult.occurrences
    calibrationDecisions.push(...policyResult.calibrationDecisions)

    if (fileOccurrences.length === 0) continue

    occurrences.push(...fileOccurrences)
    byFile.set(file, summarizeFileOccurrences(fileOccurrences))
  }

  occurrences.sort(compareUnsafeOccurrences)

  return buildUnsafeTypeOutput(
    byFile,
    occurrences,
    analyzedFiles,
    analyzedLines,
    config,
    calibrationDecisions,
  )
})

const applyUnsafeTypePolicy = (
  occurrences: ReadonlyArray<UnsafeTypeOccurrence>,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<
  {
    readonly occurrences: ReadonlyArray<UnsafeTypeOccurrence>
    readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  },
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    if (Option.isNone(calibration)) {
      return {
        occurrences: occurrences.filter((occurrence) => occurrence.visible),
        calibrationDecisions: [],
      }
    }

    const adjusted: Array<UnsafeTypeOccurrence> = []
    const calibrationDecisions: Array<CalibrationDecision> = []
    for (const occurrence of occurrences) {
      const policy = yield* calibration.value.runSlot("typescript.unsafe-type-policy", {
        signalId: "TS-LD-07-unsafe-type-erosion",
        findingId: occurrence.findingId,
        file: occurrence.file,
        line: occurrence.line,
        kind: occurrence.kind,
        target: occurrence.target,
        boundary: occurrence.boundary,
        visible: occurrence.visible,
        severity: occurrence.severity,
        baseWeight: occurrence.baseWeight,
        weight: occurrence.weight,
        factorPathPrefix: `unsafe_types.${occurrence.findingId}`,
      })
      calibrationDecisions.push(...policy.decisions)
      if (!policy.value.visible) continue
      adjusted.push({
        ...occurrence,
        boundary: policy.value.boundary,
        severity: policy.value.severity,
        visible: policy.value.visible,
        weight: policy.value.weight,
        policyDecisions: policy.decisions,
      })
    }
    return { occurrences: adjusted, calibrationDecisions }
  })
