import {
  type CalibrationDecision,
  type CalibrationProcessorError,
  type DistributionalSummary,
  type ResolvedCalibrationContext,
  summarize,
} from "@skastr0/pulsar-core"
import { Effect, Option } from "effect"
import type {
  CalibratedThresholdFunctions,
  CollectedSizes,
  FileSize,
  FunctionSize,
  FunctionSizeCandidate,
  ThresholdSummary,
  TsLd02Config,
  TsLd02Output,
} from "./ts-ld-02-model.js"
import { functionDiagnosticKey } from "./ts-ld-02-model.js"

export const summarizeThresholds = (
  collected: CollectedSizes,
  config: TsLd02Config,
): ThresholdSummary => {
  const byFile = summarizeFunctionsByFile(collected.perFileFunctionLocs)
  const fileSizes = summarize(collected.fileLocs)
  const functionSizes = summarize(collected.allFunctionLocs)
  const functionOutlierCutoff = functionSizes.p95 + config.max_function_loc
  const fileOutlierCutoff = fileSizes.p95 + config.max_file_loc
  const outlierFunctionCandidatesAll = collected.allFunctions.filter(
    (f) => f.loc > functionOutlierCutoff,
  )
  const outlierFilesAll = collected.allFiles.filter((f) => f.loc > fileOutlierCutoff)
  const oversizedFunctionCandidatesAll = collected.allFunctions.filter(
    (f) => f.loc > config.max_function_loc,
  )
  const oversizedFilesAll = collected.allFiles.filter((f) => f.loc > config.max_file_loc)

  return {
    byFile,
    fileSizes,
    functionSizes,
    functionOutlierCutoff,
    fileOutlierCutoff,
    outlierFunctionCandidatesAll,
    outlierFilesAll,
    oversizedFunctionCandidatesAll,
    oversizedFilesAll,
    outlierFunctionCandidates: topFunctionCandidates(
      outlierFunctionCandidatesAll,
      config.top_n_diagnostics,
    ),
    outlierFiles: topFiles(outlierFilesAll, config.top_n_diagnostics),
    oversizedFunctionCandidates: topFunctionCandidates(
      oversizedFunctionCandidatesAll,
      config.top_n_diagnostics,
    ),
    oversizedFiles: topFiles(oversizedFilesAll, config.top_n_diagnostics),
    ...computeThresholdPressures(
      collected,
      fileSizes,
      functionSizes,
      functionOutlierCutoff,
      fileOutlierCutoff,
      config,
    ),
  }
}

