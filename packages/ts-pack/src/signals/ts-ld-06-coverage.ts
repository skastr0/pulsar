import { type Project, type SourceFile } from "ts-morph"
import { isExcluded } from "./shared-globs.js"
import {
  collectTrackedFunctions,
  measureTrackedFunctionCoverage,
  type FunctionCoverageMeasurement,
} from "./ts-ld-06-functions.js"
import type {
  CoverageSummary,
  FileCoverage,
  TsLd06Config,
  TsLd06Output,
  UncoveredFn,
} from "./ts-ld-06-annotation-coverage.js"

interface FileCoverageAnalysis {
  readonly fileCoverage: FileCoverage | undefined
  readonly boundaryTotals: MutableCoverage
  readonly internalTotals: MutableCoverage
  readonly uncoveredBoundary: ReadonlyArray<UncoveredFn>
}

type MutableCoverage = {
  totalParams: number
  annotatedParams: number
  totalReturns: number
  annotatedReturns: number
}

const PARAMETER_COVERAGE_WEIGHT = 4
const RETURN_COVERAGE_WEIGHT = 1

export const computeAnnotationCoverage = (
  project: Project,
  config: TsLd06Config,
): TsLd06Output => {
  const byFile = new Map<string, FileCoverage>()
  const uncoveredBoundary: Array<UncoveredFn> = []
  const boundaryTotals = emptyMutableCoverage()
  const internalTotals = emptyMutableCoverage()

  for (const sourceFile of project.getSourceFiles()) {
    const file = sourceFile.getFilePath()
    if (isExcluded(file, config.exclude_globs)) continue
    const analysis = analyzeAnnotationCoverageFile(sourceFile, file)
    addCoverage(boundaryTotals, analysis.boundaryTotals)
    addCoverage(internalTotals, analysis.internalTotals)
    uncoveredBoundary.push(...analysis.uncoveredBoundary)
    if (analysis.fileCoverage !== undefined) byFile.set(file, analysis.fileCoverage)
  }

  uncoveredBoundary.sort(compareUncoveredBoundary)
  return {
    byFile,
    boundaryCoverage: finalizeCoverage(boundaryTotals),
    internalCoverage: finalizeCoverage(internalTotals),
    uncoveredBoundary,
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
  }
}

export const weightedBoundaryCoverage = (coverage: CoverageSummary): number => {
  const denominator =
    coverage.totalParams * PARAMETER_COVERAGE_WEIGHT +
    coverage.totalReturns * RETURN_COVERAGE_WEIGHT
  const numerator =
    coverage.annotatedParams * PARAMETER_COVERAGE_WEIGHT +
    coverage.annotatedReturns * RETURN_COVERAGE_WEIGHT
  return denominator === 0 ? 1 : numerator / denominator
}

const analyzeAnnotationCoverageFile = (
  sourceFile: SourceFile,
  file: string,
): FileCoverageAnalysis => {
  const boundaryTotals = emptyMutableCoverage()
  const internalTotals = emptyMutableCoverage()
  const uncoveredBoundary: Array<UncoveredFn> = []

  for (const tracked of collectTrackedFunctions(sourceFile)) {
    const target = tracked.boundary ? boundaryTotals : internalTotals
    const measurement = measureTrackedFunctionCoverage(tracked, file)
    addFunctionCoverage(target, measurement)
    if (!tracked.boundary || measurement.missingKind === undefined) continue
    uncoveredBoundary.push({
      file,
      name: tracked.name,
      line: tracked.line,
      missingKind: measurement.missingKind,
    })
  }

  return {
    fileCoverage: fileHasCoverage(boundaryTotals, internalTotals)
      ? {
          boundary: finalizeCoverage(boundaryTotals),
          internal: finalizeCoverage(internalTotals),
        }
      : undefined,
    boundaryTotals,
    internalTotals,
    uncoveredBoundary,
  }
}

const addFunctionCoverage = (
  coverage: MutableCoverage,
  measurement: FunctionCoverageMeasurement,
): void => {
  coverage.totalParams += measurement.paramCount
  coverage.annotatedParams += measurement.annotatedParams
  coverage.totalReturns += 1
  coverage.annotatedReturns += measurement.returnAnnotated ? 1 : 0
}

const addCoverage = (target: MutableCoverage, source: MutableCoverage): void => {
  target.totalParams += source.totalParams
  target.annotatedParams += source.annotatedParams
  target.totalReturns += source.totalReturns
  target.annotatedReturns += source.annotatedReturns
}

const fileHasCoverage = (
  boundary: MutableCoverage,
  internal: MutableCoverage,
): boolean =>
  boundary.totalParams > 0 ||
  boundary.totalReturns > 0 ||
  internal.totalParams > 0 ||
  internal.totalReturns > 0

const emptyMutableCoverage = (): MutableCoverage => ({
  totalParams: 0,
  annotatedParams: 0,
  totalReturns: 0,
  annotatedReturns: 0,
})

const finalizeCoverage = (coverage: MutableCoverage): CoverageSummary => {
  const denominator = coverage.totalParams + coverage.totalReturns
  const numerator = coverage.annotatedParams + coverage.annotatedReturns
  return {
    ...coverage,
    coverage: denominator === 0 ? 1 : numerator / denominator,
  }
}

const compareUncoveredBoundary = (left: UncoveredFn, right: UncoveredFn): number => {
  const missingWeight = (kind: UncoveredFn["missingKind"]): number =>
    kind === "both" ? 2 : 1

  const byMissing = missingWeight(right.missingKind) - missingWeight(left.missingKind)
  if (byMissing !== 0) return byMissing
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.line - right.line
}

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0
