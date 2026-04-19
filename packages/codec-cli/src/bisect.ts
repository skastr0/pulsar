import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { promisify } from "node:util"
import {
  CATEGORIES,
  isActive as vectorIsActive,
  timeSeriesConfigOf,
  toObserverJson,
  type Category,
  type MinimumDimension,
  type ObserverOutput,
} from "@taste-codec/core"
import { Effect } from "effect"
import { loadTasteVectorFromPath, makeCodecRuntime } from "./runtime.js"

const execFileAsync = promisify(execFile)

export interface BisectOptions {
  readonly signalId?: string
  readonly observer?: boolean
  readonly vectorPath?: string
  readonly fromSha: string
  readonly toSha: string
  readonly repoPath: string
  readonly concurrency: number
  readonly topCulprits: number
  readonly sampling: BisectSamplingMode
  readonly json: boolean
}

export type BisectSamplingMode =
  | "auto"
  | "full"
  | "merge-only"
  | "adaptive-delta"

export interface BisectSamplingSummary {
  readonly requested: BisectSamplingMode
  readonly applied: Exclude<BisectSamplingMode, "auto">
  readonly totalCommits: number
  readonly scoredCommits: number
  readonly diagnostics: ReadonlyArray<string>
}

interface ScorePoint {
  readonly sha: string
  readonly score: number
}

export interface CommitScore extends ScorePoint {
  readonly diagnosticsCount: number
  readonly firstDiagnostic: string | undefined
}

export interface Culprit {
  readonly sha: string
  readonly prevSha: string
  readonly prevScore: number
  readonly newScore: number
  readonly drop: number
}

export interface BisectReport {
  readonly signalId: string
  readonly repoPath: string
  readonly fromSha: string
  readonly toSha: string
  readonly trajectory: ReadonlyArray<CommitScore>
  readonly culprits: ReadonlyArray<Culprit>
  readonly driftCulprits: ReadonlyArray<Culprit>
  readonly sampling: BisectSamplingSummary
  readonly minScore: number
  readonly maxScore: number
  readonly finalScore: number
  readonly totalDrift: number
}

export interface ObserverCommitMinimum {
  readonly signal: string
  readonly category: Category
  readonly score: number
}

export interface CategoryTrajectory {
  readonly scores: ReadonlyArray<number>
  readonly min: number
  readonly max: number
  readonly final: number
  readonly drift: number
  readonly distinctLevels: number
}

export interface ObserverCommitEntry {
  readonly sha: string
  readonly weightedMean: number
  readonly categories: Record<Category, number>
  readonly minimum: ObserverCommitMinimum | undefined
  readonly hardGateStatus: "pass" | "fail"
  readonly observer: ReturnType<typeof toObserverJson>
}

export interface ObserverBisectReport {
  readonly repoPath: string
  readonly fromSha: string
  readonly toSha: string
  readonly vectorName: string | null
  readonly trajectory: ReadonlyArray<ObserverCommitEntry>
  readonly perCategory: Record<Category, CategoryTrajectory>
  readonly weightedMeanCulprits: ReadonlyArray<Culprit>
  readonly weightedMeanDriftCulprits: ReadonlyArray<Culprit>
  readonly perCategoryCulprits: Record<Category, ReadonlyArray<Culprit>>
  readonly perCategoryDriftCulprits: Record<Category, ReadonlyArray<Culprit>>
  readonly sampling: BisectSamplingSummary
  readonly finalWeightedMean: number
  readonly minWeightedMean: number
  readonly maxWeightedMean: number
  readonly totalDrift: number
  readonly finalMinimumDimension: MinimumDimension | undefined
  readonly hardGateStatusAtFinal: "pass" | "fail"
}

