import {
  ADAPTIVE_INITIAL_SAMPLES,
  selectMergeOnlyIndexes,
  type RangeCommit,
} from "./bisect-sampling-indexes.js"

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

export const AUTO_FULL_RANGE_THRESHOLD = 500

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
