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
  listAuthorsByTouchedFileInWindow,
  loadAuthorAliases,
  normalizeAuthor,
  readHeadDate,
} from "./shared-history.js"

export const Shared02BusFactorConfig = Schema.Struct({
  window_days: Schema.Number,
  max_commits: Schema.Number,
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
  readonly loc: number
}

export interface Shared02BusFactorOutput {
  readonly byFile: ReadonlyMap<string, BusFactorInfo>
  readonly siloed: ReadonlyArray<{ file: string; author: string; loc: number }>
  readonly distribution: DistributionalSummary
  readonly windowDays: number
  readonly maxCommits: number
  readonly touchedFileCount: number
  readonly touchedLoc: number
  readonly repoAuthors: ReadonlyArray<string>
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
  cacheVersion: "bounded-history-v3-single-author-pressure",
  configSchema: Shared02BusFactorConfig,
  defaultConfig: {
    window_days: 180,
    max_commits: 5000,
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
          const authorsByFile = await listAuthorsByTouchedFileInWindow(
            ctx.worktreePath,
            sinceDate.toISOString(),
            headDate.toISOString(),
            {
              includeExtensions: config.include_extensions,
              excludeGlobs: config.exclude_globs,
              maxCommits: config.max_commits,
            },
          )

          const byFile = new Map<string, BusFactorInfo>()
          const siloed: Array<{ file: string; author: string; loc: number }> = []
          const repoAuthors = new Set<string>()
          let touchedLoc = 0

          const touchedFiles = await mapWithConcurrency(
            [...authorsByFile.entries()],
            16,
            async ([relativePath, authors]) => {
              const absolutePath = join(ctx.worktreePath, relativePath)
              const loc = await countFileLoc(absolutePath).catch(() => 0)
              return { absolutePath, authors, loc }
            },
          )

          for (const { absolutePath, authors, loc } of touchedFiles) {
            if (loc < config.min_loc) continue
            touchedLoc += loc

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
            for (const author of authorNames) {
              repoAuthors.add(author)
            }
            const info: BusFactorInfo = {
              busFactor: authorNames.length,
              primaryAuthor: primary[0],
              primaryShare: commitCount === 0 ? 0 : primary[1] / commitCount,
              authors: authorNames,
              loc,
            }
            byFile.set(absolutePath, info)

            if (info.busFactor === 1) {
              siloed.push({ file: absolutePath, author: info.primaryAuthor, loc })
            }
          }

          return {
            byFile,
            siloed: siloed.sort((a, b) => b.loc - a.loc || a.file.localeCompare(b.file)),
            distribution: summarize([...byFile.values()].map((info) => info.busFactor)),
            windowDays: config.window_days,
            maxCommits: config.max_commits,
            touchedFileCount: byFile.size,
            touchedLoc,
            repoAuthors: [...repoAuthors].sort((a, b) => a.localeCompare(b)),
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
    if (out.touchedLoc === 0) return 1
    const siloedLoc = out.siloed.reduce((sum, entry) => sum + entry.loc, 0)
    return 1 - Math.min(0.35, clamp01(siloedLoc / out.touchedLoc) * 0.45)
  },
  outputMetadata: (out) => {
    if (out.touchedFileCount === 0 || out.touchedLoc === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    return undefined
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

    if (out.repoAuthors.length < 2) {
      return [
        {
          severity: "info",
          message:
            `SHARED-02 found a single-author corpus in the last ${out.windowDays} days; ` +
            "treating touched production LOC as concentrated ownership",
          data: { authors: out.repoAuthors, windowDays: out.windowDays },
        },
      ]
    }

    return out.siloed.slice(0, 10).map((entry) => ({
      severity: entry.loc >= 200 ? ("warn" as const) : ("info" as const),
      message: `Knowledge silo candidate: ${entry.file} is single-author in the last ${out.windowDays} days (${entry.author}, ${entry.loc} LOC)`,
      location: { file: entry.file },
      data: { author: entry.author, windowDays: out.windowDays, loc: entry.loc },
    }))
  },
}

const mapWithConcurrency = async <A, B>(
  items: ReadonlyArray<A>,
  concurrency: number,
  fn: (item: A) => Promise<B>,
): Promise<Array<B>> => {
  const results = new Array<B>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++
        if (index >= items.length) return
        results[index] = await fn(items[index]!)
      }
    }),
  )

  return results
}