export const runBisectCommand = (opts: BisectOptions) =>
  Effect.gen(function* () {
    const repoPath = resolve(opts.repoPath)
    if (!existsSync(repoPath)) {
      return yield* Effect.fail(new Error(`Path does not exist: ${repoPath}`))
    }

    const vector = yield* loadTasteVectorFromPath(opts.vectorPath)
    const { engine, registry } = yield* makeCodecRuntime(repoPath, vector, {
      timeSeries: {
        enabled: opts.observer === true || opts.signalId === undefined || timeSeriesConfigOf(vector).enabled,
      },
    })
    const observerMode = opts.observer === true || opts.signalId === undefined

    if (observerMode) {
      const activeSignalIds = registry.sorted
        .filter((signal) => vectorIsActive(signal.id, vector))
        .map((signal) => signal.id)
      if (activeSignalIds.length === 0) {
        const vectorSuffix = vector?.id ? ` for vector ${vector.id}` : ""
        return yield* Effect.fail(
          new Error(`Observer mode has no active signals${vectorSuffix}.`),
        )
      }

      const started = Date.now()
      const commits = yield* resolveBisectCommits(repoPath, opts.fromSha, opts.toSha)
      const sampled = yield* sampleObserverTrajectory(
        commits,
        opts.sampling,
        opts.concurrency,
        (sha) => engine.observeCommit(repoPath, sha),
      )
      const elapsedMs = Date.now() - started
      const report = buildObserverReport(sampled.trajectory, {
        repoPath,
        fromSha: opts.fromSha,
        toSha: opts.toSha,
        topCulprits: opts.topCulprits,
        vectorName: vector?.id ?? null,
        sampling: sampled.sampling,
      })

      if (opts.json) {
        console.log(JSON.stringify(report, null, 2))
        return
      }

      printObserverHumanReport(report, elapsedMs, activeSignalIds.length)
      return
    }

    const started = Date.now()
    const commits = yield* resolveBisectCommits(repoPath, opts.fromSha, opts.toSha)
    const sampled = yield* sampleSignalTrajectory(
      commits,
      opts.sampling,
      opts.concurrency,
      (sha) => engine.scoreCommit(repoPath, sha, opts.signalId!),
    )
    const elapsedMs = Date.now() - started

    const culprits = findCulprits(sampled.trajectory, opts.topCulprits)
    const driftCulprits = findDriftCulprits(sampled.trajectory, opts.topCulprits)
    const scores = summarizeScores(sampled.trajectory.map((t) => t.score))

    const report: BisectReport = {
      signalId: opts.signalId,
      repoPath,
      fromSha: opts.fromSha,
      toSha: opts.toSha,
      trajectory: sampled.trajectory,
      culprits,
      driftCulprits,
      sampling: sampled.sampling,
      minScore: scores.min,
      maxScore: scores.max,
      finalScore: scores.final,
      totalDrift: scores.drift,
    }

    if (opts.json) {
      console.log(JSON.stringify(report, null, 2))
      return
    }

    printHumanReport(report, elapsedMs)
  })

const buildObserverReport = (
  results: ReadonlyArray<{ sha: string; result: ObserverOutput }>,
  opts: {
    readonly repoPath: string
    readonly fromSha: string
    readonly toSha: string
    readonly topCulprits: number
    readonly vectorName: string | null
    readonly sampling: BisectSamplingSummary
  },
): ObserverBisectReport => {
  const trajectory = results.map(({ sha, result }) => {
    const observer = toObserverJson(result)
    return {
      sha,
      weightedMean: result.weighted_mean,
      categories: toCategoryScores(result),
      minimum: toObserverCommitMinimum(result.minimum),
      hardGateStatus: result.hard_gate_status,
      observer,
    }
  })

  const weightedMeanScores = summarizeScores(trajectory.map((entry) => entry.weightedMean))
  const weightedMeanCulprits = findCulprits(
    trajectory.map((entry) => ({ sha: entry.sha, score: entry.weightedMean })),
    opts.topCulprits,
  )
  const weightedMeanDriftCulprits = findDriftCulprits(
    trajectory.map((entry) => ({ sha: entry.sha, score: entry.weightedMean })),
    opts.topCulprits,
  )

  const perCategory = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      summarizeCategoryTrajectory(
        trajectory.map((entry) => entry.categories[category]),
      ),
    ]),
  ) as Record<Category, CategoryTrajectory>

  const perCategoryCulprits = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      findCulprits(
        trajectory.map((entry) => ({ sha: entry.sha, score: entry.categories[category] })),
        opts.topCulprits,
      ),
    ]),
  ) as Record<Category, ReadonlyArray<Culprit>>
  const perCategoryDriftCulprits = Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      findDriftCulprits(
        trajectory.map((entry) => ({ sha: entry.sha, score: entry.categories[category] })),
        opts.topCulprits,
      ),
    ]),
  ) as Record<Category, ReadonlyArray<Culprit>>

  const finalObserver = results[results.length - 1]?.result

  return {
    repoPath: opts.repoPath,
    fromSha: opts.fromSha,
    toSha: opts.toSha,
    vectorName: opts.vectorName,
    trajectory,
    perCategory,
    weightedMeanCulprits,
    weightedMeanDriftCulprits,
    perCategoryCulprits,
    perCategoryDriftCulprits,
    sampling: opts.sampling,
    finalWeightedMean: weightedMeanScores.final,
    minWeightedMean: weightedMeanScores.min,
    maxWeightedMean: weightedMeanScores.max,
    totalDrift: weightedMeanScores.drift,
    finalMinimumDimension: finalObserver?.minimum,
    hardGateStatusAtFinal: finalObserver?.hard_gate_status ?? "pass",
  }
}

