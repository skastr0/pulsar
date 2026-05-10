import { join } from "node:path"
import { Effect, Schema } from "effect"
import { SignalContextTag } from "./context.js"
import { type Diagnostic } from "./diagnostic.js"
import { SignalComputeError } from "./errors.js"
import type { Signal } from "./signal.js"
import {
  clamp01,
  countCommitsInWindow,
  listAddedLinesByFileInMatureWindow,
  listAddedLineCountInWindow,
  listTrackedFiles,
  readHeadDate,
  readFileAtCommit,
} from "./shared-history.js"

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
        try: async (): Promise<Shared03ChurnRateOutput> => {
          const headDate = await readHeadDate(ctx.worktreePath)
          const maturityCutoff = new Date(
            headDate.getTime() - config.window_days * 24 * 3600 * 1000,
          )
          const introductionStart = new Date(
            headDate.getTime() - config.window_days * 2 * 24 * 3600 * 1000,
          )
          const historyFilter = {
            includeExtensions: config.include_extensions,
            excludeGlobs: config.exclude_globs,
          }
          const matureCommitCount = await countCommitsInWindow(
            ctx.worktreePath,
            introductionStart.toISOString(),
            maturityCutoff.toISOString(),
          )
          if (matureCommitCount > config.max_mature_commits) {
            return {
              churnedLineCount: 0,
              introducedLineCount: 0,
              churnRate: 0,
              byFile: new Map(),
              windowDays: config.window_days,
              insufficientHistory: true,
              skippedReason:
                `mature history window has ${matureCommitCount} commits; ` +
                "skipping expensive line-survival matching",
            }
          }
          const matureAddedLineCount = await listAddedLineCountInWindow(
            ctx.worktreePath,
            introductionStart.toISOString(),
            maturityCutoff.toISOString(),
            historyFilter,
          )
          if (matureAddedLineCount > 50_000) {
            return {
              churnedLineCount: 0,
              introducedLineCount: matureAddedLineCount,
              churnRate: 0,
              byFile: new Map(),
              windowDays: config.window_days,
              insufficientHistory: true,
              skippedReason:
                `mature history window has ${matureAddedLineCount} added lines; ` +
                "skipping expensive line-survival matching",
            }
          }
          const trackedFiles = new Set(
            await listTrackedFiles(ctx.worktreePath, historyFilter),
          )
          const byFile = new Map<string, Shared03FileRate>()
          const introducedByFile = await listAddedLinesByFileInMatureWindow(
            ctx.worktreePath,
            introductionStart.toISOString(),
            maturityCutoff.toISOString(),
            headDate.toISOString(),
            historyFilter,
          )

          const fileRates = await mapWithConcurrency(
            [...introducedByFile.entries()]
              .filter(([relativePath, introducedLines]) =>
                trackedFiles.has(relativePath) && introducedLines.length > 0,
              ),
            8,
            async ([relativePath, introducedLines]) => {
              const targetContent = (await readFileAtCommit(
                ctx.worktreePath,
                ctx.gitSha === "HEAD" ? "HEAD" : ctx.gitSha,
                relativePath,
              )) ?? ""
              const retained = countRetainedLines(
                introducedLines,
                targetContent.split("\n"),
                config.similarity_threshold,
              )
              const fileIntroduced = introducedLines.length
              const fileChurned = introducedLines.length - retained

              return {
                absolutePath: join(ctx.worktreePath, relativePath),
                introduced: fileIntroduced,
                churned: fileChurned,
                rate: fileIntroduced === 0 ? 0 : fileChurned / fileIntroduced,
              }
            },
          )

          let introducedLineCount = 0
          let churnedLineCount = 0
          for (const fileRate of fileRates) {
            if (fileRate.introduced === 0) continue
            byFile.set(fileRate.absolutePath, {
              introduced: fileRate.introduced,
              churned: fileRate.churned,
              rate: fileRate.rate,
            })
            introducedLineCount += fileRate.introduced
            churnedLineCount += fileRate.churned
          }

          const insufficientHistory = introducedLineCount === 0

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

const countRetainedLines = (
  introducedLines: ReadonlyArray<string>,
  targetLines: ReadonlyArray<string>,
  threshold: number,
): number => {
  const available = targetLines.map((line) => line.trimEnd())
  const exactIndex = buildExactLineIndex(available)
  const lengthIndex = buildLengthIndex(available)
  const used = new Set<number>()
  let retained = 0

  for (const line of introducedLines) {
    const exactMatch = findExactLine(line, exactIndex, used)
    if (exactMatch !== undefined) {
      used.add(exactMatch)
      retained += 1
      continue
    }

    const normalizedLine = line.trim()
    let bestIndex: number | undefined
    let bestSimilarity = 0

    for (const i of candidateIndexesByLength(normalizedLine, lengthIndex, threshold)) {
      if (used.has(i)) continue
      const candidate = available[i]?.trim() ?? ""
      const similarity = similarityScoreAtThreshold(
        normalizedLine,
        candidate,
        threshold,
      )
      if (similarity === undefined) continue
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

const buildExactLineIndex = (
  available: ReadonlyArray<string>,
): ReadonlyMap<string, ReadonlyArray<number>> => {
  const exactIndex = new Map<string, Array<number>>()
  for (let i = 0; i < available.length; i += 1) {
    const line = available[i]
    if (line === undefined) continue
    const indexes = exactIndex.get(line) ?? []
    indexes.push(i)
    exactIndex.set(line, indexes)
  }
  return exactIndex
}

const buildLengthIndex = (
  available: ReadonlyArray<string>,
): ReadonlyMap<number, ReadonlyArray<number>> => {
  const lengthIndex = new Map<number, Array<number>>()
  for (let i = 0; i < available.length; i += 1) {
    const length = available[i]?.trim().length
    if (length === undefined) continue
    const indexes = lengthIndex.get(length) ?? []
    indexes.push(i)
    lengthIndex.set(length, indexes)
  }
  return lengthIndex
}

const candidateIndexesByLength = (
  line: string,
  lengthIndex: ReadonlyMap<number, ReadonlyArray<number>>,
  threshold: number,
): ReadonlyArray<number> => {
  const length = line.length
  const minLength = Math.ceil(length * threshold)
  const maxLength = Math.floor(length / threshold)
  const indexes: Array<number> = []

  for (let candidateLength = minLength; candidateLength <= maxLength; candidateLength += 1) {
    indexes.push(...(lengthIndex.get(candidateLength) ?? []))
  }

  return indexes
}

const findExactLine = (
  line: string,
  exactIndex: ReadonlyMap<string, ReadonlyArray<number>>,
  used: ReadonlySet<number>,
): number | undefined => {
  const indexes = exactIndex.get(line)
  if (indexes === undefined) return undefined

  for (const index of indexes) {
    if (!used.has(index)) return index
  }
  return undefined
}

const similarityScoreAtThreshold = (
  left: string,
  right: string,
  threshold: number,
): number | undefined => {
  if (left === right) return 1
  const maxLength = Math.max(left.length, right.length)
  if (maxLength === 0) return 1
  const maxDistance = Math.floor(maxLength * (1 - threshold))
  const distance = levenshteinAtMost(left, right, maxDistance)
  if (distance === undefined) return undefined
  const score = 1 - distance / maxLength
  return score >= threshold ? score : undefined
}

const levenshteinAtMost = (
  left: string,
  right: string,
  maxDistance: number,
): number | undefined => {
  if (Math.abs(left.length - right.length) > maxDistance) return undefined
  if (left.length === 0) return right.length
  if (right.length === 0) return left.length

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 0; i < left.length; i += 1) {
    const current = [i + 1]
    let rowMinimum = current[0] ?? 0
    for (let j = 0; j < right.length; j += 1) {
      const insert = (current[j] ?? 0) + 1
      const remove = (previous[j + 1] ?? 0) + 1
      const replace = (previous[j] ?? 0) + (left[i] === right[j] ? 0 : 1)
      const value = Math.min(insert, remove, replace)
      current[j + 1] = value
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > maxDistance) return undefined
    previous = current
  }
  const distance = previous[right.length] ?? 0
  return distance <= maxDistance ? distance : undefined
}
