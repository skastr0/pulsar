import type { SharedHistoryTouchedCommit } from "./shared-history-commits.js"

export interface CoChangePair {
  readonly leftFile: string
  readonly rightFile: string
  readonly coChangeCount: number
  readonly leftTouchCount: number
  readonly rightTouchCount: number
  readonly support: number
  readonly confidence: number
  readonly lastCoChangedAt: string
}

interface CoChangePairCount {
  readonly leftFile: string
  readonly rightFile: string
  coChangeCount: number
  lastCoChangedAt: string
}

interface CoChangeCounts {
  readonly touchCounts: ReadonlyMap<string, number>
  readonly pairCounts: ReadonlyMap<string, CoChangePairCount>
}

export const buildCochangePairs = (
  commits: ReadonlyArray<SharedHistoryTouchedCommit>,
  minCoChangeCount: number,
): ReadonlyArray<CoChangePair> =>
  cochangePairsFromCounts(countCochangeCommits(commits), commits.length, minCoChangeCount)

const countCochangeCommits = (
  commits: ReadonlyArray<SharedHistoryTouchedCommit>,
): CoChangeCounts => {
  const touchCounts = new Map<string, number>()
  const pairCounts = new Map<string, CoChangePairCount>()
  for (const commit of commits) {
    countTouchedFiles(touchCounts, commit.files)
    countCochangePairs(pairCounts, commit.files, commit.committedAt.toISOString())
  }
  return { touchCounts, pairCounts }
}

const countTouchedFiles = (
  touchCounts: Map<string, number>,
  files: ReadonlyArray<string>,
): void => {
  for (const file of files) {
    touchCounts.set(file, (touchCounts.get(file) ?? 0) + 1)
  }
}

const countCochangePairs = (
  pairCounts: Map<string, CoChangePairCount>,
  files: ReadonlyArray<string>,
  committedAt: string,
): void => {
  if (files.length < 2) return
  for (let leftIndex = 0; leftIndex < files.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < files.length; rightIndex += 1) {
      incrementPairCount(pairCounts, files[leftIndex]!, files[rightIndex]!, committedAt)
    }
  }
}

const incrementPairCount = (
  pairCounts: Map<string, CoChangePairCount>,
  leftFile: string,
  rightFile: string,
  committedAt: string,
): void => {
  const key = pairKey(leftFile, rightFile)
  const existing = pairCounts.get(key)
  if (existing === undefined) {
    pairCounts.set(key, { leftFile, rightFile, coChangeCount: 1, lastCoChangedAt: committedAt })
    return
  }
  existing.coChangeCount += 1
  if (committedAt > existing.lastCoChangedAt) existing.lastCoChangedAt = committedAt
}

const cochangePairsFromCounts = (
  counts: CoChangeCounts,
  totalCommits: number,
  minCoChangeCount: number,
): ReadonlyArray<CoChangePair> =>
  [...counts.pairCounts.values()]
    .filter((pair) => pair.coChangeCount >= minCoChangeCount)
    .map((pair) => toCoChangePair(pair, counts.touchCounts, totalCommits))
    .sort(comparePairs)

const toCoChangePair = (
  pair: CoChangePairCount,
  touchCounts: ReadonlyMap<string, number>,
  totalCommits: number,
): CoChangePair => {
  const leftTouchCount = touchCounts.get(pair.leftFile) ?? 0
  const rightTouchCount = touchCounts.get(pair.rightFile) ?? 0
  const maxTouchCount = Math.max(leftTouchCount, rightTouchCount)
  return {
    leftFile: pair.leftFile,
    rightFile: pair.rightFile,
    coChangeCount: pair.coChangeCount,
    leftTouchCount,
    rightTouchCount,
    support: totalCommits === 0 ? 0 : pair.coChangeCount / totalCommits,
    confidence: maxTouchCount === 0 ? 0 : pair.coChangeCount / maxTouchCount,
    lastCoChangedAt: pair.lastCoChangedAt,
  }
}

const comparePairs = (left: CoChangePair, right: CoChangePair): number =>
  right.coChangeCount - left.coChangeCount ||
  right.confidence - left.confidence ||
  right.support - left.support ||
  left.leftFile.localeCompare(right.leftFile) ||
  left.rightFile.localeCompare(right.rightFile)

export const cochangePairKey = (leftFile: string, rightFile: string): string =>
  pairKey(leftFile, rightFile)

const pairKey = (leftFile: string, rightFile: string): string =>
  leftFile < rightFile ? `${leftFile}\0${rightFile}` : `${rightFile}\0${leftFile}`
