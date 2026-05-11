import { Effect, Schema } from "effect"
import { SignalContextTag } from "./context.js"
import { type Diagnostic } from "./diagnostic.js"
import { SignalComputeError } from "./errors.js"
import type { Signal } from "./signal.js"
import { clamp01 } from "./shared-history.js"
import { computeChurnRateOutput } from "./shared-03-compute.js"

export const Shared03ChurnRateConfig = Schema.Struct({
  window_days: Schema.Number,
  max_mature_commits: Schema.Number,
  similarity_threshold: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
})
export type Shared03ChurnRateConfig = typeof Shared03ChurnRateConfig.Type

export interface Shared03FileRate {
  readonly introduced: number
  readonly churned: number
  readonly rate: number
}

export interface Shared03ChurnRateOutput {
  readonly churnedLineCount: number
  readonly introducedLineCount: number
  readonly churnRate: number
  readonly byFile: ReadonlyMap<string, Shared03FileRate>
  readonly windowDays: number
  readonly insufficientHistory: boolean
  readonly skippedReason?: string
}

/**
 * SHARED-03 — line survival within a configurable revert window. The
 * signal evaluates lines introduced in the most recent fully matured
 * window, so runtime and output stay tied to current review pain instead of
 * scanning all historical churn.
 */
export const Shared03ChurnRate: Signal<
  Shared03ChurnRateConfig,
  Shared03ChurnRateOutput,
  SignalContextTag
> = {
  id: "SHARED-03-churn-rate",
  title: "Churn rate",
  aliases: ["SHARED-03"],
  tier: 1.5,
  category: "review-pain",
  kind: "legibility",
  cacheVersion: "applicability-v1",
  configSchema: Shared03ChurnRateConfig,
  defaultConfig: {
    window_days: 14,
    max_mature_commits: 500,
    similarity_threshold: 0.8,
    include_extensions: [".ts", ".tsx", ".js", ".jsx", ".rs"],
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/target/**",
      ".*/**",
      "**/.*/**",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "fixture/**",
      "**/fixture/**",
      "fixtures/**",
      "**/fixtures/**",
      "sample/**",
      "**/sample/**",
      "samples/**",
      "**/samples/**",
      "playground/**",
      "playground-*/**",
      "playgrounds/**",
      "**/playground/**",
      "**/playground-*/**",
      "**/playgrounds/**",
      "template/**",
      "**/template/**",
      "templates/**",
      "**/templates/**",
      "**/_generated/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
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
      "**/__snapshots__/**",
      "**/*.snap",
      "**/*.lock",
      "**/bun.lock",
      "**/bun.lockb",
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
    ],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag

      return yield* Effect.tryPromise({
        try: () => computeChurnRateOutput(ctx, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-03-churn-rate",
            message: `Failed to compute churn rate: ${String(cause)}`,
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.insufficientHistory) return 1
    return 1 - clamp01(out.churnRate / 0.3)
  },
  outputMetadata: (out) =>
    out.insufficientHistory
      ? { applicability: "insufficient_evidence" as const }
      : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.insufficientHistory) {
      return [
        {
          severity: "info",
          message:
            out.skippedReason ??
            `SHARED-03 has no fully-mature ${out.windowDays}-day history window yet; returning a neutral score`,
        },
      ]
    }

    const churnRatePercent = formatPercent(out.churnRate)
    const noisiestFiles = [...out.byFile.entries()]
      .filter(([, entry]) => entry.churned > 0)
      .sort(
        (a, b) =>
          b[1].churned - a[1].churned ||
          b[1].rate - a[1].rate ||
          b[1].introduced - a[1].introduced ||
          a[0].localeCompare(b[0]),
      )
      .slice(0, 10)

    return noisiestFiles.map(([file, entry]) => ({
      severity: entry.rate >= 0.3 ? ("warn" as const) : ("info" as const),
      message:
        `Recent churn candidate: ${file} churned ${entry.churned}/${entry.introduced} introduced lines ` +
        `within ${out.windowDays} days (${formatPercent(entry.rate)} file churn; ${churnRatePercent} repo churn)`,
      location: { file },
      data: {
        introduced: entry.introduced,
        churned: entry.churned,
        rate: entry.rate,
        repoIntroduced: out.introducedLineCount,
        repoChurned: out.churnedLineCount,
        repoRate: out.churnRate,
      },
    }))
  },
}

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`
