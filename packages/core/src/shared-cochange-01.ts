import { Effect, Schema } from "effect"
import { SignalContextTag } from "./context.js"
import type { Diagnostic } from "./diagnostic.js"
import type { Signal } from "./signal.js"
import { SignalComputeError } from "./errors.js"
import { SHARED_PRODUCTION_EXCLUDE_GLOBS } from "./shared-history-defaults.js"
import { listTouchedCommitsInWindow } from "./shared-history-commits.js"
import { readHeadDate } from "./shared-history-git.js"
import { buildCochangePairs, cochangePairKey, type CoChangePair } from "./shared-cochange-pairs.js"
export { cochangePairKey } from "./shared-cochange-pairs.js"
export type { CoChangePair } from "./shared-cochange-pairs.js"

export const SharedCochange01Config = Schema.Struct({
  window_days: Schema.Number,
  max_commits: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  min_co_change_count: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type SharedCochange01Config = typeof SharedCochange01Config.Type

const DEFAULT_SHARED_COCHANGE_01_CONFIG: SharedCochange01Config = {
  window_days: 90,
  max_commits: 500,
  include_extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".rs"],
  exclude_globs: [...SHARED_PRODUCTION_EXCLUDE_GLOBS],
  min_co_change_count: 2,
  top_n_diagnostics: 10,
}

export interface SharedCochange01Output {
  readonly pairs: ReadonlyArray<CoChangePair>
  readonly byPair: ReadonlyMap<string, CoChangePair>
  readonly windowDays: number
  readonly totalCommits: number
  readonly maxCommits: number
  readonly sampled: boolean
  readonly topDiagnostics: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const SharedCochange01: Signal<
  SharedCochange01Config,
  SharedCochange01Output,
  SignalContextTag
> = {
  id: "SHARED-COCHANGE-01-logical-coupling",
  title: "Logical coupling",
  aliases: ["SHARED-COCHANGE-01"],
  tier: 1,
  category: "architectural-drift",
  kind: "legibility",
  cacheVersion: "history-pairs-normalized-config-v1",
  cacheDependencies: ["git-revision-context"],
  configSchema: SharedCochange01Config,
  defaultConfig: DEFAULT_SHARED_COCHANGE_01_CONFIG,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      const normalizedConfig = normalizeSharedCochange01Config(config)
      return yield* Effect.tryPromise({
        try: () => computeCochange(ctx.worktreePath, normalizedConfig),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-COCHANGE-01-logical-coupling",
            message: `Failed to compute logical coupling: ${String(cause)}`,
            cause,
          }),
      })
    }),
  score: () => 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.pairs.slice(0, out.topDiagnostics).map((pair) => ({
      severity: pair.coChangeCount >= 4 ? "warn" : "info",
      message:
        `Logical coupling candidate: ${pair.leftFile} and ${pair.rightFile} ` +
        `changed together ${pair.coChangeCount} times in ${out.windowDays} days`,
      location: { file: pair.leftFile },
      data: { ...pair },
    })),
  outputMetadata: () => ({ applicability: "not_applicable" as const }),
}

const computeCochange = async (
  repoPath: string,
  config: SharedCochange01Config,
): Promise<SharedCochange01Output> => {
  if (config.include_extensions.length === 0) {
    return emptyOutput(config)
  }

  const commits = await listCochangeCommits(repoPath, config)
  const totalCommits = commits.length
  const pairs = buildCochangePairs(commits, config.min_co_change_count)

  return {
    pairs,
    byPair: new Map(pairs.map((pair) => [cochangePairKey(pair.leftFile, pair.rightFile), pair])),
    windowDays: config.window_days,
    totalCommits,
    maxCommits: config.max_commits,
    sampled: totalCommits >= config.max_commits,
    topDiagnostics: config.top_n_diagnostics,
    compositeConsumers: [
      "architecture blast radius",
      "risk hotspot",
      "architecture decay",
    ],
    cacheContributors: [
      "git-revision-context",
      "config.window_days",
      "config.max_commits",
      "config.include_extensions",
      "config.exclude_globs",
      "config.min_co_change_count",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config thresholds only; language-aware structural-edge interpretation belongs to downstream composites",
    enforcementCeiling: ["soft-warning", "trend"],
  }
}

const listCochangeCommits = async (
  repoPath: string,
  config: SharedCochange01Config,
) => {
  const headDate = await readHeadDate(repoPath)
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

const emptyOutput = (config: SharedCochange01Config): SharedCochange01Output => ({
  pairs: [],
  byPair: new Map(),
  windowDays: config.window_days,
  totalCommits: 0,
  maxCommits: config.max_commits,
  sampled: false,
  topDiagnostics: config.top_n_diagnostics,
  compositeConsumers: [
    "architecture blast radius",
    "risk hotspot",
    "architecture decay",
  ],
  cacheContributors: [
    "git-revision-context",
    "config.window_days",
    "config.max_commits",
    "config.include_extensions",
    "config.exclude_globs",
    "config.min_co_change_count",
    "config.top_n_diagnostics",
  ],
  calibrationSurface: "config thresholds only; language-aware structural-edge interpretation belongs to downstream composites",
  enforcementCeiling: ["soft-warning", "trend"],
})

const normalizeSharedCochange01Config = (
  config: SharedCochange01Config,
): SharedCochange01Config => ({
  window_days: normalizePositiveFiniteNumber(
    config.window_days,
    DEFAULT_SHARED_COCHANGE_01_CONFIG.window_days,
  ),
  max_commits: normalizePositiveInteger(
    config.max_commits,
    DEFAULT_SHARED_COCHANGE_01_CONFIG.max_commits,
  ),
  include_extensions: stringArrayOrDefault(config.include_extensions, []),
  exclude_globs: stringArrayOrDefault(
    config.exclude_globs,
    DEFAULT_SHARED_COCHANGE_01_CONFIG.exclude_globs,
  ),
  min_co_change_count: normalizeMinimumCoChangeCount(config.min_co_change_count),
  top_n_diagnostics: normalizeDiagnosticLimit(config.top_n_diagnostics),
})

const normalizePositiveFiniteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const normalizePositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

const normalizeMinimumCoChangeCount = (value: number): number =>
  Number.isFinite(value) ? Math.max(1, Math.floor(value)) : DEFAULT_SHARED_COCHANGE_01_CONFIG.min_co_change_count

const normalizeDiagnosticLimit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0

const stringArrayOrDefault = (
  value: ReadonlyArray<string>,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")
    ? value
    : fallback
