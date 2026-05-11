import type {
  BisectReport,
  CommitScore,
  Culprit,
  FirstCrossingQuery,
  FirstCrossingResult,
  ScorePoint,
  SignalBisectOptions,
} from "./bisect-types.js"
import type { BisectSamplingSummary } from "./bisect-sampling.js"

export const buildSignalBisectReport = (
  opts: SignalBisectOptions,
  repoPath: string,
  sampled: {
    readonly trajectory: ReadonlyArray<CommitScore>
    readonly sampling: BisectSamplingSummary
  },
): BisectReport => {
  const scores = summarizeScores(sampled.trajectory.map((t) => t.score))
  return {
    schemaVersion: "signal-bisect/v2",
    signalId: opts.signalId,
    repoPath,
    fromSha: opts.fromSha,
    toSha: opts.toSha,
    trajectory: sampled.trajectory,
    culprits: findCulprits(sampled.trajectory, opts.topCulprits),
    driftCulprits: findDriftCulprits(sampled.trajectory, opts.topCulprits),
    sampling: sampled.sampling,
    minScore: scores.min,
    maxScore: scores.max,
    finalScore: scores.final,
    totalDrift: scores.drift,
    firstCrossing:
      opts.firstCrossing === undefined
        ? undefined
        : findFirstCrossing(sampled.trajectory, opts.firstCrossing),
  }
}

export const summarizeScores = (
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

export const findFirstCrossing = <T extends ScorePoint>(
  trajectory: ReadonlyArray<T>,
  query: FirstCrossingQuery,
): FirstCrossingResult | undefined => {
  for (let index = 0; index < trajectory.length; index += 1) {
    const point = trajectory[index]!
    if (!matchesCrossing(point.score, query.op, query.threshold)) continue
    const previous = trajectory[index - 1]
    return {
      ...query,
      sha: point.sha,
      previousSha: previous?.sha,
      previousScore: previous?.score,
      score: point.score,
    }
  }
  return undefined
}

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

const matchesCrossing = (
  score: number,
  op: FirstCrossingQuery["op"],
  threshold: number,
): boolean => {
  switch (op) {
    case "<":
      return score < threshold
    case "<=":
      return score <= threshold
    case ">":
      return score > threshold
    case ">=":
      return score >= threshold
  }
}
