import {
  dirname,
  relative,
  sep,
  normalize as normalizePath,
} from "node:path"
import {
  computeDiagnosticHash,
  hasSuppressingBypass,
  parseBypasses,
  toExpiredBypassDiagnostic,
  type Diagnostic,
  type Signal,
  SignalComputeError,
  type PulsarAllowBypass,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import type { SourceFile } from "ts-morph"
import { createModuleResolver } from "../graph/module-graph.js"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  isTypeOnlyModuleDeclaration,
  localIdentifierUsageByName,
  valueImportBindingNames,
} from "./shared-module-usage.js"

export const TsAd02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  // Cap on number of cycles reported in diagnostics; the raw output
  // includes all detected cycles regardless.
  top_n_diagnostics: Schema.Number,
})
export type TsAd02Config = typeof TsAd02Config.Type

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

interface ExpiredBypassMatch {
  readonly file: string
  readonly bypass: PulsarAllowBypass
}

export interface TsAd02Output {
  readonly cycles: ReadonlyArray<Cycle>
  readonly cycleCount: number
  readonly largestCycleSize: number
  readonly expiredBypasses: ReadonlyArray<ExpiredBypassMatch>
  readonly diagnosticLimit: number
}

/**
 * TS-AD-02 — circular module dependencies.
 *
 * Builds the import graph across the project's source files, then runs
 * Tarjan's strongly-connected-components algorithm to detect cycles.
 * Any SCC with more than one node, or a self-loop (node pointing to
 * itself), counts as a cycle.
 *
 * Threshold defaults:
 * - exclude_globs: skip tests and build artifacts so generated code
 *   and type-fixture cycles don't drown out real signal.
 * - top_n_diagnostics: 10 — readable diagnostic lists should stay
 *   scannable; raw output preserves all cycles for consumers that want
 *   the full picture.
 */
