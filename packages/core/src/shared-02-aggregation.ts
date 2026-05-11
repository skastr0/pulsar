import {
  type DistributionalSummary,
  summarize,
} from "./distribution.js"
import { normalizeAuthor } from "./shared-history.js"
import type { TouchedFileHistory } from "./shared-02-history.js"

export interface BusFactorInfo {
  readonly busFactor: number
  readonly primaryAuthor: string
  readonly primaryShare: number
  readonly authors: ReadonlyArray<string>
  readonly loc: number
}

export interface Shared02BusFactorOutput {
  readonly byFile: ReadonlyMap<string, BusFactorInfo>
  readonly siloed: ReadonlyArray<{ file: string; author: string; loc: number }>
  readonly distribution: DistributionalSummary
  readonly windowDays: number
  readonly maxCommits: number
  readonly touchedFileCount: number
  readonly touchedLoc: number
  readonly repoAuthors: ReadonlyArray<string>
}

interface BusFactorAccumulator {
  readonly byFile: Map<string, BusFactorInfo>
  readonly siloed: Array<{ file: string; author: string; loc: number }>
  readonly repoAuthors: Set<string>
  touchedLoc: number
}

interface BusFactorOutputConfig {
  readonly min_loc: number
  readonly window_days: number
  readonly max_commits: number
}

export const buildBusFactorOutput = (
  touchedFiles: ReadonlyArray<TouchedFileHistory>,
  aliasMap: ReadonlyMap<string, string>,
  config: BusFactorOutputConfig,
): Shared02BusFactorOutput => {
  const accumulator: BusFactorAccumulator = {
    byFile: new Map(),
    siloed: [],
    repoAuthors: new Set(),
    touchedLoc: 0,
  }
  for (const file of touchedFiles) {
    addTouchedFileBusFactor(file, aliasMap, config.min_loc, accumulator)
  }
  return finalizeBusFactorOutput(accumulator, config)
}

const addTouchedFileBusFactor = (
  file: TouchedFileHistory,
  aliasMap: ReadonlyMap<string, string>,
  minLoc: number,
  accumulator: BusFactorAccumulator,
): void => {
  if (file.loc < minLoc) return
  accumulator.touchedLoc += file.loc
  if (file.authors.length === 0) return

  const sortedAuthors = countCanonicalAuthors(file.authors, aliasMap)
  const primary = sortedAuthors[0]
  if (primary === undefined) return

  const commitCount = sortedAuthors.reduce((sum, entry) => sum + entry[1], 0)
  const authorNames = sortedAuthors.map(([author]) => author)
  for (const author of authorNames) accumulator.repoAuthors.add(author)

  const info: BusFactorInfo = {
    busFactor: authorNames.length,
    primaryAuthor: primary[0],
    primaryShare: commitCount === 0 ? 0 : primary[1] / commitCount,
    authors: authorNames,
    loc: file.loc,
  }
  accumulator.byFile.set(file.absolutePath, info)
  if (info.busFactor === 1) {
    accumulator.siloed.push({ file: file.absolutePath, author: info.primaryAuthor, loc: file.loc })
  }
}

const countCanonicalAuthors = (
  authors: ReadonlyArray<string>,
  aliasMap: ReadonlyMap<string, string>,
): ReadonlyArray<readonly [string, number]> => {
  const counts = new Map<string, number>()
  for (const author of authors) {
    const canonical = normalizeAuthor(author, aliasMap)
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1]
    return a[0].localeCompare(b[0])
  })
}

const finalizeBusFactorOutput = (
  accumulator: BusFactorAccumulator,
  config: BusFactorOutputConfig,
): Shared02BusFactorOutput => ({
  byFile: accumulator.byFile,
  siloed: accumulator.siloed.sort((a, b) => b.loc - a.loc || a.file.localeCompare(b.file)),
  distribution: summarize([...accumulator.byFile.values()].map((info) => info.busFactor)),
  windowDays: config.window_days,
  maxCommits: config.max_commits,
  touchedFileCount: accumulator.byFile.size,
  touchedLoc: accumulator.touchedLoc,
  repoAuthors: [...accumulator.repoAuthors].sort((a, b) => a.localeCompare(b)),
})
