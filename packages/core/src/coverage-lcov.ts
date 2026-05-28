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
  if (content.trim().length === 0) return { tool: "lcov", files: [] }

  const state: LcovParseState = { records: [], current: emptyRecord() }
  for (const rawLine of content.split(/\r?\n/u)) {
    applyLcovLine(repoRoot, state, rawLine.trim())
  }
  flushLcovRecord(repoRoot, state)

  return { tool: "lcov", files: state.records }
}

interface LcovParseState {
  readonly records: Array<CoverageFileFact>
  current: MutableLcovRecord
}

const flushLcovRecord = (repoRoot: string, state: LcovParseState): void => {
  if (state.current.file !== undefined) {
    state.records.push({
      file: resolveCoveragePath(repoRoot, state.current.file),
      lines: coverageMetric(state.current.linesHit, state.current.linesFound),
      functions: coverageMetric(state.current.functionsHit, state.current.functionsFound),
      branches: coverageMetric(state.current.branchesHit, state.current.branchesFound),
    })
  }
  state.current = emptyRecord()
}

const applyLcovLine = (repoRoot: string, state: LcovParseState, line: string): void => {
  if (line.length === 0) return
  if (line === "end_of_record") return flushLcovRecord(repoRoot, state)

  const field = splitLcovField(line)
  if (field === undefined) return
  switch (field.key) {
    case "SF":
      state.current.file = field.value
      break
    case "DA":
      applyLcovCountedHit(state.current, field.value, "lines")
      break
    case "FNDA":
      applyLcovCountedHit(state.current, field.value, "functions")
      break
    case "BRDA":
      applyLcovBranchHit(state.current, field.value)
      break
    case "LF":
      state.current.linesFound = lcovCountOr(field.value, state.current.linesFound)
      break
    case "LH":
      state.current.linesHit = lcovCountOr(field.value, state.current.linesHit)
      break
    case "FNF":
      state.current.functionsFound = lcovCountOr(field.value, state.current.functionsFound)
      break
    case "FNH":
      state.current.functionsHit = lcovCountOr(field.value, state.current.functionsHit)
      break
    case "BRF":
      state.current.branchesFound = lcovCountOr(field.value, state.current.branchesFound)
      break
    case "BRH":
      state.current.branchesHit = lcovCountOr(field.value, state.current.branchesHit)
      break
  }
}

const splitLcovField = (line: string): { readonly key: string; readonly value: string } | undefined => {
  const separator = line.indexOf(":")
  return separator < 0
    ? undefined
    : { key: line.slice(0, separator), value: line.slice(separator + 1) }
}

const applyLcovCountedHit = (
  record: MutableLcovRecord,
  value: string,
  metric: "lines" | "functions",
): void => {
  const hitCount = value.split(",")[metric === "lines" ? 1 : 0] ?? "0"
  if (metric === "lines") {
    record.linesFound += 1
    if (lcovCountOr(hitCount, 0) > 0) record.linesHit += 1
    return
  }
  record.functionsFound += 1
  if (lcovCountOr(hitCount, 0) > 0) record.functionsHit += 1
}

const applyLcovBranchHit = (record: MutableLcovRecord, value: string): void => {
  record.branchesFound += 1
  const hitCount = value.split(",")[3]
  if (hitCount !== undefined && hitCount !== "-" && lcovCountOr(hitCount, 0) > 0) {
    record.branchesHit += 1
  }
}

const emptyRecord = (): MutableLcovRecord => ({
  linesFound: 0,
  linesHit: 0,
  functionsFound: 0,
  functionsHit: 0,
  branchesFound: 0,
  branchesHit: 0,
})

const lcovCountOr = (raw: string, fallback: number): number =>
  Number.parseInt(raw, 10) || fallback
