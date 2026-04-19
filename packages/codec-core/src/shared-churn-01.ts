import { execFile } from "node:child_process"
import { join } from "node:path"
import { promisify } from "node:util"
import { Effect, Schema } from "effect"
import { SignalComputeError } from "./errors.js"
import { SignalContextTag } from "./context.js"
import type { Signal } from "./signal.js"

const execFileAsync = promisify(execFile)

export const SharedChurn01Config = Schema.Struct({
  window_days: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_paths: Schema.Array(Schema.String),
})
export type SharedChurn01Config = typeof SharedChurn01Config.Type

export interface SharedChurn01Output {
  readonly byFile: ReadonlyMap<string, number>
  readonly windowDays: number
  readonly totalCommits: number
}

/**
 * Per-file churn over a rolling window. The provider is shared across
 * language packs, so the default extension list includes both TS-family
 * and Rust sources.
 */
export const SharedChurn01: Signal<SharedChurn01Config, SharedChurn01Output, SignalContextTag> = {
  id: "SHARED-CHURN-01",
  tier: 1,
  category: "review-pain",
  kind: "legibility",
  configSchema: SharedChurn01Config,
  defaultConfig: {
    window_days: 90,
    include_extensions: [".ts", ".tsx", ".js", ".jsx", ".rs"],
    exclude_paths: ["node_modules/", "dist/", ".turbo/", "target/"],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag

      const headIsoRaw = yield* Effect.tryPromise({
        try: async (): Promise<string> => {
          const result = await execFileAsync(
            "git",
            ["log", "-1", "--format=%cI", "HEAD"],
            { cwd: ctx.worktreePath },
          )
          return result.stdout
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-CHURN-01",
            message: `git log for HEAD date failed: ${String(cause)}`,
            cause,
          }),
      })
      const headDate = new Date(headIsoRaw.trim())
      const sinceDate = new Date(
        headDate.getTime() - config.window_days * 24 * 3600 * 1000,
      )

      const raw = yield* Effect.tryPromise({
        try: async (): Promise<string> => {
          const result = await execFileAsync(
            "git",
            [
              "log",
              `--since=${sinceDate.toISOString()}`,
              `--until=${headDate.toISOString()}`,
              "--name-only",
              "--pretty=format:__commit__",
              "--no-renames",
            ],
            { cwd: ctx.worktreePath },
          )
          return result.stdout
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-CHURN-01",
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
        if (!hasIncludedExtension(trimmed, config.include_extensions)) continue
        if (isExcluded(trimmed, config.exclude_paths)) continue
        const absolute = join(ctx.worktreePath, trimmed)
        byFile.set(absolute, (byFile.get(absolute) ?? 0) + 1)
      }

      return {
        byFile,
        windowDays: config.window_days,
        totalCommits,
      }
    }),
  score: () => 1,
  diagnose: () => [],
}

const hasIncludedExtension = (path: string, extensions: ReadonlyArray<string>): boolean =>
  extensions.some((extension) => path.endsWith(extension))

const isExcluded = (path: string, excludes: ReadonlyArray<string>): boolean =>
  excludes.some((prefix) => path.includes(prefix))
