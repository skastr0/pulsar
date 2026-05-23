import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import {
  computeAnnotationCoverage,
  weightedBoundaryCoverage,
} from "./ts-ld-06-coverage.js"

const TsLd06Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsLd06Config = typeof TsLd06Config.Type

export interface CoverageSummary {
  readonly totalParams: number
  readonly annotatedParams: number
  readonly totalReturns: number
  readonly annotatedReturns: number
  readonly coverage: number
}

export interface FileCoverage {
  readonly boundary: CoverageSummary
  readonly internal: CoverageSummary
}

export interface UncoveredFn {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly missingKind: "params" | "return" | "both"
}

export interface TsLd06Output {
  readonly byFile: ReadonlyMap<string, FileCoverage>
  readonly boundaryCoverage: CoverageSummary
  readonly internalCoverage: CoverageSummary
  readonly uncoveredBoundary: ReadonlyArray<UncoveredFn>
  readonly diagnosticLimit: number
}

export const TsLd06: Signal<TsLd06Config, TsLd06Output, TsProjectTag> = {
  id: "TS-LD-06-annotation-coverage",
  title: "Type annotation coverage",
  aliases: ["TS-LD-06"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "annotation-coverage-v3-contextual-object-boundaries-v1",
  configSchema: TsLd06Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/.pi/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsLd06Output => computeAnnotationCoverage(project, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-06-annotation-coverage",
            message: String(cause),
            cause,
          }),
      })
      return result
  }),
  score: (out) => weightedBoundaryCoverage(out.boundaryCoverage),
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.uncoveredBoundary.slice(0, out.diagnosticLimit).map((fn) => ({
      severity: fn.missingKind === "return" ? "info" : "warn",
      message: `Boundary function \`${fn.name}\` is missing explicit ${fn.missingKind} annotations`,
      location: { file: fn.file, line: fn.line },
      data: { ...fn },
    })),
}