export const calibrateThresholdFunctions = (
  thresholds: ThresholdSummary,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<CalibratedThresholdFunctions, CalibrationProcessorError, never> =>
  calibrateFunctionNames(thresholds.oversizedFunctionCandidates, calibration).pipe(
    Effect.map(({ functions: oversizedFunctions, calibrationDecisions }) => {
      const oversizedByKey = new Map(
        oversizedFunctions.map((fn) => [functionDiagnosticKey(fn), fn]),
      )
      return {
        outlierFunctions: thresholds.outlierFunctionCandidates.map((candidate) =>
          oversizedByKey.get(functionDiagnosticKey(candidate)) ??
          stripFunctionNameCalibration(candidate),
        ),
        oversizedFunctions,
        calibrationDecisions,
      }
    }),
  )

export const buildTsLd02Output = (
  collected: CollectedSizes,
  thresholds: ThresholdSummary,
  functions: CalibratedThresholdFunctions,
): TsLd02Output => ({
  byFile: thresholds.byFile,
  fileSizes: thresholds.fileSizes,
  functionSizes: thresholds.functionSizes,
  outlierFunctionCount: thresholds.outlierFunctionCandidatesAll.length,
  outlierFileCount: thresholds.outlierFilesAll.length,
  oversizedFunctionCount: thresholds.oversizedFunctionCandidatesAll.length,
  oversizedFileCount: thresholds.oversizedFilesAll.length,
  totalFunctions: collected.allFunctions.length,
  totalFiles: collected.allFiles.length,
  functionOutlierCutoff: thresholds.functionOutlierCutoff,
  fileOutlierCutoff: thresholds.fileOutlierCutoff,
  outlierFunctions: functions.outlierFunctions,
  outlierFiles: thresholds.outlierFiles,
  oversizedFunctions: functions.oversizedFunctions,
  oversizedFiles: thresholds.oversizedFiles,
  calibrationDecisions: functions.calibrationDecisions,
  ratioPressure: thresholds.ratioPressure,
  maxFunctionPressure: thresholds.maxFunctionPressure,
  maxFilePressure: thresholds.maxFilePressure,
})

const summarizeFunctionsByFile = (
  perFileFunctionLocs: ReadonlyMap<string, ReadonlyArray<number>>,
): ReadonlyMap<string, DistributionalSummary> => {
  const byFile = new Map<string, DistributionalSummary>()
  for (const [file, values] of perFileFunctionLocs) {
    byFile.set(file, summarize(values))
  }
  return byFile
}

const topFunctionCandidates = (
  candidates: ReadonlyArray<FunctionSizeCandidate>,
  limit: number,
): ReadonlyArray<FunctionSizeCandidate> =>
  candidates
    .slice()
    .sort((a, b) => b.loc - a.loc)
    .slice(0, limit)

const topFiles = (
  files: ReadonlyArray<FileSize>,
  limit: number,
): ReadonlyArray<FileSize> =>
  files
    .slice()
    .sort((a, b) => b.loc - a.loc)
    .slice(0, limit)

const computeThresholdPressures = (
  collected: CollectedSizes,
  fileSizes: DistributionalSummary,
  functionSizes: DistributionalSummary,
  functionOutlierCutoff: number,
  fileOutlierCutoff: number,
  config: TsLd02Config,
): Pick<ThresholdSummary, "ratioPressure" | "maxFunctionPressure" | "maxFilePressure"> => {
  const totalEntities = collected.allFunctions.length + collected.allFiles.length
  const outlierCount =
    collected.allFunctions.filter((f) => f.loc > functionOutlierCutoff).length +
    collected.allFiles.filter((f) => f.loc > fileOutlierCutoff).length

  return {
    ratioPressure:
      totalEntities === 0 ? 0 : Math.min(1, (outlierCount / totalEntities) * 2),
    maxFunctionPressure: maxThresholdPressure(functionSizes.max, config.max_function_loc),
    maxFilePressure: maxThresholdPressure(fileSizes.max, config.max_file_loc),
  }
}

const maxThresholdPressure = (observed: number, threshold: number): number =>
  observed <= threshold || observed === 0 ? 0 : (observed - threshold) / observed

const calibrateFunctionNames = (
  candidates: ReadonlyArray<FunctionSizeCandidate>,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<
  {
    readonly functions: ReadonlyArray<FunctionSize>
    readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  },
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    if (Option.isNone(calibration)) {
      return {
        functions: candidates.map(stripFunctionNameCalibration),
        calibrationDecisions: [],
      }
    }

    const functions: Array<FunctionSize> = []
    const calibrationDecisions: Array<CalibrationDecision> = []
    for (const candidate of candidates) {
      const callbackContext = candidate.callbackContext
      if (callbackContext === undefined) {
        functions.push(stripFunctionNameCalibration(candidate))
        continue
      }

      const result = yield* calibration.value.runSlot("typescript.callback-context-namer", {
        file: candidate.file,
        line: candidate.line,
        ...callbackContext,
      })
      calibrationDecisions.push(...result.decisions)
      functions.push({
        file: candidate.file,
        line: candidate.line,
        loc: candidate.loc,
        name: result.value.resolvedName,
      })
    }

    return { functions, calibrationDecisions }
  })

const stripFunctionNameCalibration = (
  candidate: FunctionSizeCandidate,
): FunctionSize => ({
  file: candidate.file,
  name: candidate.name,
  line: candidate.line,
  loc: candidate.loc,
})
