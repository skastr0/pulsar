import { summarize } from "@skastr0/pulsar-core/signal"
import type { DistributionalSummary } from "@skastr0/pulsar-core/signal"
import {
  factorPathSegment,
  relativeFactorPath,
} from "@skastr0/pulsar-core/factors"
import type {
  CalibrationDecision,
  CalibrationProcessorError,
  ResolvedCalibrationContext,
  TypeScriptSizePolicyValue,
} from "@skastr0/pulsar-core/calibration"
import { Effect, Option } from "effect"
import type {
  CalibratedThresholdSizes,
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
  const diagnosticLimit = normalizeDiagnosticLimit(config.top_n_diagnostics)
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
      diagnosticLimit,
    ),
    outlierFiles: topFiles(outlierFilesAll, diagnosticLimit),
    oversizedFunctionCandidates: topFunctionCandidates(
      oversizedFunctionCandidatesAll,
      diagnosticLimit,
    ),
    oversizedFiles: topFiles(oversizedFilesAll, diagnosticLimit),
    diagnosticLimit,
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
  collected: CollectedSizes,
  config: TsLd02Config,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<CalibratedThresholdSizes, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
    const functionPolicies = yield* calibrateFunctionSizePolicies(
      collected.allFunctions,
      config,
      calibration,
    )
    const filePolicies = yield* calibrateFileSizePolicies(
      collected.allFiles,
      config,
      calibration,
    )

    const outlierFunctionCandidatesAll = functionPolicies.filter(({ candidate, policy }) =>
      isSizePolicyActive(policy) &&
      candidate.loc > thresholds.functionSizes.p95 + policy.maxLoc,
    )
    const oversizedFunctionCandidatesAll = functionPolicies.filter(({ candidate, policy }) =>
      isSizePolicyActive(policy) && candidate.loc > policy.maxLoc,
    )
    const outlierFilePoliciesAll = filePolicies.filter(({ file, policy }) =>
      isSizePolicyActive(policy) && file.loc > thresholds.fileSizes.p95 + policy.maxLoc,
    )
    const oversizedFilePoliciesAll = filePolicies.filter(({ file, policy }) =>
      isSizePolicyActive(policy) && file.loc > policy.maxLoc,
    )

    const outlierFunctionNames = yield* calibrateFunctionNames(
      topFunctionPolicies(
        outlierFunctionCandidatesAll,
        thresholds.diagnosticLimit,
      ).map(({ candidate, policy }) => withFunctionSizePolicy(candidate, policy)),
      calibration,
    )
    const oversizedFunctionNames = yield* calibrateFunctionNames(
      topFunctionPolicies(
        oversizedFunctionCandidatesAll,
        thresholds.diagnosticLimit,
      ).map(({ candidate, policy }) => withFunctionSizePolicy(candidate, policy)),
      calibration,
    )

    const outlierFiles = topFilePolicies(
      outlierFilePoliciesAll,
      thresholds.diagnosticLimit,
    ).map(({ file, policy }) => withFileSizePolicy(file, policy))
    const oversizedFiles = topFilePolicies(
      oversizedFilePoliciesAll,
      thresholds.diagnosticLimit,
    ).map(({ file, policy }) => withFileSizePolicy(file, policy))

    return {
      outlierFunctions: outlierFunctionNames.functions,
      outlierFiles,
      oversizedFunctions: oversizedFunctionNames.functions,
      oversizedFiles,
      outlierFunctionCount: outlierFunctionCandidatesAll.length,
      outlierFileCount: outlierFilePoliciesAll.length,
      oversizedFunctionCount: oversizedFunctionCandidatesAll.length,
      oversizedFileCount: oversizedFilePoliciesAll.length,
      ratioPressure: calibratedRatioPressure(
        collected,
        outlierFunctionCandidatesAll,
        outlierFilePoliciesAll,
      ),
      maxFunctionPressure: maxCalibratedPressure(functionPolicies),
      maxFilePressure: maxCalibratedPressure(filePolicies),
      calibrationDecisions: [
        ...functionPolicies.flatMap(({ decisions }) => decisions),
        ...filePolicies.flatMap(({ decisions }) => decisions),
        ...outlierFunctionNames.calibrationDecisions,
        ...oversizedFunctionNames.calibrationDecisions,
      ],
    }
  })

