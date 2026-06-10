import { join } from "node:path"
import type { SignalContext } from "./context.js"
import { mapWithConcurrency } from "./concurrency.js"
import {
  countCommitsInWindow,
  listAddedLineCountInWindow,
  listAddedLinesByFileInMatureWindow,
  readFileAtCommit,
  readHeadDate,
  type SharedHistoryFilterConfig,
} from "./shared-history.js"
import {
  type Shared03ChurnRateConfig,
  type Shared03ChurnRateOutput,
  type Shared03FileRate,
} from "./shared-03-churn-rate.js"
import { countRetainedLines } from "./shared-03-line-matching.js"

interface ChurnHistoryWindow {
  readonly headDate: Date
  readonly maturityCutoff: Date
  readonly introductionStart: Date
  readonly historyFilter: SharedHistoryFilterConfig
}

interface FileChurnRate {
  readonly absolutePath: string
  readonly introduced: number
  readonly churned: number
  readonly rate: number
  readonly deleted: boolean
}

export const computeChurnRateOutput = async (
  ctx: SignalContext,
  config: Shared03ChurnRateConfig,
): Promise<Shared03ChurnRateOutput> => {
  if (config.include_extensions.length === 0) {
    return neutralChurnOutput(
      config,
      "SHARED-03 has no included source extensions; returning a neutral score",
    )
  }

  const window = await resolveChurnHistoryWindow(ctx, config)
  const skipped = await skippedChurnOutput(ctx, config, window)
  if (skipped !== undefined) return skipped

  const introducedByFile = await listAddedLinesByFileInMatureWindow(
    ctx.worktreePath,
    window.introductionStart.toISOString(),
    window.maturityCutoff.toISOString(),
    window.headDate.toISOString(),
    window.historyFilter,
  )
  const fileRates = await collectFileChurnRates(ctx, config, introducedByFile)
  return summarizeChurnRates(fileRates, config)
}

const resolveChurnHistoryWindow = async (
  ctx: SignalContext,
  config: Shared03ChurnRateConfig,
): Promise<ChurnHistoryWindow> => {
  const headDate = await readHeadDate(ctx.worktreePath)
  return {
    headDate,
    maturityCutoff: new Date(headDate.getTime() - config.window_days * 24 * 3600 * 1000),
    introductionStart: new Date(
      headDate.getTime() - config.window_days * 2 * 24 * 3600 * 1000,
    ),
    historyFilter: {
      includeExtensions: config.include_extensions,
      excludeGlobs: config.exclude_globs,
    },
  }
}

const skippedChurnOutput = async (
  ctx: SignalContext,
  config: Shared03ChurnRateConfig,
  window: ChurnHistoryWindow,
): Promise<Shared03ChurnRateOutput | undefined> => {
  const matureCommitCount = await countCommitsInWindow(
    ctx.worktreePath,
    window.introductionStart.toISOString(),
    window.maturityCutoff.toISOString(),
    window.historyFilter,
  )
  if (matureCommitCount > config.max_mature_commits) {
    return neutralChurnOutput(
      config,
      `mature history window has ${matureCommitCount} commits; skipping expensive line-survival matching`,
    )
  }

  const matureAddedLineCount = await listAddedLineCountInWindow(
    ctx.worktreePath,
    window.introductionStart.toISOString(),
    window.maturityCutoff.toISOString(),
    window.historyFilter,
  )
  return matureAddedLineCount > 50_000
    ? neutralChurnOutput(
        config,
        `mature history window has ${matureAddedLineCount} added lines; skipping expensive line-survival matching`,
        matureAddedLineCount,
      )
    : undefined
}

const neutralChurnOutput = (
  config: Shared03ChurnRateConfig,
  skippedReason: string,
  introducedLineCount = 0,
): Shared03ChurnRateOutput => ({
  churnedLineCount: 0,
  introducedLineCount,
  churnRate: 0,
  byFile: new Map(),
  windowDays: config.window_days,
  topDiagnostics: config.top_n_diagnostics,
  insufficientHistory: true,
  skippedReason,
  deletedFileCount: 0,
})

const collectFileChurnRates = async (
  ctx: SignalContext,
  config: Shared03ChurnRateConfig,
  introducedByFile: ReadonlyMap<string, ReadonlyArray<string>>,
): Promise<ReadonlyArray<FileChurnRate>> =>
  mapWithConcurrency(
    [...introducedByFile.entries()].filter(([, introducedLines]) => introducedLines.length > 0),
    8,
    ([relativePath, introducedLines]) =>
      computeFileChurnRate(ctx, config, relativePath, introducedLines),
  )

const computeFileChurnRate = async (
  ctx: SignalContext,
  config: Shared03ChurnRateConfig,
  relativePath: string,
  introducedLines: ReadonlyArray<string>,
): Promise<FileChurnRate> => {
  const targetContent = await readFileAtCommit(
    ctx.worktreePath,
    ctx.gitSha === "HEAD" ? "HEAD" : ctx.gitSha,
    relativePath,
  )
  if (targetContent === undefined) {
    // The whole file is gone at the target commit. Deleting a file is
    // cleanup, not rework-thrash of retained code — and a churn diagnostic
    // citing a path that no longer exists is incoherent. Excluded from the
    // churn ratio; surfaced separately via deletedFileCount.
    return {
      absolutePath: join(ctx.worktreePath, relativePath),
      introduced: introducedLines.length,
      churned: 0,
      rate: 0,
      deleted: true,
    }
  }
  const retained = countRetainedLines(
    introducedLines,
    targetContent.split("\n"),
    config.similarity_threshold,
  )
  const introduced = introducedLines.length
  const churned = introducedLines.length - retained
  return {
    absolutePath: join(ctx.worktreePath, relativePath),
    introduced,
    churned,
    rate: introduced === 0 ? 0 : churned / introduced,
    deleted: false,
  }
}

const summarizeChurnRates = (
  fileRates: ReadonlyArray<FileChurnRate>,
  config: Shared03ChurnRateConfig,
): Shared03ChurnRateOutput => {
  const byFile = new Map<string, Shared03FileRate>()
  let introducedLineCount = 0
  let churnedLineCount = 0
  let deletedFileCount = 0

  for (const fileRate of fileRates) {
    if (fileRate.introduced === 0) continue
    if (fileRate.deleted) {
      deletedFileCount += 1
      continue
    }
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
    churnRate: insufficientHistory ? 0 : churnedLineCount / introducedLineCount,
    byFile,
    windowDays: config.window_days,
    topDiagnostics: config.top_n_diagnostics,
    insufficientHistory,
    deletedFileCount,
  }
}