const toCategoryScores = (output: ObserverOutput): Record<Category, number> =>
  Object.fromEntries(
    CATEGORIES.map((category) => [category, output.categories[category].score]),
  ) as Record<Category, number>

const toObserverCommitMinimum = (
  minimum: MinimumDimension | undefined,
): ObserverCommitMinimum | undefined => {
  if (minimum === undefined) return undefined
  return {
    signal: minimum.signal,
    category: minimum.category,
    score: minimum.score,
  }
}

const summarizeCategoryTrajectory = (
  scores: ReadonlyArray<number>,
): CategoryTrajectory => {
  const summary = summarizeScores(scores)
  return {
    scores,
    min: summary.min,
    max: summary.max,
    final: summary.final,
    drift: summary.drift,
    distinctLevels: summary.distinctLevels,
  }
}

interface RangeCommit {
  readonly sha: string
  readonly parentCount: number
}

const AUTO_FULL_RANGE_THRESHOLD = 500
const ADAPTIVE_INITIAL_SAMPLES = 17
const ADAPTIVE_MAX_GAP = 64
const ADAPTIVE_DELTA_THRESHOLD = 0.08
const ADAPTIVE_MAX_SCORED_COMMITS = 1025

const resolveBisectCommits = (
  repoPath: string,
  fromSha: string,
  toSha: string,
): Effect.Effect<ReadonlyArray<RangeCommit>, Error> =>
  Effect.tryPromise({
    try: async () => {
      const result = await execFileAsync(
        "git",
        ["rev-list", "--reverse", "--parents", `${fromSha}..${toSha}`],
        { cwd: repoPath },
      )
      return result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
          const parts = line.split(/\s+/)
          return {
            sha: parts[0]!,
            parentCount: Math.max(0, parts.length - 1),
          }
        })
    },
    catch: (cause) => new Error(`git rev-list ${fromSha}..${toSha} failed: ${String(cause)}`),
  })

const sampleSignalTrajectory = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<any, unknown, never>,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<CommitScore>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  sampleTrajectory(
    commits,
    requested,
    concurrency,
    scoreCommit,
    (sha, result) => ({
      sha,
      score: result.score,
      diagnosticsCount: result.diagnostics.length,
      firstDiagnostic: result.diagnostics[0]?.message,
    }),
    (entry) => entry.score,
  )

const sampleObserverTrajectory = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  concurrency: number,
  observeCommit: (sha: string) => Effect.Effect<ObserverOutput, unknown, never>,
): Effect.Effect<
  {
    readonly trajectory: ReadonlyArray<{ sha: string; result: ObserverOutput }>
    readonly sampling: BisectSamplingSummary
  },
  unknown,
  never
> =>
  sampleTrajectory(
    commits,
    requested,
    concurrency,
    observeCommit,
    (sha, result) => ({ sha, result }),
    (entry) => entry.result.weighted_mean,
  )