export const buildTsLd02Output = (
  collected: CollectedSizes,
  thresholds: ThresholdSummary,
  sizes: CalibratedThresholdSizes,
): TsLd02Output => ({
  byFile: thresholds.byFile,
  fileSizes: thresholds.fileSizes,
  functionSizes: thresholds.functionSizes,
  outlierFunctionCount: sizes.outlierFunctionCount,
  outlierFileCount: sizes.outlierFileCount,
  oversizedFunctionCount: sizes.oversizedFunctionCount,
  oversizedFileCount: sizes.oversizedFileCount,
  totalFunctions: collected.allFunctions.length,
  totalFiles: collected.allFiles.length,
  functionOutlierCutoff: thresholds.functionOutlierCutoff,
  fileOutlierCutoff: thresholds.fileOutlierCutoff,
  outlierFunctions: sizes.outlierFunctions,
  outlierFiles: sizes.outlierFiles,
  oversizedFunctions: sizes.oversizedFunctions,
  oversizedFiles: sizes.oversizedFiles,
  diagnosticLimit: thresholds.diagnosticLimit,
  calibrationDecisions: sizes.calibrationDecisions,
  ratioPressure: sizes.ratioPressure,
  maxFunctionPressure: sizes.maxFunctionPressure,
  maxFilePressure: sizes.maxFilePressure,
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

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0

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

type FunctionSizePolicy = {
  readonly candidate: FunctionSizeCandidate
  readonly policy: TypeScriptSizePolicyValue
  readonly decisions: ReadonlyArray<CalibrationDecision>
}

type FileSizePolicy = {
  readonly file: FileSize
  readonly policy: TypeScriptSizePolicyValue
  readonly decisions: ReadonlyArray<CalibrationDecision>
}

const calibrateFunctionSizePolicies = (
  candidates: ReadonlyArray<FunctionSizeCandidate>,
  config: TsLd02Config,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<ReadonlyArray<FunctionSizePolicy>, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
    const policies: Array<FunctionSizePolicy> = []
    for (const candidate of candidates) {
      const input = defaultSizePolicyForFunction(candidate, config, calibration)
      const result = Option.isNone(calibration)
        ? { value: input, decisions: [] }
        : yield* calibration.value.runSlot("typescript.size-policy", input)
      policies.push({ candidate, policy: result.value, decisions: result.decisions })
    }
    return policies
  })

const calibrateFileSizePolicies = (
  files: ReadonlyArray<FileSize>,
  config: TsLd02Config,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<ReadonlyArray<FileSizePolicy>, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
    const policies: Array<FileSizePolicy> = []
    for (const file of files) {
      const input = defaultSizePolicyForFile(file, config, calibration)
      const result = Option.isNone(calibration)
        ? { value: input, decisions: [] }
        : yield* calibration.value.runSlot("typescript.size-policy", input)
      policies.push({ file, policy: result.value, decisions: result.decisions })
    }
    return policies
  })

const defaultSizePolicyForFunction = (
  candidate: FunctionSizeCandidate,
  config: TsLd02Config,
  calibration: Option.Option<ResolvedCalibrationContext>,
): TypeScriptSizePolicyValue => ({
  signalId: "TS-LD-02-function-size-distribution",
  findingId: sizeFindingId("function", candidate.file, candidate.line),
  file: candidate.file,
  kind: "function",
  name: candidate.name,
  line: candidate.line,
  loc: candidate.loc,
  defaultMaxLoc: config.max_function_loc,
  maxLoc: config.max_function_loc,
  visible: true,
  severity: "warn",
  penaltyWeight: 1,
  factorPathPrefix: sizeFactorPathPrefix("function", candidate.file, calibration, candidate.line),
})