export const TsAd02: Signal<TsAd02Config, TsAd02Output, TsProjectTag> = {
  id: "TS-AD-02-circular-dependencies",
  title: "Circular dependencies",
  aliases: ["TS-AD-02"],
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  cacheVersion: "semantic-type-only-imports-v1",
  configSchema: TsAd02Config,
  defaultConfig: {
    // Rationale: cycles inside test scaffolding or generated output are
    // not architectural signal — they would either be intentional
    // (mocks) or artifacts of tooling.
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.d.ts",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/gen/**",
      "**/generated/**",
      "**/vendor/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/example/**",
      "**/examples/**",
      "**/demo/**",
      "**/demos/**",
      "**/private-demos/**",
      "**/sample/**",
      "**/samples/**",
      "**/sdk-samples/**",
      "**/google_samples/**",
    ],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsAd02Output => {
          // 1. Collect in-project source files (absolute paths).
          const sourceFiles = project
            .getSourceFiles()
            .filter((sf) => !isExcluded(sf.getFilePath(), config.exclude_globs))
          const fileSet = new Set(sourceFiles.map((sf) => sf.getFilePath()))
          const sourceTextByPath = new Map(
            sourceFiles.map((sf) => [sf.getFilePath(), sf.getFullText()] as const),
          )
          const bypassesByFile = new Map(
            sourceFiles.map((sf) => [sf.getFilePath(), parseBypasses(sf.getFullText())] as const),
          )

          // 2. Build directed graph: file -> Set<imported file path>.
          //    Only edges whose target is within fileSet are kept; that
          //    intentionally ignores node_modules and ambient types.
          const graph = buildImportGraph(sourceFiles, fileSet)

          // 3. Run Tarjan's SCC algorithm.
          const sccs = tarjanSccs(graph)

          // 4. SCCs of size >= 2 are cycles. Size-1 SCCs are cycles
          //    only if the node has a self-edge.
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

          // Sort cycles largest-first for stable, actionable output.
          const cycles = rawCycles
            .slice()
            .sort((a, b) => b.modules.length - a.modules.length)

          const largestCycleSize = cycles.reduce(
            (acc, c) => Math.max(acc, c.modules.length),
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
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AD-02-circular-dependencies",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.cycleCount === 0) return 1
    // Two-part penalty: cycle count drives broad pressure, while cycle
    // size grows logarithmically so local and subsystem cycles stay
    // distinguishable from repo-scale tangles. Huge SCCs still collapse
    // toward the floor.
    const countPenalty = Math.min(0.45, out.cycleCount * 0.05)
    const sizePenalty = cycleSizePenalty(out.largestCycleSize)
    return Math.max(0.05, 1 - countPenalty - sizePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const expired = out.expiredBypasses.map(({ file, bypass }) =>
      toExpiredBypassDiagnostic("TS-AD-02", file, bypass),
    )
    const cycles = out.cycles
      .filter((cycle) => !hasSuppressingBypass(cycle.suppressingBypasses))
      .slice(0, out.diagnosticLimit)

    return [
      ...expired,
      ...cycles.map((c) => {
        const members = formatCycleSpan(c)
        const breakEdge = formatBreakEdge(c)
        const location = c.minBreakEdge?.from ?? c.modules[0]
        const severity = cycleSeverity(c, out)
        return {
          severity,
          message:
            `Circular dependency cluster (${c.modules.length} modules; ` +
            (breakEdge === undefined ? "" : `candidate break ${breakEdge}; `) +
            `sample ${members})`,
          ...(location !== undefined ? { location: { file: location } } : {}),
          data: {
            hash: c.identityHash,
            size: c.modules.length,
            modules: c.modules.slice(),
            architecturalSpan: c.architecturalSpan,
            minBreakEdge: c.minBreakEdge,
            severityReason:
              severity === "block"
                ? "large-or-broad-runtime-cycle"
                : "local-runtime-cycle",
          },
        }
      }),
    ]
  },
}

const cycleSeverity = (
  cycle: Cycle,
  out: TsAd02Output,
): Diagnostic["severity"] => {
  if (cycle.modules.length >= 20) return "block"
  if (out.cycleCount >= 10) return "block"
  return "warn"
}

const cycleSizePenalty = (largestCycleSize: number): number => {
  const scale = Math.log2(Math.max(1, largestCycleSize - 1))
  if (largestCycleSize >= 75) return 0.9
  if (largestCycleSize >= 20) return Math.min(0.7, scale * 0.1)
  if (largestCycleSize >= 8) return scale * 0.09
  return scale * 0.12
}

/* ------------------------------------------------------------------ */
/* Import graph construction                                           */
/* ------------------------------------------------------------------ */

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

const formatCycleSpan = (cycle: Cycle): string => {
  const commonDir = commonDirectory(cycle.modules)
  const prefix = compactDirectoryLabel(commonDir)
  const compactSpan = cycle.architecturalSpan
    .split("→")
    .map((module) => compactModulePath(module, commonDir))
    .join(" -> ")

  return prefix.length > 0 ? `${prefix}: ${compactSpan}` : compactSpan
}

const formatBreakEdge = (cycle: Cycle): string | undefined => {
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

/* ------------------------------------------------------------------ */
/* Tarjan's SCC                                                        */
/* ------------------------------------------------------------------ */

const tarjanSccs = (graph: ReadonlyMap<string, ReadonlySet<string>>): Array<Array<string>> => {
  let index = 0
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: Array<string> = []
  const sccs: Array<Array<string>> = []

  // Iterative DFS to avoid blowing the call stack on large repos.
  const strongConnect = (root: string): void => {
    type Frame = { node: string; iter: Iterator<string> }
    const callStack: Array<Frame> = []

    const enter = (node: string): void => {
      indices.set(node, index)
      lowlinks.set(node, index)
      index += 1
      stack.push(node)
      onStack.add(node)
      const neighbors = graph.get(node)
      callStack.push({
        node,
        iter: (neighbors ?? new Set<string>()).values(),
      })
    }

    enter(root)

    while (callStack.length > 0) {
      const frame = callStack[callStack.length - 1]!
      const next = frame.iter.next()
      if (next.done === true) {
        // Post-order: emit SCC if this node is the root of one.
        if (lowlinks.get(frame.node) === indices.get(frame.node)) {
          const scc: Array<string> = []
          while (true) {
            const w = stack.pop()!
            onStack.delete(w)
            scc.push(w)
            if (w === frame.node) break
          }
          sccs.push(scc)
        }
        callStack.pop()
        if (callStack.length > 0) {
          // Propagate lowlink to parent.
          const parent = callStack[callStack.length - 1]!
          const parentLow = lowlinks.get(parent.node) ?? 0
          const childLow = lowlinks.get(frame.node) ?? 0
          if (childLow < parentLow) {
            lowlinks.set(parent.node, childLow)
          }
        }
        continue
      }
      const neighbor = next.value
      if (!indices.has(neighbor)) {
        enter(neighbor)
      } else if (onStack.has(neighbor)) {
        const neighborIndex = indices.get(neighbor) ?? 0
        const currentLow = lowlinks.get(frame.node) ?? 0
        if (neighborIndex < currentLow) {
          lowlinks.set(frame.node, neighborIndex)
        }
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) {
      strongConnect(node)
    }
  }

  return sccs
}

/* ------------------------------------------------------------------ */
/* Cycle shaping                                                       */
/* ------------------------------------------------------------------ */

const toCycle = (
  scc: ReadonlyArray<string>,
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  sourceTextByPath: ReadonlyMap<string, string>,
  bypassesByFile: ReadonlyMap<string, ReadonlyArray<PulsarAllowBypass>>,
): Cycle => {
  const memberSet = new Set(scc)
  // Minimal break edge heuristic: among internal edges of this SCC,
  // pick the one whose source has the smallest fan-out inside the SCC.
  // Tie-break by lexicographic order so output is stable.
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

  // Sort member list for stable output.
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