const sampleTrajectory = <Result, Entry extends { readonly sha: string }>(
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
  getScore: (entry: Entry) => number,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<Entry>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  Effect.gen(function* () {
    const plan = resolveSamplingPlan(commits, requested)
    if (plan.applied === "full") {
      const trajectory = yield* scoreTrajectoryIndexes(
        allIndexes(commits.length),
        commits,
        concurrency,
        scoreCommit,
        toEntry,
      )
      return {
        trajectory,
        sampling: {
          requested,
          applied: "full",
          totalCommits: commits.length,
          scoredCommits: trajectory.length,
          diagnostics: plan.diagnostics,
        },
      }
    }

    if (plan.applied === "merge-only") {
      const indexes = selectMergeOnlyIndexes(commits)
      const trajectory = yield* scoreTrajectoryIndexes(
        indexes,
        commits,
        concurrency,
        scoreCommit,
        toEntry,
      )
      return {
        trajectory,
        sampling: {
          requested,
          applied: "merge-only",
          totalCommits: commits.length,
          scoredCommits: trajectory.length,
          diagnostics: plan.diagnostics,
        },
      }
    }

    const scored = new Map<number, Entry>()
    let pending = new Set(initialAdaptiveIndexes(commits.length))
    let capped = false

    while (pending.size > 0) {
      const batch = yield* scoreTrajectoryIndexes(
        [...pending],
        commits,
        concurrency,
        scoreCommit,
        toEntry,
      )
      for (const entry of batch) {
        const index = commits.findIndex((commit) => commit.sha === entry.sha)
        if (index >= 0) scored.set(index, entry)
      }

      const next = new Set<number>()
      const orderedIndexes = [...scored.keys()].sort((a, b) => a - b)
      for (let i = 1; i < orderedIndexes.length; i += 1) {
        const leftIndex = orderedIndexes[i - 1]!
        const rightIndex = orderedIndexes[i]!
        const leftEntry = scored.get(leftIndex)!
        const rightEntry = scored.get(rightIndex)!
        const midpoint = chooseAdaptiveMidpoint(
          leftIndex,
          rightIndex,
          getScore(leftEntry),
          getScore(rightEntry),
        )
        if (midpoint === undefined || scored.has(midpoint)) continue
        if (scored.size + next.size >= ADAPTIVE_MAX_SCORED_COMMITS) {
          capped = true
          break
        }
        next.add(midpoint)
      }

      pending = next
      if (capped) break
    }

    const trajectory = [...scored.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, entry]) => entry)

    return {
      trajectory,
      sampling: {
        requested,
        applied: "adaptive-delta",
        totalCommits: commits.length,
        scoredCommits: trajectory.length,
        diagnostics: capped
          ? [...plan.diagnostics, `adaptive-delta stopped at ${ADAPTIVE_MAX_SCORED_COMMITS} sampled commits`] 
          : plan.diagnostics,
      },
    }
  })

const scoreTrajectoryIndexes = <Result, Entry extends { readonly sha: string }>(
  indexes: ReadonlyArray<number>,
  commits: ReadonlyArray<RangeCommit>,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
): Effect.Effect<ReadonlyArray<Entry>, unknown, never> => {
  const uniqueIndexes = [...new Set(indexes)].sort((a, b) => a - b)
  return Effect.forEach(
    uniqueIndexes,
    (index) => {
      const commit = commits[index]
      if (commit === undefined) {
        return Effect.die(new Error(`Missing commit metadata for index ${index}`))
      }
      return scoreCommit(commit.sha).pipe(
        Effect.map((result) => toEntry(commit.sha, result)),
      )
    },
    { concurrency },
  )
}

