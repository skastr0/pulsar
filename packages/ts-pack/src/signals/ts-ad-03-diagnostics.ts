import { relative } from "node:path"
import type { ReExportChain } from "./ts-ad-03-chains.js"

export const formatHopChain = (hops: ReadonlyArray<string>, worktreePath: string | undefined): string =>
  hops.map((hop) => formatDiagnosticPath(hop, worktreePath)).join(" -> ")

export const formatDiagnosticPath = (filePath: string, worktreePath: string | undefined): string => {
  if (worktreePath === undefined) return filePath
  const rel = relative(worktreePath, filePath)
  return rel.length > 0 && !rel.startsWith("..") ? rel : filePath
}

export const selectDiagnosticChains = (
  chains: ReadonlyArray<ReExportChain>,
  limit: number,
): ReadonlyArray<ReExportChain> => {
  const selected: Array<ReExportChain> = []
  const seenStarts = new Set<string>()

  for (const chain of chains) {
    if (!seenStarts.has(chain.start)) {
      selected.push(chain)
      seenStarts.add(chain.start)
    }
    if (selected.length >= limit) return selected
  }

  return selected
}
