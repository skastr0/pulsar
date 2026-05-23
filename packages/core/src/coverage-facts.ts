import { join, normalize } from "node:path"
import { Schema } from "effect"
import { parseIstanbulCoverage } from "./coverage-istanbul.js"
import { parseLcovCoverage } from "./coverage-lcov.js"

export const COVERAGE_REFERENCE_DATA_KEY = "coverage" as const
export const CANONICAL_LCOV_RELATIVE_PATH = "coverage/lcov.info" as const
export const CANONICAL_ISTANBUL_RELATIVE_PATH = "coverage/coverage-final.json" as const

export const CoverageFactState = Schema.Literal(
  "present",
  "zero",
  "absent",
  "unknown",
  "not_configured",
  "not_applicable",
)
export type CoverageFactState = typeof CoverageFactState.Type

export interface CoverageMetric {
  readonly covered: number
  readonly total: number
  readonly pct: number
}

export interface CoverageFileFact {
  readonly file: string
  readonly lines: CoverageMetric
  readonly functions: CoverageMetric
  readonly branches: CoverageMetric
}

export interface CoverageFacts {
  readonly state: CoverageFactState
  readonly tool?: "lcov" | "istanbul"
  readonly sourcePath?: string
  readonly checkedPaths: ReadonlyArray<string>
  readonly files: ReadonlyArray<CoverageFileFact>
  readonly summary: {
    readonly lines: CoverageMetric
    readonly functions: CoverageMetric
    readonly branches: CoverageMetric
  }
  readonly message?: string
}

export interface CoverageCandidate {
  readonly relativePath: string
  readonly content: string
}

export const emptyCoverageMetric = (): CoverageMetric => ({
  covered: 0,
  total: 0,
  pct: 0,
})

export const coverageMetric = (covered: number, total: number): CoverageMetric => ({
  covered,
  total,
  pct: total === 0 ? 1 : covered / total,
})

export const summarizeCoverageFiles = (
  files: ReadonlyArray<CoverageFileFact>,
): CoverageFacts["summary"] => {
  const sum = (select: (file: CoverageFileFact) => CoverageMetric): CoverageMetric => {
    const covered = files.reduce((total, file) => total + select(file).covered, 0)
    const denominator = files.reduce((total, file) => total + select(file).total, 0)
    return coverageMetric(covered, denominator)
  }
  return {
    lines: sum((file) => file.lines),
    functions: sum((file) => file.functions),
    branches: sum((file) => file.branches),
  }
}

export const determineCoverageState = (
  summary: CoverageFacts["summary"],
  files: ReadonlyArray<CoverageFileFact>,
): CoverageFactState => {
  const denominator =
    summary.lines.total + summary.functions.total + summary.branches.total
  const covered =
    summary.lines.covered + summary.functions.covered + summary.branches.covered
  if (files.length === 0 || denominator === 0) return "zero"
  if (covered === 0) return "zero"
  return "present"
}

export const buildAbsentCoverageFacts = (
  checkedPaths: ReadonlyArray<string>,
): CoverageFacts => ({
  state: "absent",
  checkedPaths,
  files: [],
  summary: {
    lines: emptyCoverageMetric(),
    functions: emptyCoverageMetric(),
    branches: emptyCoverageMetric(),
  },
  message: "No supported coverage report found",
})

export const buildUnknownCoverageFacts = (
  checkedPaths: ReadonlyArray<string>,
  message: string,
  sourcePath?: string,
): CoverageFacts => ({
  state: "unknown",
  ...(sourcePath !== undefined ? { sourcePath } : {}),
  checkedPaths,
  files: [],
  summary: {
    lines: emptyCoverageMetric(),
    functions: emptyCoverageMetric(),
    branches: emptyCoverageMetric(),
  },
  message,
})

export const parseCoverageCandidate = (
  repoRoot: string,
  candidate: CoverageCandidate,
  checkedPaths: ReadonlyArray<string>,
): CoverageFacts => {
  const sourcePath = join(repoRoot, candidate.relativePath)
  const extension = candidate.relativePath.endsWith(".json") ? "json" : "lcov"
  const parsed =
    extension === "json"
      ? parseIstanbulCoverage(repoRoot, candidate.content)
      : parseLcovCoverage(repoRoot, candidate.content)
  const summary = summarizeCoverageFiles(parsed.files)
  const state = determineCoverageState(summary, parsed.files)
  return {
    state,
    tool: parsed.tool,
    sourcePath,
    checkedPaths,
    files: parsed.files,
    summary,
    ...(state === "zero" ? { message: "Coverage report contains zero covered items" } : {}),
  }
}

export const resolveCoveragePath = (repoRoot: string, path: string): string =>
  normalize(path.startsWith("/") ? path : join(repoRoot, path))
