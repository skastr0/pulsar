import {
  ReferenceDataTag,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import {
  COVERAGE_REFERENCE_DATA_KEY,
  type CoverageFacts,
} from "@skastr0/pulsar-core/reference-data"
import { Effect, Option, Schema } from "effect"

export const SharedCov01CoverageFactsConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
})
export type SharedCov01CoverageFactsConfig = typeof SharedCov01CoverageFactsConfig.Type

export interface SharedCov01CoverageFactsOutput extends CoverageFacts {
  readonly topDiagnostics: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

const notConfiguredCoverageFacts = (): CoverageFacts => ({
  state: "not_configured",
  checkedPaths: [],
  files: [],
  summary: {
    lines: { covered: 0, total: 0, pct: 1 },
    functions: { covered: 0, total: 0, pct: 1 },
    branches: { covered: 0, total: 0, pct: 1 },
  },
  message: "Coverage reference data was not loaded",
})

export const SharedCov01CoverageFacts: Signal<
  SharedCov01CoverageFactsConfig,
  SharedCov01CoverageFactsOutput,
  ReferenceDataTag
> = {
  id: "SHARED-COV-01-coverage-facts",
  title: "Coverage facts",
  aliases: ["SHARED-COV-01"],
  tier: 2,
  category: "review-pain",
  kind: "legibility",
  cacheVersion: "reference-data-v1",
  configSchema: SharedCov01CoverageFactsConfig,
  defaultConfig: {
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const referenceData = yield* ReferenceDataTag
      const facts = yield* referenceData.get<CoverageFacts>(COVERAGE_REFERENCE_DATA_KEY)
      return {
        ...(Option.isSome(facts) ? facts.value : notConfiguredCoverageFacts()),
        topDiagnostics: Math.max(0, Math.floor(config.top_n_diagnostics)),
        compositeConsumers: [
          "risk hotspot",
          "contract safety gap",
          "coverage debt",
        ],
        cacheContributors: [
          "reference-data.coverage",
          "coverage/lcov.info",
          "coverage/coverage-final.json",
          "config.top_n_diagnostics",
        ],
        calibrationSurface: "reference-data discovery only; coverage thresholds belong to downstream composites",
        enforcementCeiling: ["trend"],
      }
    }),
  score: () => 1,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: ReadonlyArray<Diagnostic> = [
      {
        severity: out.state === "unknown" ? "warn" : "info",
        message:
          `Coverage facts: ${out.state}` +
          (out.sourcePath !== undefined ? ` from ${out.sourcePath}` : ""),
        data: {
          state: out.state,
          sourcePath: out.sourcePath,
          checkedPaths: out.checkedPaths,
          lineCoverage: out.summary.lines.pct,
          functionCoverage: out.summary.functions.pct,
          branchCoverage: out.summary.branches.pct,
          files: out.files.length,
          compositeConsumers: out.compositeConsumers,
          cacheContributors: out.cacheContributors,
          calibrationSurface: out.calibrationSurface,
          enforcementCeiling: out.enforcementCeiling,
        },
      },
    ]
    return diagnostics.slice(0, out.topDiagnostics)
  },
  outputMetadata: (out) =>
    out.state === "present" || out.state === "zero"
      ? undefined
      : { applicability: "insufficient_evidence" as const },
}
