import { Effect, Schema } from "effect"
import { SignalContextTag } from "./context.js"
import type { Diagnostic } from "./diagnostic.js"
import type { Signal } from "./signal.js"
import { SignalComputeError } from "./errors.js"
import { SHARED_PRODUCTION_EXCLUDE_GLOBS } from "./shared-history-defaults.js"
import { listTouchedCommitsInWindow } from "./shared-history-commits.js"
import { readHeadDate } from "./shared-history-git.js"

export const SharedChurn02Config = Schema.Struct({
  window_days: Schema.Number,
  half_life_days: Schema.Number,
  max_commits: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type SharedChurn02Config = typeof SharedChurn02Config.Type

export interface WeightedChurnFile {
  readonly touchCount: number
  readonly rawWindowChurn: number
  readonly weightedChurn: number
  readonly lastTouchedAt: string
}

export interface SharedChurn02Output {
  readonly byFile: ReadonlyMap<string, WeightedChurnFile>
  readonly windowDays: number
  readonly halfLifeDays: number
  readonly totalCommits: number
  readonly maxCommits: number
  readonly sampled: boolean
  readonly topDiagnostics: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const SharedChurn02: Signal<
  SharedChurn02Config,
  SharedChurn02Output,
  SignalContextTag
> = {
  id: "SHARED-CHURN-02-recency-weighted-churn",
  title: "Recency-weighted churn",
  aliases: ["SHARED-CHURN-02"],
  tier: 1,
  category: "review-pain",
  kind: "legibility",
  cacheVersion: "exponential-decay-v1",
  cacheDependencies: ["git-revision-context"],
  configSchema: SharedChurn02Config,
  defaultConfig: {
    window_days: 90,
    half_life_days: 14,
    max_commits: 500,
    include_extensions: [".ts", ".tsx", ".js", ".jsx", ".rs"],
    exclude_globs: [...SHARED_PRODUCTION_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: () => computeWeightedChurn(ctx.worktreePath, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-CHURN-02-recency-weighted-churn",
            message: `Failed to compute recency-weighted churn: ${String(cause)}`,
            cause,
          }),
      })
    }),
  score: () => 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    [...out.byFile.entries()]
      .sort(([, left], [, right]) => right.weightedChurn - left.weightedChurn)
      .slice(0, out.topDiagnostics)
      .map(([file, churn]) => ({
        severity: churn.weightedChurn >= 2 ? "warn" : "info",
        message:
          `Recency-weighted churn: ${file} has ${formatChurn(churn.weightedChurn)} ` +
          `weighted touches (${churn.rawWindowChurn} raw)`,
        location: { file },
        data: { ...churn },
      })),
  outputMetadata: () => ({ applicability: "not_applicable" as const }),
}

const computeWeightedChurn = async (
  repoPath: string,
  config: SharedChurn02Config,
): Promise<SharedChurn02Output> => {
  const headDate = await readHeadDate(repoPath)
  const sinceDate = new Date(headDate.getTime() - config.window_days * 24 * 3600 * 1000)
  const commits = await listTouchedCommitsInWindow(
    repoPath,
    sinceDate.toISOString(),
    headDate.toISOString(),
    {
      includeExtensions: config.include_extensions,
      excludeGlobs: config.exclude_globs,
      maxCommits: config.max_commits,
    },
  )

  const byFile = new Map<string, WeightedChurnFile>()
  for (const commit of commits) {
    const ageDays = Math.max(
      0,
      (headDate.getTime() - commit.committedAt.getTime()) / (24 * 3600 * 1000),
    )
    const weight = 0.5 ** (ageDays / Math.max(1, config.half_life_days))
    for (const file of commit.files) {
      const existing = byFile.get(file)
      const committedAt = commit.committedAt.toISOString()
      byFile.set(file, {
        touchCount: (existing?.touchCount ?? 0) + 1,
        rawWindowChurn: (existing?.rawWindowChurn ?? 0) + 1,
        weightedChurn: (existing?.weightedChurn ?? 0) + weight,
        lastTouchedAt:
          existing === undefined || committedAt > existing.lastTouchedAt
            ? committedAt
            : existing.lastTouchedAt,
      })
    }
  }

  return {
    byFile: new Map([...byFile.entries()].sort(([left], [right]) => left.localeCompare(right))),
    windowDays: config.window_days,
    halfLifeDays: config.half_life_days,
    totalCommits: commits.length,
    maxCommits: config.max_commits,
    sampled: commits.length >= config.max_commits,
    topDiagnostics: Math.max(0, Math.floor(config.top_n_diagnostics)),
    compositeConsumers: [
      "risk hotspot",
      "review shock",
      "architecture decay",
    ],
    cacheContributors: [
      "git-revision-context",
      "config.window_days",
      "config.half_life_days",
      "config.max_commits",
      "config.include_extensions",
      "config.exclude_globs",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config thresholds only; downstream composites decide risk meaning",
    enforcementCeiling: ["soft-warning", "trend"],
  }
}

const formatChurn = (value: number): string => value.toFixed(2)
