import type { ObserverCommitEntry } from "./bisect-observer-types.js"
import type { ScorePoint } from "./bisect-signal-types.js"

export const signalScorePoints = (
  trajectory: ReadonlyArray<ObserverCommitEntry>,
  signalId: string,
): ReadonlyArray<ScorePoint> =>
  trajectory.flatMap((entry) => {
    const score = entry.signals[signalId]
    return score === undefined ? [] : [{ sha: entry.sha, score }]
  })
