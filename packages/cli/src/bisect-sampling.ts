import { Effect } from "effect"

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

export interface RangeCommit {
  readonly sha: string
  readonly parentCount: number
}

const AUTO_FULL_RANGE_THRESHOLD = 500
const ADAPTIVE_INITIAL_SAMPLES = 17
const ADAPTIVE_MAX_GAP = 64
const ADAPTIVE_DELTA_THRESHOLD = 0.08
const ADAPTIVE_MAX_SCORED_COMMITS = 1025

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

export const resolveSamplingPlan = (
  commits: ReadonlyArray<RangeCommit>,
  requested: BisectSamplingMode,
  opts: { readonly hasFirstCrossing?: boolean } = {},
): { readonly applied: Exclude<BisectSamplingMode, "auto">; readonly diagnostics: ReadonlyArray<string> } => {
  if (requested === "full") {
    return { applied: "full", diagnostics: [] }
  }
  if (requested === "auto") {
    return resolveAutoSamplingPlan(commits, opts)
  }
  if (requested === "merge-only") {
    return resolveMergeOnlySamplingPlan(commits, opts)
  }
  return resolveAdaptiveSamplingPlan(opts)
}

const resolveAutoSamplingPlan = (
  commits: ReadonlyArray<RangeCommit>,
  opts: { readonly hasFirstCrossing?: boolean },
): { readonly applied: Exclude<BisectSamplingMode, "auto">; readonly diagnostics: ReadonlyArray<string> } => {
  if (opts.hasFirstCrossing === true) {
    return {
      applied: "full",
      diagnostics: [
        "auto sampling chose full because first-crossing queries require exact commit order",
      ],
    }
  }
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

const resolveMergeOnlySamplingPlan = (
  commits: ReadonlyArray<RangeCommit>,
  opts: { readonly hasFirstCrossing?: boolean },
): { readonly applied: Exclude<BisectSamplingMode, "auto">; readonly diagnostics: ReadonlyArray<string> } => {
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
      ...(opts.hasFirstCrossing === true
        ? ["first-crossing under merge-only sampling is approximate; rerun with --sample full for exact crossing"]
        : []),
    ],
  }
}

const resolveAdaptiveSamplingPlan = (
  opts: { readonly hasFirstCrossing?: boolean },
): { readonly applied: Exclude<BisectSamplingMode, "auto">; readonly diagnostics: ReadonlyArray<string> } => ({
  applied: "adaptive-delta",
  diagnostics: [
    `adaptive-delta started from ${ADAPTIVE_INITIAL_SAMPLES} evenly spaced samples`,
    "adaptive-delta refines only where sampled deltas stay large or commit gaps stay wide",
    ...(opts.hasFirstCrossing === true
      ? ["first-crossing under adaptive-delta sampling is approximate; rerun with --sample full for exact crossing"]
      : []),
  ],
})

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

export const chooseObserverAdaptiveMidpoint = (
  leftIndex: number,
  rightIndex: number,
  leftEntry: { readonly weightedMean: number; readonly readinessScore: number | undefined },
  rightEntry: { readonly weightedMean: number; readonly readinessScore: number | undefined },
): number | undefined => {
  const gap = rightIndex - leftIndex
  if (gap <= 1) return undefined
  if (gap > ADAPTIVE_MAX_GAP) return leftIndex + Math.floor(gap / 2)

  const weightedMeanDelta = Math.abs(leftEntry.weightedMean - rightEntry.weightedMean)
  const readinessDelta =
    leftEntry.readinessScore === undefined || rightEntry.readinessScore === undefined
      ? undefined
      : Math.abs(leftEntry.readinessScore - rightEntry.readinessScore)
  if (
    weightedMeanDelta < ADAPTIVE_DELTA_THRESHOLD &&
    (readinessDelta === undefined || readinessDelta < ADAPTIVE_DELTA_THRESHOLD)
  ) {
    return undefined
  }
  return leftIndex + Math.floor(gap / 2)
}
