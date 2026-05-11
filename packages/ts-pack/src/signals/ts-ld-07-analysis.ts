import { type SourceFile } from "ts-morph"
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
): TsLd07Output => {
  const byFile = new Map<string, UnsafeTypeFileSummary>()
  const occurrences: Array<UnsafeTypeOccurrence> = []
  let analyzedFiles = 0
  let analyzedLines = 0

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()
    if (sourceFile.isDeclarationFile() || isExcluded(file, config.exclude_globs)) continue

    analyzedFiles += 1
    analyzedLines += countNonEmptyLines(sourceFile)

    const fileOccurrences = collectUnsafeTypeOccurrences(sourceFile)
      .map((occurrence) => ({ ...occurrence, file }))
      .sort(compareUnsafeOccurrences)

    if (fileOccurrences.length === 0) continue

    occurrences.push(...fileOccurrences)
    byFile.set(file, summarizeFileOccurrences(fileOccurrences))
  }

  occurrences.sort(compareUnsafeOccurrences)

  return buildUnsafeTypeOutput(byFile, occurrences, analyzedFiles, analyzedLines, config)
}