const defaultSizePolicyForFile = (
  file: FileSize,
  config: TsLd02Config,
  calibration: Option.Option<ResolvedCalibrationContext>,
): TypeScriptSizePolicyValue => ({
  signalId: "TS-LD-02-function-size-distribution",
  findingId: sizeFindingId("file", file.file),
  file: file.file,
  kind: "file",
  loc: file.loc,
  defaultMaxLoc: config.max_file_loc,
  maxLoc: config.max_file_loc,
  visible: true,
  severity: "warn",
  penaltyWeight: 1,
  factorPathPrefix: sizeFactorPathPrefix("file", file.file, calibration),
})

const sizeFindingId = (kind: "function" | "file", file: string, line?: number): string =>
  `${kind}:${file}${line === undefined ? "" : `:${line}`}`

const sizeFactorPathPrefix = (
  kind: "function" | "file",
  file: string,
  calibration: Option.Option<ResolvedCalibrationContext>,
  line?: number,
): string => {
  const root = Option.isSome(calibration) ? calibration.value.repoFacts.repoRoot : ""
  const relativeFile = relativeFactorPath(file, root)
  return `size.${kind}.${factorPathSegment(relativeFile)}${line === undefined ? "" : `.${line}`}`
}

const isSizePolicyActive = (policy: TypeScriptSizePolicyValue): boolean =>
  policy.visible && policy.penaltyWeight > 0

const topFunctionPolicies = (
  policies: ReadonlyArray<FunctionSizePolicy>,
  limit: number,
): ReadonlyArray<FunctionSizePolicy> =>
  policies
    .slice()
    .sort((a, b) => b.candidate.loc - a.candidate.loc)
    .slice(0, limit)

const topFilePolicies = (
  policies: ReadonlyArray<FileSizePolicy>,
  limit: number,
): ReadonlyArray<FileSizePolicy> =>
  policies
    .slice()
    .sort((a, b) => b.file.loc - a.file.loc)
    .slice(0, limit)

const withFunctionSizePolicy = (
  candidate: FunctionSizeCandidate,
  policy: TypeScriptSizePolicyValue,
): FunctionSizeCandidate => ({
  ...candidate,
  threshold: policy.maxLoc,
  policy: policyMetadata(policy),
})

const withFileSizePolicy = (
  file: FileSize,
  policy: TypeScriptSizePolicyValue,
): FileSize => ({
  ...file,
  threshold: policy.maxLoc,
  policy: policyMetadata(policy),
})

const policyMetadata = (
  policy: TypeScriptSizePolicyValue,
): NonNullable<FunctionSize["policy"]> => ({
  visible: policy.visible,
  severity: policy.severity,
  penaltyWeight: policy.penaltyWeight,
  ...(policy.metadata !== undefined ? { metadata: policy.metadata } : {}),
})

const calibratedRatioPressure = (
  collected: CollectedSizes,
  functionPolicies: ReadonlyArray<FunctionSizePolicy>,
  filePolicies: ReadonlyArray<FileSizePolicy>,
): number => {
  const totalEntities = collected.allFunctions.length + collected.allFiles.length
  if (totalEntities === 0) return 0
  const weightedOutliers =
    functionPolicies.reduce((sum, entry) => sum + entry.policy.penaltyWeight, 0) +
    filePolicies.reduce((sum, entry) => sum + entry.policy.penaltyWeight, 0)
  return Math.min(1, (weightedOutliers / totalEntities) * 2)
}

const maxCalibratedPressure = (
  policies: ReadonlyArray<FunctionSizePolicy | FileSizePolicy>,
): number =>
  policies.reduce((max, entry) => {
    const loc = "candidate" in entry ? entry.candidate.loc : entry.file.loc
    const policy = entry.policy
    if (!isSizePolicyActive(policy)) return max
    return Math.max(
      max,
      Math.min(1, maxThresholdPressure(loc, policy.maxLoc) * policy.penaltyWeight),
    )
  }, 0)

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
        ...(candidate.threshold !== undefined ? { threshold: candidate.threshold } : {}),
        ...(candidate.policy !== undefined ? { policy: candidate.policy } : {}),
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
  ...(candidate.threshold !== undefined ? { threshold: candidate.threshold } : {}),
  ...(candidate.policy !== undefined ? { policy: candidate.policy } : {}),
})
