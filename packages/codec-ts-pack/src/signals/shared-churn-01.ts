import {
  SignalComputeError,
  SignalContextTag,
  type Signal,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { join } from "node:path"
import { simpleGit } from "simple-git"

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
 * Per-file churn over a rolling window. Output is neutral on its own —
 * churn is a measurement, not a health indicator. It becomes meaningful
 * when combined with complexity in TS-RP-01.
 */
export const SharedChurn01: Signal<SharedChurn01Config, SharedChurn01Output, SignalContextTag> = {
  id: "SHARED-CHURN-01",
  tier: 1,
  category: "review-pain",
  kind: "legibility",
  configSchema: SharedChurn01Config,
  defaultConfig: {
    window_days: 90,
    include_extensions: [".ts", ".tsx", ".js", ".jsx"],
    exclude_paths: ["node_modules/", "dist/", ".turbo/"],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      const git = simpleGit(ctx.worktreePath)

      // Anchor the window to the commit's authored date, not wall-clock.
      // Without this, historical commits always report zero churn — the
      // `--since=N days ago` clause resolves relative to now, not the SHA
      // under test, so any repo whose active-development window predates
      // the scoring run trivially passes review-pain signals.
      const headIsoRaw = yield* Effect.tryPromise({
        try: () => git.raw(["log", "-1", "--format=%cI", "HEAD"]),
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
        try: () =>
          git.raw([
            "log",
            `--since=${sinceDate.toISOString()}`,
            `--until=${headDate.toISOString()}`,
            "--name-only",
            "--pretty=format:__commit__",
            "--no-renames",
          ]),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-CHURN-01",
            message: `git log failed: ${String(cause)}`,
            cause,
          }),
      })

      // Emit absolute paths keyed the same way ts-morph emits them.
      // This removes the previous suffix-match alignment in TS-RP-01,
      // which was fragile on monorepos with duplicated filenames.
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

      return { byFile, windowDays: config.window_days, totalCommits }
    }),
  score: () => 1,
  diagnose: () => [],
}

const hasIncludedExtension = (path: string, exts: ReadonlyArray<string>): boolean => {
  for (const ext of exts) {
    if (path.endsWith(ext)) return true
  }
  return false
}

const isExcluded = (path: string, excludes: ReadonlyArray<string>): boolean => {
  for (const prefix of excludes) {
    if (path.includes(prefix)) return true
  }
  return false
}
