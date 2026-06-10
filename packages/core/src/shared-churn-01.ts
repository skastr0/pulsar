import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect, Schema } from "effect"
import { matchesAnyGlob } from "./globs.js"
import { SignalComputeError } from "./errors.js"
import { SignalContextTag } from "./context.js"
import type { Signal } from "./signal.js"

const execFileAsync = promisify(execFile)
const GIT_MAX_BUFFER_BYTES = 256 * 1024 * 1024

export const SharedChurn01Config = Schema.Struct({
  window_days: Schema.Number,
  max_commits: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_paths: Schema.Array(Schema.String),
})
export type SharedChurn01Config = typeof SharedChurn01Config.Type

const DEFAULT_SHARED_CHURN_01_CONFIG: SharedChurn01Config = {
  window_days: 90,
  max_commits: 500,
  include_extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".rs"],
  exclude_paths: ["node_modules/", "dist/", ".turbo/", "target/"],
}

export interface SharedChurn01Output {
  readonly byFile: ReadonlyMap<string, number>
  readonly windowDays: number
  readonly totalCommits: number
  readonly maxCommits?: number
  readonly sampled?: boolean
}

/**
 * Per-file churn over a rolling window. The provider is shared across
 * language packs, so the default extension list includes both TS-family
 * and Rust sources.
 */
export const SharedChurn01: Signal<SharedChurn01Config, SharedChurn01Output, SignalContextTag> = {
  id: "SHARED-CHURN-01-recent-churn",
  title: "Recent churn",
  aliases: ["SHARED-CHURN-01"],
  tier: 1,
  category: "review-pain",
  kind: "legibility",
  role: "provider",
  cacheVersion: "provider-not-applicable-git-context-v1",
  cacheDependencies: ["git-revision-context"],
  configSchema: SharedChurn01Config,
  defaultConfig: DEFAULT_SHARED_CHURN_01_CONFIG,
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      const normalizedConfig = normalizeSharedChurn01Config(config)

      const headIsoRaw = yield* Effect.tryPromise({
        try: async (): Promise<string> => {
          const result = await execFileAsync(
            "git",
            ["log", "-1", "--format=%cI", "HEAD"],
            { cwd: ctx.worktreePath, maxBuffer: GIT_MAX_BUFFER_BYTES },
          )
          return result.stdout
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-CHURN-01-recent-churn",
            message: `git log for HEAD date failed: ${String(cause)}`,
            cause,
          }),
      })
      const headDate = new Date(headIsoRaw.trim())
      const sinceDate = new Date(
        headDate.getTime() - normalizedConfig.window_days * 24 * 3600 * 1000,
      )
      const pathspecs = sourcePathspecs(normalizedConfig.include_extensions)
      if (pathspecs.length === 0) {
        return emptyOutput(normalizedConfig)
      }

      const raw = yield* Effect.tryPromise({
        try: async (): Promise<string> => {
          const result = await execFileAsync(
            "git",
            [
              "log",
              `--max-count=${normalizedConfig.max_commits}`,
              `--since=${sinceDate.toISOString()}`,
              `--until=${headDate.toISOString()}`,
              "--name-only",
              "--pretty=format:__commit__",
              "--find-renames=100%",
              "--",
              ...pathspecs,
            ],
            { cwd: ctx.worktreePath, maxBuffer: GIT_MAX_BUFFER_BYTES },
          )
          return result.stdout
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-CHURN-01-recent-churn",
            message: `git log failed: ${String(cause)}`,
            cause,
          }),
      })

      const byFile = new Map<string, number>()
      let totalCommits = 0
      for (const line of raw.split("\n")) {
        const trimmed = line.trim()
        if (trimmed === "") continue
        if (trimmed === "__commit__") {
          totalCommits += 1
          continue
        }
        if (!hasIncludedExtension(trimmed, normalizedConfig.include_extensions)) continue
        if (isExcluded(trimmed, normalizedConfig.exclude_paths)) continue
        const absolute = join(ctx.worktreePath, trimmed)
        byFile.set(absolute, (byFile.get(absolute) ?? 0) + 1)
      }

      return {
        byFile,
        windowDays: normalizedConfig.window_days,
        totalCommits,
        maxCommits: normalizedConfig.max_commits,
        sampled: totalCommits >= normalizedConfig.max_commits,
      }
  }),
  score: () => 1,
  diagnose: () => [],
  outputMetadata: () => ({ applicability: "not_applicable" as const }),
}

const normalizeSharedChurn01Config = (
  config: SharedChurn01Config,
): SharedChurn01Config => ({
  window_days: normalizePositiveFiniteNumber(
    config.window_days,
    DEFAULT_SHARED_CHURN_01_CONFIG.window_days,
  ),
  max_commits: normalizePositiveInteger(
    config.max_commits,
    DEFAULT_SHARED_CHURN_01_CONFIG.max_commits,
  ),
  include_extensions: stringArrayOrDefault(config.include_extensions, []),
  exclude_paths: stringArrayOrDefault(
    config.exclude_paths,
    DEFAULT_SHARED_CHURN_01_CONFIG.exclude_paths,
  ),
})

const emptyOutput = (config: SharedChurn01Config): SharedChurn01Output => ({
  byFile: new Map(),
  windowDays: config.window_days,
  totalCommits: 0,
  maxCommits: config.max_commits,
  sampled: false,
})

const normalizePositiveFiniteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback

const normalizePositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

const stringArrayOrDefault = (
  value: ReadonlyArray<string>,
  fallback: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : fallback

const hasIncludedExtension = (path: string, extensions: ReadonlyArray<string>): boolean =>
  extensions.some((extension) => path.endsWith(extension))

const isExcluded = (path: string, excludes: ReadonlyArray<string>): boolean =>
  matchesAnyGlob(path, excludeGlobs(excludes))

const excludeGlobs = (excludes: ReadonlyArray<string>): ReadonlyArray<string> =>
  excludes.flatMap((exclude) => {
    const normalized = exclude.replaceAll("\\", "/").replace(/^\.?\//, "")
    if (normalized.length === 0) return []
    if (normalized.includes("*")) return [normalized]
    if (normalized.endsWith("/")) return [normalized, `${normalized}**`, `**/${normalized}`, `**/${normalized}**`]
    return [normalized, `**/${normalized}`]
  })

const sourcePathspecs = (
  includeExtensions: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  includeExtensions.flatMap((extension) => [
    `:(glob)*${extension}`,
    `:(glob)**/*${extension}`,
  ])
