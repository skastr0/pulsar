import type { ReExportAnalysis } from "./ts-ad-03-reexport-analysis.js"

export interface ReExportChain {
  readonly start: string
  readonly end: string
  readonly depth: number
  readonly hops: ReadonlyArray<string>
  readonly cycle: boolean
}

export const collectReExportChains = (
  reExportTargets: ReadonlyMap<string, ReadonlyArray<string>>,
  analysisByFile: Map<string, ReExportAnalysis>,
): ReadonlyArray<ReExportChain> => {
  const allChains: Array<ReExportChain> = []

  for (const [file, targets] of reExportTargets) {
    const chains = targets.flatMap((target) =>
      walkReExportChains(file, target, reExportTargets, analysisByFile, [file]),
    )
    allChains.push(...chains)
    updateMaxChainDepth(analysisByFile, file, chains)
  }

  return allChains
}

export const effectiveChainDepth = (chain: ReExportChain): number => {
  if (chain.cycle) return chain.depth

  const relayHops = chain.hops.slice(1, -1)
  const indexRelayCount = relayHops.filter(isDirectoryIndexFile).length
  return Math.max(1, chain.depth - Math.min(2, indexRelayCount))
}

export const compareChains = (left: ReExportChain, right: ReExportChain): number => {
  if (Number(right.cycle) !== Number(left.cycle)) {
    return Number(right.cycle) - Number(left.cycle)
  }
  if (right.depth !== left.depth) {
    return right.depth - left.depth
  }
  return left.start.localeCompare(right.start)
}

export const uniqueChains = (chains: ReadonlyArray<ReExportChain>): ReadonlyArray<ReExportChain> => {
  const byKey = new Map<string, ReExportChain>()
  for (const chain of chains) {
    byKey.set(`${chain.cycle ? "cycle" : "chain"}|${chain.hops.join("\0")}`, chain)
  }
  return [...byKey.values()]
}

const updateMaxChainDepth = (
  analysisByFile: Map<string, ReExportAnalysis>,
  file: string,
  chains: ReadonlyArray<ReExportChain>,
): void => {
  const current = analysisByFile.get(file)
  if (current === undefined) return
  analysisByFile.set(file, {
    ...current,
    maxChainDepth: chains.reduce((max, chain) => Math.max(max, chain.depth), 0),
  })
}

const walkReExportChains = (
  start: string,
  current: string,
  reExportTargets: ReadonlyMap<string, ReadonlyArray<string>>,
  analysisByFile: ReadonlyMap<string, ReExportAnalysis>,
  path: ReadonlyArray<string>,
): ReadonlyArray<ReExportChain> => {
  const nextPath = [...path, current]
  if (path.includes(current)) {
    return [
      {
        start,
        end: current,
        depth: nextPath.length - 1,
        hops: nextPath,
        cycle: true,
      },
    ]
  }

  const analysis = analysisByFile.get(current)
  const targets = reExportTargets.get(current) ?? []
  if (analysis?.isBarrel !== true || targets.length === 0) {
    return [
      {
        start,
        end: current,
        depth: nextPath.length - 1,
        hops: nextPath,
        cycle: false,
      },
    ]
  }

  return targets.flatMap((target) =>
    walkReExportChains(start, target, reExportTargets, analysisByFile, nextPath),
  )
}

const isDirectoryIndexFile = (filePath: string): boolean =>
  /(?:^|[\\/])index\.tsx?$/.test(filePath)
