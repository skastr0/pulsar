import {
  dirname,
  relative,
  sep,
  normalize as normalizePath,
} from "node:path"
import { computeDiagnosticHash, parseBypasses } from "@skastr0/pulsar-core/signal"
import type { PulsarAllowBypass } from "@skastr0/pulsar-core/signal"
import type { SourceFile } from "ts-morph"
import { createModuleResolver } from "../graph/module-graph.js"
import { isExcluded } from "./shared-globs.js"
import {
  isTypeOnlyModuleDeclaration,
  localIdentifierUsageByName,
  valueImportBindingNames,
} from "./shared-module-usage.js"
import { stronglyConnectedComponents } from "./ts-ad-02-scc.js"

export interface Cycle {
  readonly modules: ReadonlyArray<string>
  /**
   * A concrete cycle path rendered in dependency order, for example
   * `shared→domain→infra→shared`.
   */
  readonly architecturalSpan: string
  /**
   * The edge whose removal would break the cycle with the lowest
   * fan-out impact. `undefined` when a unique minimal break edge
   * cannot be identified (e.g. self-loop or single-edge pick).
   */
  readonly minBreakEdge: { readonly from: string; readonly to: string } | undefined
  readonly identityHash: string
  readonly suppressingBypasses: ReadonlyArray<PulsarAllowBypass>
}

export interface ExpiredBypassMatch {
  readonly file: string
  readonly bypass: PulsarAllowBypass
}

interface CycleAnalysis {
  readonly cycles: ReadonlyArray<Cycle>
  readonly cycleCount: number
  readonly largestCycleSize: number
  readonly expiredBypasses: ReadonlyArray<ExpiredBypassMatch>
}

export const analyzeCircularDependencies = (
  sourceFiles: ReadonlyArray<SourceFile>,
  excludeGlobs: ReadonlyArray<string>,
): CycleAnalysis => {
  const includedSourceFiles = sourceFiles.filter(
    (sf) => !isExcluded(sf.getFilePath(), excludeGlobs),
  )
  const fileSet = new Set(includedSourceFiles.map((sf) => sf.getFilePath()))
  const sourceTextByPath = new Map(
    includedSourceFiles.map((sf) => [sf.getFilePath(), sf.getFullText()] as const),
  )
  const bypassesByFile = new Map(
    includedSourceFiles.map((sf) => [sf.getFilePath(), parseBypasses(sf.getFullText())] as const),
  )

  const graph = buildImportGraph(includedSourceFiles, fileSet)
  const sccs = stronglyConnectedComponents(graph)

  const rawCycles: Array<Cycle> = []
  for (const scc of sccs) {
    if (scc.length >= 2) {
      rawCycles.push(toCycle(scc, graph, sourceTextByPath, bypassesByFile))
    } else if (scc.length === 1) {
      const node = scc[0]!
      if (graph.get(node)?.has(node) === true) {
        rawCycles.push({
          modules: [node],
          architecturalSpan: `${node}→${node}`,
          minBreakEdge: { from: node, to: node },
          identityHash: hashCycleModules([node], sourceTextByPath),
          suppressingBypasses: collectBypassesForModules([node], bypassesByFile),
        })
      }
    }
  }

  const cycles = rawCycles
    .slice()
    .sort((a, b) => b.modules.length - a.modules.length)
  const largestCycleSize = cycles.reduce(
    (acc, cycle) => Math.max(acc, cycle.modules.length),
    0,
  )
  const expiredBypasses = [...bypassesByFile.entries()].flatMap(([file, bypasses]) =>
    bypasses
      .filter((bypass) => bypass.status === "expired")
      .map((bypass) => ({ file, bypass })),
  )

  return {
    cycles,
    cycleCount: cycles.length,
    largestCycleSize,
    expiredBypasses,
  }
}

const buildImportGraph = (
  sourceFiles: ReadonlyArray<SourceFile>,
  fileSet: ReadonlySet<string>,
): Map<string, Set<string>> => {
  const graph = new Map<string, Set<string>>()
  const resolver = createModuleResolver(sourceFiles, [])
  for (const sf of sourceFiles) {
    const path = sf.getFilePath()
    const targets = new Set<string>()
    const importDeclarations = sf.getImportDeclarations()
    const valueBindingNames = valueImportBindingNames(importDeclarations)
    let identifierUsage: ReadonlyMap<string, "type-only" | "value"> | undefined
    const getIdentifierUsage = (): ReadonlyMap<string, "type-only" | "value"> => {
      identifierUsage ??= localIdentifierUsageByName(sf, valueBindingNames)
      return identifierUsage
    }

    for (const decl of importDeclarations) {
      if (isTypeOnlyModuleDeclaration(decl, getIdentifierUsage)) continue
      const targetPath = resolver.resolve(path, decl)
      if (targetPath === undefined) continue
      if (!fileSet.has(targetPath)) continue
      targets.add(targetPath)
    }
    for (const decl of sf.getExportDeclarations()) {
      if (isTypeOnlyModuleDeclaration(decl, getIdentifierUsage)) continue
      const targetPath = resolver.resolve(path, decl)
      if (targetPath === undefined) continue
      if (!fileSet.has(targetPath)) continue
      if (targetPath === path) continue
      targets.add(targetPath)
    }
    graph.set(path, targets)
  }
  return graph
}