export const resolveSamplingPlan = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
): { readonly applied: Exclude<BisectSamplingMode, "auto">; readonly diagnostics: ReadonlyArray<string> } => {
  if (requested === "full") {
    return { applied: "full", diagnostics: [] }
  }

  if (requested === "auto") {
    if (commits.length <= AUTO_FULL_RANGE_THRESHOLD) {
      return { applied: "full", diagnostics: [] }
    }
    return {
      applied: "adaptive-delta",
      diagnostics: [
        `auto sampling chose adaptive-delta because the range has ${commits.length} commits`,
        "adaptive-delta can miss smaller local drops; rerun with --sample full to confirm an exact culprit",
      ],
    }
  }

  if (requested === "merge-only") {
    const indexes = selectMergeOnlyIndexes(commits)
    if (indexes.length >= Math.max(2, commits.length)) {
      return { applied: "full", diagnostics: ["merge-only matched the full range; using full sampling instead"] }
    }
    if (indexes.length < 2) {
      return {
        applied: "full",
        diagnostics: ["merge-only found too few merge commits; using full sampling instead"],
      }
    }
    return {
      applied: "merge-only",
      diagnostics: [
        "merge-only includes the range endpoints plus merge commits only",
        "non-merge culprit commits can be skipped; rerun with --sample full to confirm an exact culprit",
      ],
    }
  }

  return {
    applied: "adaptive-delta",
    diagnostics: [
      `adaptive-delta started from ${ADAPTIVE_INITIAL_SAMPLES} evenly spaced samples`,
      "adaptive-delta refines only where sampled deltas stay large or commit gaps stay wide",
    ],
  }
}

const allIndexes = (length: number): ReadonlyArray<number> =>
  Array.from({ length }, (_, index) => index)

export const selectMergeOnlyIndexes = (
  commits: ReadonlyArray<RangeCommit>,
): ReadonlyArray<number> => {
  if (commits.length === 0) return []
  const indexes = new Set<number>([0, commits.length - 1])
  for (let index = 0; index < commits.length; index += 1) {
    if ((commits[index]?.parentCount ?? 0) > 1) {
      indexes.add(index)
    }
  }
  return [...indexes].sort((a, b) => a - b)
}

export const initialAdaptiveIndexes = (length: number): ReadonlyArray<number> => {
  if (length <= ADAPTIVE_INITIAL_SAMPLES) return allIndexes(length)
  const indexes = new Set<number>([0, length - 1])
  for (let step = 1; step < ADAPTIVE_INITIAL_SAMPLES - 1; step += 1) {
    const ratio = step / (ADAPTIVE_INITIAL_SAMPLES - 1)
    indexes.add(Math.round((length - 1) * ratio))
  }
  return [...indexes].sort((a, b) => a - b)
}

export const chooseAdaptiveMidpoint = (
  leftIndex: number,
  rightIndex: number,
  leftScore: number,
  rightScore: number,
): number | undefined => {
  const gap = rightIndex - leftIndex
  if (gap <= 1) return undefined
  const delta = Math.abs(leftScore - rightScore)
  if (gap <= ADAPTIVE_MAX_GAP && delta < ADAPTIVE_DELTA_THRESHOLD) {
    return undefined
  }
  return leftIndex + Math.floor(gap / 2)
}

const summarizeScores = (
  scores: ReadonlyArray<number>,
): {
  readonly min: number
  readonly max: number
  readonly final: number
  readonly drift: number
  readonly distinctLevels: number
} => {
  if (scores.length === 0) {
    return { min: 1, max: 1, final: 1, drift: 0, distinctLevels: 0 }
  }

  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const final = scores[scores.length - 1] ?? 1
  const distinctLevels = new Set(scores.map((score) => score.toFixed(6))).size
  return {
    min,
    max,
    final,
    drift: max - final,
    distinctLevels,
  }
}

/**
 * Rank the top-N commits by adjacent-pair score drop. Note: this
 * definition only surfaces commits where a single step introduced the
 * regression. Gradual drift across many commits (no single large step)
 * is captured by `totalDrift` in the report, not by this list.
 */
export const findCulprits = <T extends ScorePoint>(
  trajectory: ReadonlyArray<T>,
  topN: number,
): ReadonlyArray<Culprit> => {
  const drops: Array<Culprit> = []
  for (let i = 1; i < trajectory.length; i += 1) {
    const prev = trajectory[i - 1]!
    const cur = trajectory[i]!
    const drop = prev.score - cur.score
    if (drop <= 0) continue
    drops.push({
      sha: cur.sha,
      prevSha: prev.sha,
      prevScore: prev.score,
      newScore: cur.score,
      drop,
    })
  }
  drops.sort((a, b) => b.drop - a.drop)
  return drops.slice(0, topN)
}

