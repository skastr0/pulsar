import type { DistributionalSummary } from "@skastr0/pulsar-core/signal"
import type {
  CalibrationDecision,
  TypeScriptCallbackContextNameValue,
  TypeScriptSizePolicyValue,
} from "@skastr0/pulsar-core/calibration"
import { Schema } from "effect"

export const TsLd02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_function_loc: Schema.Number,
  max_file_loc: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsLd02Config = typeof TsLd02Config.Type

export interface FunctionSize {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly loc: number
  readonly threshold?: number
  readonly policy?: Pick<
    TypeScriptSizePolicyValue,
    "visible" | "severity" | "penaltyWeight" | "metadata"
  >
}

export type FunctionNameCalibrationInput = Omit<
  TypeScriptCallbackContextNameValue,
  "file" | "line"
>

export type FunctionSizeCandidate = FunctionSize & {
  readonly callbackContext?: FunctionNameCalibrationInput
}

export interface FileSize {
  readonly file: string
  readonly loc: number
  readonly threshold?: number
  readonly policy?: Pick<
    TypeScriptSizePolicyValue,
    "visible" | "severity" | "penaltyWeight" | "metadata"
  >
}

export interface TsLd02Output {
  /** Per-file distribution of function LOC. */
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  /** Repo-wide distribution of file LOC. */
  readonly fileSizes: DistributionalSummary
  /** Repo-wide distribution of function LOC. */
  readonly functionSizes: DistributionalSummary
  readonly outlierFunctionCount: number
  readonly outlierFileCount: number
  readonly oversizedFunctionCount: number
  readonly oversizedFileCount: number
  readonly totalFunctions: number
  readonly totalFiles: number
  /** Inclusive floor for function outliers: items must be strictly above this. */
  readonly functionOutlierCutoff: number
  /** Inclusive floor for file outliers: items must be strictly above this. */
  readonly fileOutlierCutoff: number
  /** Top-N true function outliers, sorted largest-first. */
  readonly outlierFunctions: ReadonlyArray<FunctionSize>
  /** Top-N true file outliers, sorted largest-first. */
  readonly outlierFiles: ReadonlyArray<FileSize>
  /** Top-N functions above the absolute max_function_loc threshold. */
  readonly oversizedFunctions: ReadonlyArray<FunctionSize>
  /** Top-N files above the absolute max_file_loc threshold. */
  readonly oversizedFiles: ReadonlyArray<FileSize>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly ratioPressure: number
  readonly maxFunctionPressure: number
  readonly maxFilePressure: number
}

export interface CollectedSizes {
  readonly perFileFunctionLocs: ReadonlyMap<string, ReadonlyArray<number>>
  readonly fileLocs: ReadonlyArray<number>
  readonly allFunctionLocs: ReadonlyArray<number>
  readonly allFunctions: ReadonlyArray<FunctionSizeCandidate>
  readonly allFiles: ReadonlyArray<FileSize>
}

export interface ThresholdSummary {
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly fileSizes: DistributionalSummary
  readonly functionSizes: DistributionalSummary
  readonly functionOutlierCutoff: number
  readonly fileOutlierCutoff: number
  readonly outlierFunctionCandidatesAll: ReadonlyArray<FunctionSizeCandidate>
  readonly outlierFilesAll: ReadonlyArray<FileSize>
  readonly oversizedFunctionCandidatesAll: ReadonlyArray<FunctionSizeCandidate>
  readonly oversizedFilesAll: ReadonlyArray<FileSize>
  readonly outlierFunctionCandidates: ReadonlyArray<FunctionSizeCandidate>
  readonly outlierFiles: ReadonlyArray<FileSize>
  readonly oversizedFunctionCandidates: ReadonlyArray<FunctionSizeCandidate>
  readonly oversizedFiles: ReadonlyArray<FileSize>
  readonly ratioPressure: number
  readonly maxFunctionPressure: number
  readonly maxFilePressure: number
}

export interface CalibratedThresholdFunctions {
  readonly outlierFunctions: ReadonlyArray<FunctionSize>
  readonly oversizedFunctions: ReadonlyArray<FunctionSize>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
}

export interface CalibratedThresholdSizes {
  readonly outlierFunctions: ReadonlyArray<FunctionSize>
  readonly outlierFiles: ReadonlyArray<FileSize>
  readonly oversizedFunctions: ReadonlyArray<FunctionSize>
  readonly oversizedFiles: ReadonlyArray<FileSize>
  readonly outlierFunctionCount: number
  readonly outlierFileCount: number
  readonly oversizedFunctionCount: number
  readonly oversizedFileCount: number
  readonly ratioPressure: number
  readonly maxFunctionPressure: number
  readonly maxFilePressure: number
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
}

export const functionDiagnosticKey = (fn: FunctionSize): string =>
  `${fn.file}\u0000${fn.line}\u0000${fn.loc}`
