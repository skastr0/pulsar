import { join } from "node:path"
import { Effect, Schema } from "effect"
import { SignalContextTag } from "./context.js"
import { type Diagnostic } from "./diagnostic.js"
import { SignalComputeError } from "./errors.js"
import {
  DistributionalSummary,
  summarize,
} from "./distribution.js"
import type { Signal } from "./signal.js"
import {
  clamp01,
  countFileLoc,
  listAuthorsForFileInWindow,
  listTouchedFilesInWindow,
  loadAuthorAliases,
  normalizeAuthor,
  readHeadDate,
} from "./shared-history.js"

export const Shared02BusFactorConfig = Schema.Struct({
  window_days: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  min_loc: Schema.Number,
})
export type Shared02BusFactorConfig = typeof Shared02BusFactorConfig.Type

export interface BusFactorInfo {
  readonly busFactor: number
  readonly primaryAuthor: string
  readonly primaryShare: number
  readonly authors: ReadonlyArray<string>
}

export interface Shared02BusFactorOutput {
  readonly byFile: ReadonlyMap<string, BusFactorInfo>
  readonly siloed: ReadonlyArray<{ file: string; author: string }>
  readonly distribution: DistributionalSummary
  readonly windowDays: number
  readonly touchedFileCount: number
}

/**
 * SHARED-02 — language-agnostic knowledge concentration from git history.
 * This lives in core so both the TS and Rust packs can re-export the same
 * deterministic compute instead of growing near-duplicate wrappers.
 */
export const Shared02BusFactor: Signal<
  Shared02BusFactorConfig,
  Shared02BusFactorOutput,
  SignalContextTag
> = {
  id: "SHARED-02",
  tier: 1.5,
  category: "review-pain",
  kind: "legibility",
  configSchema: Shared02BusFactorConfig,
  defaultConfig: {
    window_days: 180,
    include_extensions: [".ts", ".tsx", ".js", ".jsx", ".rs"],
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/target/**",
      "**/__snapshots__/**",
      "**/*.snap",
      "**/*.lock",
      "**/bun.lock",
      "**/bun.lockb",
      "**/package-lock.json",
      "**/pnpm-lock.yaml",
      "**/yarn.lock",
    ],
    min_loc: 50,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag

      return yield* Effect.tryPromise({
        try: async (): Promise<Shared02BusFactorOutput> => {
          const headDate = await readHeadDate(ctx.worktreePath)
          const sinceDate = new Date(
            headDate.getTime() - config.window_days * 24 * 3600 * 1000,
          )
          const aliasMap = await loadAuthorAliases(ctx.worktreePath)
          const touchedFiles = await listTouchedFilesInWindow(
            ctx.worktreePath,
            sinceDate.toISOString(),
            headDate.toISOString(),
            {
              includeExtensions: config.include_extensions,
              excludeGlobs: config.exclude_globs,
            },
          )

          const byFile = new Map<string, BusFactorInfo>()
          const siloed: Array<{ file: string; author: string }> = []

          for (const relativePath of touchedFiles) {
            const absolutePath = join(ctx.worktreePath, relativePath)
            const loc = await countFileLoc(absolutePath).catch(() => 0)
            if (loc < config.min_loc) continue

            const authors = await listAuthorsForFileInWindow(
              ctx.worktreePath,
              relativePath,
              sinceDate.toISOString(),
              headDate.toISOString(),
            )

            if (authors.length === 0) continue

            const counts = new Map<string, number>()
            for (const author of authors) {
              const canonical = normalizeAuthor(author, aliasMap)
              counts.set(canonical, (counts.get(canonical) ?? 0) + 1)
            }

            const sortedAuthors = [...counts.entries()].sort((a, b) => {
              if (b[1] !== a[1]) return b[1] - a[1]
              return a[0].localeCompare(b[0])
            })

            const primary = sortedAuthors[0]
            if (primary === undefined) continue

            const commitCount = sortedAuthors.reduce((sum, entry) => sum + entry[1], 0)
            const authorNames = sortedAuthors.map(([author]) => author)
            const info: BusFactorInfo = {
              busFactor: authorNames.length,
              primaryAuthor: primary[0],
              primaryShare: commitCount === 0 ? 0 : primary[1] / commitCount,
              authors: authorNames,
            }
            byFile.set(absolutePath, info)

            if (info.busFactor === 1) {
              siloed.push({ file: absolutePath, author: info.primaryAuthor })
            }
          }

          return {
            byFile,
            siloed: siloed.sort((a, b) => a.file.localeCompare(b.file)),
            distribution: summarize([...byFile.values()].map((info) => info.busFactor)),
            windowDays: config.window_days,
            touchedFileCount: byFile.size,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-02",
            message: `Failed to compute bus factor: ${String(cause)}`,
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.touchedFileCount === 0) return 1
    return 1 - clamp01((out.siloed.length / out.touchedFileCount) * 2)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.touchedFileCount === 0) {
      return [
        {
          severity: "info",
          message: `SHARED-02 found no relevant files touched in the last ${out.windowDays} days`,
        },
      ]
    }

    return out.siloed.slice(0, 10).map((entry) => ({
      severity: "warn" as const,
      message: `Knowledge silo candidate: ${entry.file} is single-author in the last ${out.windowDays} days (${entry.author})`,
      location: { file: entry.file },
      data: { author: entry.author, windowDays: out.windowDays },
    }))
  },
}
