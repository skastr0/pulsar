import { type SourceFile } from "ts-morph"
import type {
  TsLd07Config,
  TsLd07Output,
  UnsafeTypeFileSummary,
  UnsafeTypeOccurrence,
} from "./ts-ld-07-unsafe-type-erosion.js"

export const buildUnsafeTypeOutput = (
  byFile: ReadonlyMap<string, UnsafeTypeFileSummary>,
  occurrences: ReadonlyArray<UnsafeTypeOccurrence>,
  analyzedFiles: number,
  analyzedLines: number,
  config: TsLd07Config,
): TsLd07Output => {
  const weightedUnsafe = occurrences.reduce((sum, occurrence) => sum + occurrence.weight, 0)
  const boundaryOccurrences = occurrences.filter((occurrence) => occurrence.boundary).length
  const boundaryWeightedUnsafe = occurrences.reduce(
    (sum, occurrence) => sum + (occurrence.boundary ? occurrence.weight : 0),
    0,
  )
  const analyzedKloc = Math.max(1, analyzedLines / 1000)
  const densityPerKloc = weightedUnsafe / analyzedKloc

  return {
    byFile,
    occurrences,
    topOccurrences: occurrences.slice(0, config.top_n_diagnostics),
    totalOccurrences: occurrences.length,
    boundaryOccurrences,
    weightedUnsafe,
    boundaryWeightedUnsafe,
    analyzedFiles,
    analyzedLines,
    densityPerKloc,
    densityPressure: thresholdPressure(densityPerKloc, config.max_weighted_unsafe_per_kloc),
    boundaryPressure: thresholdPressure(
      boundaryWeightedUnsafe,
      config.max_boundary_weighted_unsafe,
    ),
    densityThreshold: config.max_weighted_unsafe_per_kloc,
    boundaryThreshold: config.max_boundary_weighted_unsafe,
    diagnosticLimit: config.top_n_diagnostics,
  }
}

export const summarizeFileOccurrences = (
  occurrences: ReadonlyArray<UnsafeTypeOccurrence>,
): UnsafeTypeFileSummary => ({
  occurrences: occurrences.length,
  boundaryOccurrences: occurrences.filter((occurrence) => occurrence.boundary).length,
  weightedUnsafe: occurrences.reduce((sum, occurrence) => sum + occurrence.weight, 0),
  boundaryWeightedUnsafe: occurrences.reduce(
    (sum, occurrence) => sum + (occurrence.boundary ? occurrence.weight : 0),
    0,
  ),
})

export const countNonEmptyLines = (sourceFile: SourceFile): number =>
  sourceFile.getFullText().split(/\r?\n/u).filter((line) => line.trim() !== "").length

export const compareUnsafeOccurrences = (
  left: UnsafeTypeOccurrence,
  right: UnsafeTypeOccurrence,
): number => {
  if (left.boundary !== right.boundary) return left.boundary ? -1 : 1
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.line - right.line
}

const thresholdPressure = (value: number, threshold: number): number =>
  threshold <= 0 ? 0 : value / threshold
