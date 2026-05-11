export interface RangeCommit {
  readonly sha: string
  readonly parentCount: number
}

export const ADAPTIVE_INITIAL_SAMPLES = 17
const ADAPTIVE_MAX_GAP = 64
const ADAPTIVE_DELTA_THRESHOLD = 0.08
export const ADAPTIVE_MAX_SCORED_COMMITS = 1025

export const allIndexes = (length: number): ReadonlyArray<number> =>
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
