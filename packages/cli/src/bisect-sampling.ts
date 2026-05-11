import { Effect } from "effect"

import {
  ADAPTIVE_MAX_SCORED_COMMITS,
  allIndexes,
  initialAdaptiveIndexes,
  selectMergeOnlyIndexes,
  type RangeCommit,
} from "./bisect-sampling-indexes.js"
import {
  resolveSamplingPlan,
  type BisectSamplingMode,
  type BisectSamplingSummary,
} from "./bisect-sampling-plan.js"

export type { RangeCommit } from "./bisect-sampling-indexes.js"
export {
  chooseAdaptiveMidpoint,
  chooseObserverAdaptiveMidpoint,
  initialAdaptiveIndexes,
  selectMergeOnlyIndexes,
} from "./bisect-sampling-indexes.js"
export type { BisectSamplingMode, BisectSamplingSummary } from "./bisect-sampling-plan.js"
export { resolveSamplingPlan } from "./bisect-sampling-plan.js"

export const sampleTrajectory = <Result, Entry extends { readonly sha: string }>(
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  hasFirstCrossing: boolean,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
  chooseMidpoint: (
    leftIndex: number,
    rightIndex: number,
    leftEntry: Entry,
    rightEntry: Entry,
  ) => number | undefined,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<Entry>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  Effect.gen(function* () {
    const plan = resolveSamplingPlan(commits, requested, { hasFirstCrossing })
    return plan.applied === "adaptive-delta"
      ? yield* sampleAdaptiveTrajectory(
          commits,
          requested,
          plan.diagnostics,
          concurrency,
          scoreCommit,
          toEntry,
          chooseMidpoint,
        )
      : yield* samplePlannedTrajectory(
          commits,
          requested,
          plan.applied,
          plan.diagnostics,
          concurrency,
          scoreCommit,
          toEntry,
        )
  })

const samplePlannedTrajectory = <Result, Entry extends { readonly sha: string }>(
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  applied: "full" | "merge-only",
  diagnostics: ReadonlyArray<string>,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<Entry>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  Effect.gen(function* () {
    const indexes = applied === "full" ? allIndexes(commits.length) : selectMergeOnlyIndexes(commits)
    const trajectory = yield* scoreTrajectoryIndexes(
      indexes,
      commits,
      concurrency,
      scoreCommit,
      toEntry,
    )
    return {
      trajectory,
      sampling: samplingSummary(requested, applied, commits.length, trajectory.length, diagnostics),
    }
  })

const sampleAdaptiveTrajectory = <Result, Entry extends { readonly sha: string }>(
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  diagnostics: ReadonlyArray<string>,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
  chooseMidpoint: (
    leftIndex: number,
    rightIndex: number,
    leftEntry: Entry,
    rightEntry: Entry,
  ) => number | undefined,
): Effect.Effect<
  { readonly trajectory: ReadonlyArray<Entry>; readonly sampling: BisectSamplingSummary },
  unknown,
  never
> =>
  Effect.gen(function* () {
    const sampled = yield* adaptiveTrajectoryEntries(
      commits,
      concurrency,
      scoreCommit,
      toEntry,
      chooseMidpoint,
    )
    return {
      trajectory: sampled.trajectory,
      sampling: samplingSummary(
        requested,
        "adaptive-delta",
        commits.length,
        sampled.trajectory.length,
        sampled.capped
          ? [...diagnostics, `adaptive-delta stopped at ${ADAPTIVE_MAX_SCORED_COMMITS} sampled commits`]
          : diagnostics,
      ),
    }
  })

const adaptiveTrajectoryEntries = <Result, Entry extends { readonly sha: string }>(
  commits: ReadonlyArray<RangeCommit>,
  concurrency: number,
  scoreCommit: (sha: string) => Effect.Effect<Result, unknown, never>,
  toEntry: (sha: string, result: Result) => Entry,
  chooseMidpoint: (
    leftIndex: number,
    rightIndex: number,
    leftEntry: Entry,
    rightEntry: Entry,
  ) => number | undefined,
): Effect.Effect<{ readonly trajectory: ReadonlyArray<Entry>; readonly capped: boolean }, unknown, never> =>
  Effect.gen(function* () {
    const scored = new Map<number, Entry>()
    let pending = new Set(initialAdaptiveIndexes(commits.length))
    let capped = false
    while (pending.size > 0) {
      const batch = yield* scoreTrajectoryIndexes([...pending], commits, concurrency, scoreCommit, toEntry)
      recordAdaptiveBatch(batch, commits, scored)
      const next = nextAdaptiveIndexes(scored, chooseMidpoint)
      capped = scored.size + next.size >= ADAPTIVE_MAX_SCORED_COMMITS
      pending = capped ? new Set([...next].slice(0, ADAPTIVE_MAX_SCORED_COMMITS - scored.size)) : next
      if (capped) break
    }
    return { trajectory: orderedScoredEntries(scored), capped }
  })

const recordAdaptiveBatch = <Entry extends { readonly sha: string }>(
  batch: ReadonlyArray<Entry>,
  commits: ReadonlyArray<RangeCommit>,
  scored: Map<number, Entry>,
): void => {
  for (const entry of batch) {
    const index = commits.findIndex((commit) => commit.sha === entry.sha)
    if (index >= 0) scored.set(index, entry)
  }
}

const nextAdaptiveIndexes = <Entry>(
  scored: ReadonlyMap<number, Entry>,
  chooseMidpoint: (
    leftIndex: number,
    rightIndex: number,
    leftEntry: Entry,
    rightEntry: Entry,
  ) => number | undefined,
): Set<number> => {
  const next = new Set<number>()
  const orderedIndexes = [...scored.keys()].sort((a, b) => a - b)
  for (let i = 1; i < orderedIndexes.length; i += 1) {
    const leftIndex = orderedIndexes[i - 1]!
    const rightIndex = orderedIndexes[i]!
    const midpoint = chooseMidpoint(
      leftIndex,
      rightIndex,
      scored.get(leftIndex)!,
      scored.get(rightIndex)!,
    )
    if (midpoint !== undefined && !scored.has(midpoint)) next.add(midpoint)
  }
  return next
}

const orderedScoredEntries = <Entry>(
  scored: ReadonlyMap<number, Entry>,
): ReadonlyArray<Entry> =>
  [...scored.entries()].sort((a, b) => a[0] - b[0]).map(([, entry]) => entry)

const samplingSummary = (
  requested: BisectSamplingMode,
  applied: Exclude<BisectSamplingMode, "auto">,
  totalCommits: number,
  scoredCommits: number,
  diagnostics: ReadonlyArray<string>,
): BisectSamplingSummary => ({
  requested,
  applied,
  totalCommits,
  scoredCommits,
  diagnostics,
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