export const findDriftCulprits = <T extends ScorePoint>(
  trajectory: ReadonlyArray<T>,
  topN: number,
): ReadonlyArray<Culprit> => {
  if (trajectory.length <= 1) return []

  let runningMax = trajectory[0]?.score ?? 1
  let activeAnchor: Culprit | undefined
  const activeSegment = new Map<string, Culprit>()

  for (let index = 1; index < trajectory.length; index += 1) {
    const prev = trajectory[index - 1]!
    const cur = trajectory[index]!

    if (cur.score >= runningMax) {
      runningMax = Math.max(runningMax, cur.score)
      activeAnchor = undefined
      activeSegment.clear()
      continue
    }

    const adjacentDrop = prev.score - cur.score
    if (adjacentDrop > 0) {
      const existing = activeSegment.get(cur.sha)
      activeAnchor = {
        sha: cur.sha,
        prevSha: prev.sha,
        prevScore: prev.score,
        newScore: cur.score,
        drop: existing?.drop ?? 0,
      }
      activeSegment.set(cur.sha, activeAnchor)
    }

    if (activeAnchor === undefined) continue

    const deficit = runningMax - cur.score
    const current = activeSegment.get(activeAnchor.sha)
    if (current === undefined) continue
    activeSegment.set(activeAnchor.sha, {
      ...current,
      drop: current.drop + deficit,
    })
  }

  return [...activeSegment.values()].sort((a, b) => b.drop - a.drop).slice(0, topN)
}

