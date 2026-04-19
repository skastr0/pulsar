import { join } from "node:path"
import { Effect, Schema } from "effect"
import { SignalContextTag } from "./context.js"
import { type Diagnostic } from "./diagnostic.js"
import { SignalComputeError } from "./errors.js"
import type { Signal } from "./signal.js"
import {
  clamp01,
  latestHistoryEntryAtOrBefore,
  listTrackedFiles,
  readAddedLinesForCommit,
  readFileAtCommit,
  readFileHistory,
  readHeadDate,
} from "./shared-history.js"

export const Shared03ChurnRateConfig = Schema.Struct({
  window_days: Schema.Number,
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
}

/**
 * SHARED-03 — line survival within a configurable revert window. The
 * initial implementation walks each tracked file's follow-history so
 * current TS and Rust packs can consume the same output without diverging
 * on git semantics.
 */
export const Shared03ChurnRate: Signal<
  Shared03ChurnRateConfig,
  Shared03ChurnRateOutput,
  SignalContextTag
> = {
  id: "SHARED-03",
  tier: 1.5,
  category: "review-pain",
  kind: "legibility",
  configSchema: Shared03ChurnRateConfig,
  defaultConfig: {
    window_days: 14,
    similarity_threshold: 0.8,
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
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag

      return yield* Effect.tryPromise({
        try: async (): Promise<Shared03ChurnRateOutput> => {
          const headDate = await readHeadDate(ctx.worktreePath)
          const maturityCutoff = new Date(
            headDate.getTime() - config.window_days * 24 * 3600 * 1000,
          )
          const files = await listTrackedFiles(ctx.worktreePath, {
            includeExtensions: config.include_extensions,
            excludeGlobs: config.exclude_globs,
          })

          const byFile = new Map<string, Shared03FileRate>()
          let introducedLineCount = 0
          let churnedLineCount = 0
          let hasEligibleHistory = false

          for (const relativePath of files) {
            const history = await readFileHistory(ctx.worktreePath, relativePath)
            const eligibleEntries = history.filter(
              (entry) => entry.date.getTime() <= maturityCutoff.getTime(),
            )
            if (eligibleEntries.length > 0) {
              hasEligibleHistory = true
            }

            let fileIntroduced = 0
            let fileChurned = 0

            for (const entry of eligibleEntries) {
              if (entry.renameOnly) continue
              const introducedLines = await readAddedLinesForCommit(
                ctx.worktreePath,
                entry.sha,
                entry.pathAtCommit,
              )
              if (introducedLines.length === 0) continue

              const cutoffEntry =
                latestHistoryEntryAtOrBefore(
                  history,
                  new Date(
                    entry.date.getTime() + config.window_days * 24 * 3600 * 1000,
                  ),
                ) ?? entry

              const targetContent =
                (await readFileAtCommit(
                  ctx.worktreePath,
                  cutoffEntry.sha,
                  cutoffEntry.pathAtCommit,
                )) ?? ""

              const retained = countRetainedLines(
                introducedLines,
                targetContent.split("\n"),
                config.similarity_threshold,
              )

              fileIntroduced += introducedLines.length
              fileChurned += introducedLines.length - retained
            }

            if (fileIntroduced === 0) continue

            const absolutePath = join(ctx.worktreePath, relativePath)
            byFile.set(absolutePath, {
              introduced: fileIntroduced,
              churned: fileChurned,
              rate: fileChurned / fileIntroduced,
            })
            introducedLineCount += fileIntroduced
            churnedLineCount += fileChurned
          }

          const insufficientHistory = !hasEligibleHistory || introducedLineCount === 0

          return {
            churnedLineCount,
            introducedLineCount,
            churnRate: insufficientHistory
              ? 0
              : introducedLineCount === 0
                ? 0
                : churnedLineCount / introducedLineCount,
            byFile,
            windowDays: config.window_days,
            insufficientHistory,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-03",
            message: `Failed to compute churn rate: ${String(cause)}`,
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.insufficientHistory) return 1
    return 1 - clamp01(out.churnRate / 0.3)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.insufficientHistory) {
      return [
        {
          severity: "info",
          message: `SHARED-03 has no fully-mature ${out.windowDays}-day history window yet; returning a neutral score`,
        },
      ]
    }

    const noisiestFiles = [...out.byFile.entries()]
      .sort((a, b) => b[1].rate - a[1].rate)
      .slice(0, 10)

    return noisiestFiles.map(([file, entry]) => ({
      severity: entry.rate >= 0.3 ? ("warn" as const) : ("info" as const),
      message: `Recent churn candidate: ${file} churned ${entry.churned}/${entry.introduced} introduced lines within ${out.windowDays} days`,
      location: { file },
      data: {
        introduced: entry.introduced,
        churned: entry.churned,
        rate: entry.rate,
      },
    }))
  },
}

const countRetainedLines = (
  introducedLines: ReadonlyArray<string>,
  targetLines: ReadonlyArray<string>,
  threshold: number,
): number => {
  const available = targetLines.map((line) => line.trimEnd())
  const used = new Set<number>()
  let retained = 0

  for (const line of introducedLines) {
    const exactIndex = findExactLine(line, available, used)
    if (exactIndex !== undefined) {
      used.add(exactIndex)
      retained += 1
      continue
    }

    const normalizedLine = line.trim()
    let bestIndex: number | undefined
    let bestSimilarity = 0

    for (let i = 0; i < available.length; i += 1) {
      if (used.has(i)) continue
      const candidate = available[i]?.trim() ?? ""
      if (!couldReachThreshold(normalizedLine, candidate, threshold)) continue
      const similarity = similarityScore(normalizedLine, candidate)
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestIndex = i
      }
    }

    if (bestIndex !== undefined && bestSimilarity >= threshold) {
      used.add(bestIndex)
      retained += 1
    }
  }

  return retained
}

const findExactLine = (
  line: string,
  available: ReadonlyArray<string>,
  used: ReadonlySet<number>,
): number | undefined => {
  for (let i = 0; i < available.length; i += 1) {
    if (used.has(i)) continue
    if (available[i] === line) return i
  }
  return undefined
}

const couldReachThreshold = (
  left: string,
  right: string,
  threshold: number,
): boolean => {
  const maxLength = Math.max(left.length, right.length)
  if (maxLength === 0) return true
  return Math.min(left.length, right.length) / maxLength >= threshold
}

const similarityScore = (left: string, right: string): number => {
  if (left === right) return 1
  const maxLength = Math.max(left.length, right.length)
  if (maxLength === 0) return 1
  const distance = levenshtein(left, right)
  return 1 - distance / maxLength
}

const levenshtein = (left: string, right: string): number => {
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1]
    for (let j = 0; j < right.length; j += 1) {
      const insert = (current[j] ?? 0) + 1
      const remove = (previous[j + 1] ?? 0) + 1
      const replace = (previous[j] ?? 0) + (left[i] === right[j] ? 0 : 1)
      current[j + 1] = Math.min(insert, remove, replace)
    }
    previous = current
  }
  return previous[right.length] ?? 0
}
