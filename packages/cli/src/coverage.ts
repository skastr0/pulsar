import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, extname, relative, resolve } from "node:path"
import {
  buildCoverageFactsArtifact,
  CANONICAL_COVERAGE_FACTS_RELATIVE_PATH,
  parseCoverageCandidate,
  type CoverageFacts,
} from "@skastr0/pulsar-core/reference-data"
import { Effect } from "effect"
import { resolveRepoRoot } from "./runtime.js"

export type CoverageIngestFormat = "auto" | "lcov" | "istanbul"

export interface CoverageIngestOptions {
  readonly repoPath: string
  readonly reportPath: string
  readonly format?: CoverageIngestFormat
}

export const runCoverageIngestCommand = (
  opts: CoverageIngestOptions,
): Effect.Effect<number, Error, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const absoluteReportPath = resolve(repoRoot, opts.reportPath)
    const raw = yield* Effect.tryPromise({
      try: () => readFile(absoluteReportPath, "utf8"),
      catch: (cause) =>
        new Error(`Failed to read coverage report at ${absoluteReportPath}: ${String(cause)}`),
    })
    const format = resolveCoverageIngestFormat(opts.reportPath, opts.format ?? "auto")
    const relativeReportPath = relative(repoRoot, absoluteReportPath).replace(/\\/g, "/")
    const candidatePath = candidatePathForFormat(relativeReportPath, format)
    const facts = yield* Effect.try({
      try: () => normalizeIngestedCoverageFacts(
        parseCoverageCandidate(repoRoot, { relativePath: candidatePath, content: raw }, [
          relativeReportPath,
        ]),
        absoluteReportPath,
        relativeReportPath,
      ),
      catch: (cause) =>
        new Error(`Failed to parse ${format} coverage report at ${absoluteReportPath}: ${String(cause)}`),
    })

    const artifactPath = resolve(repoRoot, CANONICAL_COVERAGE_FACTS_RELATIVE_PATH)
    yield* Effect.tryPromise({
      try: async () => {
        await mkdir(dirname(artifactPath), { recursive: true })
        await writeFile(
          artifactPath,
          `${JSON.stringify(buildCoverageFactsArtifact(facts), null, 2)}\n`,
          "utf8",
        )
      },
      catch: (cause) =>
        new Error(`Failed to write coverage facts at ${artifactPath}: ${String(cause)}`),
    })

    console.log(`Coverage facts written: ${CANONICAL_COVERAGE_FACTS_RELATIVE_PATH}`)
    console.log(`State: ${facts.state}`)
    console.log(`Lines: ${(facts.summary.lines.pct * 100).toFixed(1)}%`)
    return 0
  })

const resolveCoverageIngestFormat = (
  reportPath: string,
  requested: CoverageIngestFormat,
): Exclude<CoverageIngestFormat, "auto"> => {
  if (requested === "lcov" || requested === "istanbul") return requested
  const extension = extname(reportPath).toLowerCase()
  if (extension === ".json") return "istanbul"
  if (extension === ".info" || extension === ".lcov") return "lcov"
  throw new Error("--format auto supports .info, .lcov, and .json coverage reports")
}

const candidatePathForFormat = (
  relativeReportPath: string,
  format: Exclude<CoverageIngestFormat, "auto">,
): string =>
  format === "istanbul"
    ? ensureParserSuffix(relativeReportPath, ".json")
    : ensureParserSuffix(relativeReportPath, ".info")

const ensureParserSuffix = (path: string, extension: ".json" | ".info"): string =>
  path.endsWith(extension) ? path : `${path}${extension}`

const normalizeIngestedCoverageFacts = (
  facts: CoverageFacts,
  absoluteReportPath: string,
  relativeReportPath: string,
): CoverageFacts => ({
  ...facts,
  sourcePath: absoluteReportPath,
  checkedPaths: [relativeReportPath],
})