const printHumanReport = (report: BisectReport, elapsedMs: number): void => {
  const lines: Array<string> = []
  lines.push("")
  lines.push(`  Repo:    ${report.repoPath}`)
  lines.push(`  Signal:  ${report.signalId}`)
  lines.push(`  Range:   ${report.fromSha}..${report.toSha}`)
  lines.push(`  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`)
  if (report.sampling.scoredCommits !== report.sampling.totalCommits) {
    lines.push(
      `  Sample:  ${report.sampling.applied} (${report.sampling.scoredCommits}/${report.sampling.totalCommits} commits scored)`,
    )
  }
  for (const diagnostic of report.sampling.diagnostics) {
    lines.push(`  Note:    ${diagnostic}`)
  }
  lines.push("")
  lines.push(
    `  Scores:  min ${report.minScore.toFixed(3)}   max ${report.maxScore.toFixed(3)}   final ${report.finalScore.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  )
  lines.push("")
  lines.push("  Trajectory (oldest → newest):")
  for (const t of report.trajectory) {
    const bar = renderScoreBar(t.score)
    lines.push(`    ${t.sha.slice(0, 8)}  ${t.score.toFixed(3)}  ${bar}  (${t.diagnosticsCount} diag)`)
  }
  lines.push("")
  if (report.culprits.length === 0) {
    lines.push("  No score-degrading commits in range.")
  } else {
    lines.push(`  Top ${report.culprits.length} culprit commits (largest score drops):`)
    for (const c of report.culprits) {
      lines.push(
        `    ${c.sha.slice(0, 8)}  drop ${c.drop.toFixed(3)}   ${c.prevScore.toFixed(3)} → ${c.newScore.toFixed(3)}  (from ${c.prevSha.slice(0, 8)})`,
      )
    }
  }
  if (shouldPrintDriftCulprits(report.culprits, report.driftCulprits)) {
    lines.push("")
    lines.push(`  Top ${report.driftCulprits.length} drift culprits (sustained deficit):`)
    for (const culprit of report.driftCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drift ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  lines.push("")
  for (const line of lines) console.log(line)
}

const printObserverHumanReport = (
  report: ObserverBisectReport,
  elapsedMs: number,
  activeSignalCount: number,
): void => {
  const lines: Array<string> = []
  const finalEntry = report.trajectory[report.trajectory.length - 1]

  lines.push("")
  lines.push(`  Repo:    ${report.repoPath}`)
  lines.push("  Mode:    observer")
  if (report.vectorName !== null) {
    lines.push(`  Vector:  ${report.vectorName}`)
  }
  lines.push(`  Range:   ${report.fromSha}..${report.toSha}`)
  lines.push(`  Commits: ${report.trajectory.length}  (${elapsedMs}ms)`)
  if (report.sampling.scoredCommits !== report.sampling.totalCommits) {
    lines.push(
      `  Sample:  ${report.sampling.applied} (${report.sampling.scoredCommits}/${report.sampling.totalCommits} commits scored)`,
    )
  }
  lines.push(`  Active:  ${activeSignalCount} signals`)
  for (const diagnostic of report.sampling.diagnostics) {
    lines.push(`  Note:    ${diagnostic}`)
  }
  lines.push("")
  lines.push(
    `  Weighted mean: min ${report.minWeightedMean.toFixed(3)}   max ${report.maxWeightedMean.toFixed(3)}   final ${report.finalWeightedMean.toFixed(3)}   drift ${report.totalDrift.toFixed(3)}`,
  )
  lines.push(`  Final hard gate: ${report.hardGateStatusAtFinal}`)
  if (report.finalMinimumDimension !== undefined) {
    lines.push(
      `  Final minimum dimension: ${report.finalMinimumDimension.signal} / ${report.finalMinimumDimension.category} @ ${report.finalMinimumDimension.score.toFixed(3)}`,
    )
  }
  lines.push("")
  lines.push("  HEAD category scores:")
  for (const category of CATEGORIES) {
    const score = finalEntry?.categories[category] ?? 1
    const signalCount = finalEntry
      ? Object.keys(finalEntry.observer.categories[category].signals).length
      : 0
    lines.push(
      `    ${padCategory(category)}  ${score.toFixed(3)}  ${renderScoreBar(score)}  (${signalCount} signals)`,
    )
  }
  lines.push("")
  lines.push("  Category trajectory summary:")
  for (const category of CATEGORIES) {
    const summary = report.perCategory[category]
    lines.push(
      `    ${padCategory(category)}  min ${summary.min.toFixed(3)}   max ${summary.max.toFixed(3)}   final ${summary.final.toFixed(3)}   drift ${summary.drift.toFixed(3)}   levels ${summary.distinctLevels}`,
    )
  }
  lines.push("")
  if (report.weightedMeanCulprits.length === 0) {
    lines.push("  No weighted-mean degrading commits in range.")
  } else {
    lines.push(`  Top ${report.weightedMeanCulprits.length} weighted-mean culprit commits:`)
    for (const culprit of report.weightedMeanCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  if (shouldPrintDriftCulprits(report.weightedMeanCulprits, report.weightedMeanDriftCulprits)) {
    lines.push("")
    lines.push(
      `  Top ${report.weightedMeanDriftCulprits.length} weighted-mean drift culprits:`,
    )
    for (const culprit of report.weightedMeanDriftCulprits) {
      lines.push(
        `    ${culprit.sha.slice(0, 8)}  drift ${culprit.drop.toFixed(3)}   ${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)}  (from ${culprit.prevSha.slice(0, 8)})`,
      )
    }
  }
  lines.push("")
  lines.push("  Per-category culprit leaders:")
  for (const category of CATEGORIES) {
    const culprit = report.perCategoryCulprits[category][0]
    if (culprit === undefined) {
      lines.push(`    ${padCategory(category)}  none`)
      continue
    }
    lines.push(
      `    ${padCategory(category)}  ${culprit.sha.slice(0, 8)}  drop ${culprit.drop.toFixed(3)}  (${culprit.prevScore.toFixed(3)} → ${culprit.newScore.toFixed(3)})`,
    )
  }
  lines.push("")
  for (const line of lines) console.log(line)
}

const padCategory = (category: Category): string => category.padEnd(20, " ")

const shouldPrintDriftCulprits = (
  adjacent: ReadonlyArray<Culprit>,
  drift: ReadonlyArray<Culprit>,
): boolean => {
  if (drift.length === 0) return false
  if (adjacent.length !== drift.length) return true
  return adjacent.some((culprit, index) => culprit.sha !== drift[index]?.sha)
}

const renderScoreBar = (score: number): string => {
  const width = 20
  const filled = Math.max(0, Math.min(width, Math.round(score * width)))
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`
}
