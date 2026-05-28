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

const DEFAULT_SHARED_CHURN_02_CONFIG: SharedChurn02Config = {
  window_days: 90,
  half_life_days: 14,
  max_commits: 500,
  include_extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".rs"],
  exclude_globs: [...SHARED_PRODUCTION_EXCLUDE_GLOBS],
  top_n_diagnostics: 10,
}

const COMPOSITE_CONSUMERS = [
  "risk hotspot",
  "review shock",
  "architecture decay",
] as const

const CACHE_CONTRIBUTORS = [
  "git-revision-context",
  "config.window_days",
  "config.half_life_days",
  "config.max_commits",
  "config.include_extensions",
  "config.exclude_globs",
  "config.top_n_diagnostics",
] as const

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
  cacheVersion: "exponential-decay-normalized-history-v1",
  cacheDependencies: ["git-revision-context"],
  configSchema: SharedChurn02Config,
  defaultConfig: DEFAULT_SHARED_CHURN_02_CONFIG,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      const normalizedConfig = normalizeSharedChurn02Config(config)
      return yield* Effect.tryPromise({
        try: () => computeWeightedChurn(ctx.worktreePath, normalizedConfig),
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
      .sort(([leftFile, left], [rightFile, right]) =>
        right.weightedChurn - left.weightedChurn ||
        leftFile.localeCompare(rightFile),
      )
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
  if (config.include_extensions.length === 0) {
    return emptyOutput(config)
  }

  const headDate = await readHeadDate(repoPath)
  const commits = await loadWeightedChurnCommits(repoPath, headDate, config)
  const byFile = weightedChurnByFile(commits, headDate, config)

  return outputFromChurn(byFile, commits.length, commits.length >= config.max_commits, config)
}

const loadWeightedChurnCommits = (
  repoPath: string,
  headDate: Date,
  config: SharedChurn02Config,
) => {
  const sinceDate = new Date(headDate.getTime() - config.window_days * 24 * 3600 * 1000)
  return listTouchedCommitsInWindow(
    repoPath,
    sinceDate.toISOString(),
    headDate.toISOString(),
    {
      includeExtensions: config.include_extensions,
      excludeGlobs: config.exclude_globs,
      maxCommits: config.max_commits,
    },
  )
}

const weightedChurnByFile = (
  commits: Awaited<ReturnType<typeof listTouchedCommitsInWindow>>,
  headDate: Date,
  config: SharedChurn02Config,
): ReadonlyMap<string, WeightedChurnFile> => {
  const byFile = new Map<string, WeightedChurnFile>()
  for (const commit of commits) {
    const weight = recencyWeight(headDate, commit.committedAt, config.half_life_days)
    for (const file of commit.files) {
      byFile.set(file, nextWeightedChurnFile(byFile.get(file), commit.committedAt, weight))
    }
  }
  return new Map([...byFile.entries()].sort(([left], [right]) => left.localeCompare(right)))
}

const recencyWeight = (headDate: Date, committedAt: Date, halfLifeDays: number): number => {
  const ageDays = Math.max(0, (headDate.getTime() - committedAt.getTime()) / (24 * 3600 * 1000))
  return 0.5 ** (ageDays / Math.max(1, halfLifeDays))
}

const nextWeightedChurnFile = (
  existing: WeightedChurnFile | undefined,
  committedAt: Date,
  weight: number,
): WeightedChurnFile => {
  const committedAtIso = committedAt.toISOString()
  return {
    touchCount: (existing?.touchCount ?? 0) + 1,
    rawWindowChurn: (existing?.rawWindowChurn ?? 0) + 1,
    weightedChurn: (existing?.weightedChurn ?? 0) + weight,
    lastTouchedAt:
      existing === undefined || committedAtIso > existing.lastTouchedAt
        ? committedAtIso
        : existing.lastTouchedAt,
  }
}

const outputFromChurn = (
  byFile: ReadonlyMap<string, WeightedChurnFile>,
  totalCommits: number,
  sampled: boolean,
  config: SharedChurn02Config,
): SharedChurn02Output => ({
  byFile,
  totalCommits,
  sampled,
  ...sharedOutputMetadata(config),
})

const sharedOutputMetadata = (
  config: SharedChurn02Config,
): Omit<SharedChurn02Output, "byFile" | "totalCommits" | "sampled"> => ({
  windowDays: config.window_days,
  halfLifeDays: config.half_life_days,
  maxCommits: config.max_commits,
  topDiagnostics: config.top_n_diagnostics,
  compositeConsumers: COMPOSITE_CONSUMERS,
  cacheContributors: CACHE_CONTRIBUTORS,
  calibrationSurface: "config thresholds only; downstream composites decide risk meaning",
  enforcementCeiling: ["soft-warning", "trend"],
})

const emptyOutput = (config: SharedChurn02Config): SharedChurn02Output => ({
  byFile: new Map(),
  totalCommits: 0,
  sampled: false,
  ...sharedOutputMetadata(config),
})

const normalizeSharedChurn02Config = (
  config: SharedChurn02Config,
): SharedChurn02Config => ({
  window_days: normalizePositiveFiniteNumber(
    config.window_days,
    DEFAULT_SHARED_CHURN_02_CONFIG.window_days,
  ),
  half_life_days: normalizePositiveFiniteNumber(
    config.half_life_days,
    DEFAULT_SHARED_CHURN_02_CONFIG.half_life_days,
  ),
  max_commits: normalizePositiveInteger(
    config.max_commits,
    DEFAULT_SHARED_CHURN_02_CONFIG.max_commits,
  ),
  include_extensions: stringArrayOrDefault(config.include_extensions, []),
  exclude_globs: stringArrayOrDefault(
    config.exclude_globs,
    DEFAULT_SHARED_CHURN_02_CONFIG.exclude_globs,
  ),
  top_n_diagnostics: normalizeDiagnosticLimit(config.top_n_diagnostics),
})

const normalizePositiveFiniteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const normalizePositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

const normalizeDiagnosticLimit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

const stringArrayOrDefault = (
  value: ReadonlyArray<string>,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : fallback

const formatChurn = (value: number): string => value.toFixed(2)
