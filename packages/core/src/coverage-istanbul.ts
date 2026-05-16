import type { CoverageFileFact } from "./coverage-facts.js"
import { coverageMetric, resolveCoveragePath } from "./coverage-facts.js"
import type { ParsedCoverage } from "./coverage-lcov.js"

interface IstanbulFileCoverage {
  readonly path?: string
  readonly s?: Record<string, number>
  readonly f?: Record<string, number>
  readonly b?: Record<string, ReadonlyArray<number>>
}

export const parseIstanbulCoverage = (
  repoRoot: string,
  content: string,
): ParsedCoverage => {
  const parsed = JSON.parse(content) as Record<string, IstanbulFileCoverage>
  const files: Array<CoverageFileFact> = []

  for (const [key, value] of Object.entries(parsed)) {
    if (value === null || typeof value !== "object") continue
    const statementHits = Object.values(value.s ?? {})
    const functionHits = Object.values(value.f ?? {})
    const branchHits = Object.values(value.b ?? {}).flat()
    files.push({
      file: resolveCoveragePath(repoRoot, value.path ?? key),
      lines: coverageMetric(
        statementHits.filter((hitCount) => hitCount > 0).length,
        statementHits.length,
      ),
      functions: coverageMetric(
        functionHits.filter((hitCount) => hitCount > 0).length,
        functionHits.length,
      ),
      branches: coverageMetric(
        branchHits.filter((hitCount) => hitCount > 0).length,
        branchHits.length,
      ),
    })
  }

  return { tool: "istanbul", files }
}
