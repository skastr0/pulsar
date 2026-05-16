import type { CoverageFileFact } from "./coverage-facts.js"
import { coverageMetric, resolveCoveragePath } from "./coverage-facts.js"

export interface ParsedCoverage {
  readonly tool: "lcov" | "istanbul"
  readonly files: ReadonlyArray<CoverageFileFact>
}

interface MutableLcovRecord {
  file?: string
  linesFound: number
  linesHit: number
  functionsFound: number
  functionsHit: number
  branchesFound: number
  branchesHit: number
}

export const parseLcovCoverage = (
  repoRoot: string,
  content: string,
): ParsedCoverage => {
  const records: Array<CoverageFileFact> = []
  let current = emptyRecord()

  const flush = (): void => {
    if (current.file === undefined) {
      current = emptyRecord()
      return
    }
    records.push({
      file: resolveCoveragePath(repoRoot, current.file),
      lines: coverageMetric(current.linesHit, current.linesFound),
      functions: coverageMetric(current.functionsHit, current.functionsFound),
      branches: coverageMetric(current.branchesHit, current.branchesFound),
    })
    current = emptyRecord()
  }

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (line.startsWith("SF:")) {
      current.file = line.slice("SF:".length)
      continue
    }
    if (line.startsWith("DA:")) {
      current.linesFound += 1
      const [, hitCount] = line.slice("DA:".length).split(",")
      if (Number.parseInt(hitCount ?? "0", 10) > 0) current.linesHit += 1
      continue
    }
    if (line.startsWith("FNDA:")) {
      current.functionsFound += 1
      const [hitCount] = line.slice("FNDA:".length).split(",")
      if (Number.parseInt(hitCount ?? "0", 10) > 0) current.functionsHit += 1
      continue
    }
    if (line.startsWith("BRDA:")) {
      current.branchesFound += 1
      const parts = line.slice("BRDA:".length).split(",")
      const hitCount = parts[3]
      if (hitCount !== undefined && hitCount !== "-" && Number.parseInt(hitCount, 10) > 0) {
        current.branchesHit += 1
      }
      continue
    }
    if (line.startsWith("LF:")) {
      current.linesFound = Number.parseInt(line.slice("LF:".length), 10) || current.linesFound
      continue
    }
    if (line.startsWith("LH:")) {
      current.linesHit = Number.parseInt(line.slice("LH:".length), 10) || current.linesHit
      continue
    }
    if (line.startsWith("FNF:")) {
      current.functionsFound =
        Number.parseInt(line.slice("FNF:".length), 10) || current.functionsFound
      continue
    }
    if (line.startsWith("FNH:")) {
      current.functionsHit =
        Number.parseInt(line.slice("FNH:".length), 10) || current.functionsHit
      continue
    }
    if (line.startsWith("BRF:")) {
      current.branchesFound =
        Number.parseInt(line.slice("BRF:".length), 10) || current.branchesFound
      continue
    }
    if (line.startsWith("BRH:")) {
      current.branchesHit =
        Number.parseInt(line.slice("BRH:".length), 10) || current.branchesHit
      continue
    }
    if (line === "end_of_record") flush()
  }
  flush()

  return { tool: "lcov", files: records }
}

const emptyRecord = (): MutableLcovRecord => ({
  linesFound: 0,
  linesHit: 0,
  functionsFound: 0,
  functionsHit: 0,
  branchesFound: 0,
  branchesHit: 0,
})