const toCycle = (
  scc: ReadonlyArray<string>,
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  sourceTextByPath: ReadonlyMap<string, string>,
  bypassesByFile: ReadonlyMap<string, ReadonlyArray<PulsarAllowBypass>>,
): Cycle => {
  const memberSet = new Set(scc)
  let best: { from: string; to: string; fanOut: number } | undefined
  for (const from of scc) {
    const neighbors = graph.get(from) ?? new Set<string>()
    const internalNeighbors = [...neighbors].filter((n) => memberSet.has(n))
    for (const to of internalNeighbors) {
      const candidate = {
        from,
        to,
        fanOut: internalNeighbors.length,
      }
      if (best === undefined) {
        best = candidate
        continue
      }
      if (candidate.fanOut < best.fanOut) {
        best = candidate
      } else if (
        candidate.fanOut === best.fanOut &&
        (candidate.from < best.from ||
          (candidate.from === best.from && candidate.to < best.to))
      ) {
        best = candidate
      }
    }
  }

  const modules = scc.slice().sort()
  return {
    modules,
    architecturalSpan: buildArchitecturalSpan(modules, graph),
    minBreakEdge:
      best === undefined ? undefined : { from: best.from, to: best.to },
    identityHash: hashCycleModules(modules, sourceTextByPath),
    suppressingBypasses: collectBypassesForModules(modules, bypassesByFile),
  }
}

const collectBypassesForModules = (
  modules: ReadonlyArray<string>,
  bypassesByFile: ReadonlyMap<string, ReadonlyArray<PulsarAllowBypass>>,
): ReadonlyArray<PulsarAllowBypass> =>
  modules.flatMap((module) => bypassesByFile.get(module) ?? [])

const hashCycleModules = (
  modules: ReadonlyArray<string>,
  sourceTextByPath: ReadonlyMap<string, string>,
): string =>
  computeDiagnosticHash(
    modules
      .slice()
      .sort()
      .map((module) => sourceTextByPath.get(module) ?? module)
      .join("\n\n"),
  )

const buildArchitecturalSpan = (
  modules: ReadonlyArray<string>,
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): string => {
  if (modules.length === 0) return ""
  if (modules.length === 1) {
    const node = modules[0]!
    return `${node}→${node}`
  }

  const memberSet = new Set(modules)
  const findCycleFrom = (
    start: string,
    current: string,
    path: ReadonlyArray<string>,
    visited: Set<string>,
  ): ReadonlyArray<string> | undefined => {
    const neighbors = [...(graph.get(current) ?? new Set<string>())]
      .filter((neighbor) => memberSet.has(neighbor))
      .sort()

    for (const neighbor of neighbors) {
      if (neighbor === start && path.length > 1) {
        return [...path, start]
      }
      if (visited.has(neighbor)) continue
      visited.add(neighbor)
      const found = findCycleFrom(start, neighbor, [...path, neighbor], visited)
      visited.delete(neighbor)
      if (found !== undefined) return found
    }

    return undefined
  }

  for (const start of modules) {
    const found = findCycleFrom(start, start, [start], new Set([start]))
    if (found !== undefined) return found.join("→")
  }

  return [...modules, modules[0]!].join("→")
}

export const formatCycleSpan = (cycle: Cycle): string => {
  const commonDir = commonDirectory(cycle.modules)
  const prefix = compactDirectoryLabel(commonDir)
  const compactSpan = cycle.architecturalSpan
    .split("→")
    .map((module) => compactModulePath(module, commonDir))
    .join(" -> ")

  return prefix.length > 0 ? `${prefix}: ${compactSpan}` : compactSpan
}

export const formatBreakEdge = (cycle: Cycle): string | undefined => {
  if (cycle.minBreakEdge === undefined) return undefined
  const commonDir = commonDirectory([cycle.minBreakEdge.from, cycle.minBreakEdge.to])
  return `${compactModulePath(cycle.minBreakEdge.from, commonDir)} -> ${compactModulePath(cycle.minBreakEdge.to, commonDir)}`
}

const commonDirectory = (paths: ReadonlyArray<string>): string => {
  if (paths.length === 0) return ""
  const directories = paths.map((path) => normalizePath(dirname(path)).split(sep))
  const [first, ...rest] = directories
  if (first === undefined) return ""

  const common: Array<string> = []
  for (let index = 0; index < first.length; index += 1) {
    const part = first[index]
    if (part === undefined) break
    if (rest.every((directory) => directory[index] === part)) {
      common.push(part)
      continue
    }
    break
  }

  return common.join(sep)
}

const compactDirectoryLabel = (directory: string): string => {
  if (directory.length === 0) return ""
  return normalizePath(directory)
    .split(sep)
    .filter((part) => part.length > 0)
    .slice(-3)
    .join("/")
}

const compactModulePath = (module: string, commonDir: string): string => {
  if (commonDir.length === 0) return compactDirectoryLabel(module)

  const rel = relative(commonDir, module)
  if (!rel.startsWith("..")) return normalizePath(rel).replace(/\\/g, "/")
  return compactDirectoryLabel(module)
}
