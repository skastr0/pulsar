import {
  SignalContextTag,
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { basename, relative } from "node:path"
import { Node, type SourceFile } from "ts-morph"
import { createModuleResolver } from "../graph/module-graph.js"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"

export const TsAd03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  barrel_ratio_threshold: Schema.Number,
  index_reexport_threshold: Schema.Number,
  chain_threshold: Schema.Number,
  score_scale: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsAd03Config = typeof TsAd03Config.Type

export interface ReExportAnalysis {
  readonly isBarrel: boolean
  readonly barrelRatio: number
  readonly maxChainDepth: number
  readonly directReExports: number
}

export interface ReExportChain {
  readonly start: string
  readonly end: string
  readonly depth: number
  readonly hops: ReadonlyArray<string>
  readonly cycle: boolean
}

export interface TsAd03Output {
  readonly byFile: ReadonlyMap<string, ReExportAnalysis>
  readonly chainsOverThreshold: ReadonlyArray<ReExportChain>
  readonly stats: DistributionalSummary
  readonly threshold: number
  readonly scoreScale: number
  readonly diagnosticLimit: number
  readonly worktreePath?: string
}

export const TsAd03: Signal<TsAd03Config, TsAd03Output, TsProjectTag | SignalContextTag> = {
  id: "TS-AD-03",
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  configSchema: TsAd03Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    barrel_ratio_threshold: 0.5,
    index_reexport_threshold: 3,
    chain_threshold: 3,
    score_scale: 3,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      const result = yield* Effect.try({
        try: (): TsAd03Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          const fileSet: ReadonlySet<string> = new Set(
            sourceFiles.map((sourceFile): string => sourceFile.getFilePath()),
          )
          const resolver = createModuleResolver(sourceFiles, [])
          const reExportTargets = new Map<string, ReadonlyArray<string>>()
          const analysisByFile = new Map<string, ReExportAnalysis>()

          for (const sourceFile of sourceFiles) {
            const file: string = sourceFile.getFilePath()
            const targets = uniqueSorted(
              sourceFile.getExportDeclarations().reduce<Array<string>>((acc, declaration) => {
                const value = resolver.resolve(file, declaration)
                if (value !== undefined && fileSet.has(value)) {
                  acc.push(value)
                }
                return acc
              }, []),
            )
            reExportTargets.set(file, targets)

            const directReExports = targets.length
            const totalExports = directReExports + countLocalExportSurfaces(sourceFile)
            const barrelRatio =
              totalExports === 0
                ? directReExports > 0
                  ? 1
                  : 0
                : directReExports / totalExports
            const isBarrel =
              barrelRatio >= config.barrel_ratio_threshold ||
              (basename(file) === "index.ts" && directReExports >= config.index_reexport_threshold)

            analysisByFile.set(file, {
              isBarrel,
              barrelRatio,
              maxChainDepth: 0,
              directReExports,
            })
          }

          const allChains: Array<ReExportChain> = []
          for (const [file, targets] of reExportTargets) {
            const chains = targets.flatMap((target) =>
              walkReExportChains(file, target, reExportTargets, analysisByFile, [file]),
            )
            allChains.push(...chains)
            const current = analysisByFile.get(file)
            if (current !== undefined) {
              analysisByFile.set(file, {
                ...current,
                maxChainDepth: chains.reduce((max, chain) => Math.max(max, chain.depth), 0),
              })
            }
          }

          const chainsOverThreshold = uniqueChains(allChains)
            .filter((chain) => chain.depth > config.chain_threshold || chain.cycle)
            .sort(compareChains)

          return {
            byFile: analysisByFile,
            chainsOverThreshold,
            stats: summarize(allChains.map((chain) => chain.depth)),
            threshold: config.chain_threshold,
            scoreScale: config.score_scale,
            diagnosticLimit: config.top_n_diagnostics,
            worktreePath: context.worktreePath,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AD-03",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.chainsOverThreshold.length === 0) return 1
    const maxEffectiveDepth = Math.max(...out.chainsOverThreshold.map(effectiveChainDepth))
    const penalty = (maxEffectiveDepth - out.threshold) / Math.max(1, out.scoreScale)
    return Math.max(0, 1 - Math.min(1, Math.max(0, penalty)))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    selectDiagnosticChains(out.chainsOverThreshold, out.diagnosticLimit).map((chain) => ({
      severity: "warn" as const,
      message:
        `${chain.cycle ? "Re-export cycle" : "Deep re-export chain"} ` +
        `(depth ${chain.depth}): ${formatHopChain(chain.hops, out.worktreePath)}`,
      location: { file: chain.start },
      data: {
        start: chain.start,
        end: chain.end,
        depth: chain.depth,
        effectiveDepth: effectiveChainDepth(chain),
        hops: chain.hops.slice(),
        displayHops: chain.hops.map((hop) => formatDiagnosticPath(hop, out.worktreePath)),
        cycle: chain.cycle,
      },
    })),
}

const formatHopChain = (hops: ReadonlyArray<string>, worktreePath: string | undefined): string =>
  hops.map((hop) => formatDiagnosticPath(hop, worktreePath)).join(" -> ")

const formatDiagnosticPath = (filePath: string, worktreePath: string | undefined): string => {
  if (worktreePath === undefined) return filePath
  const rel = relative(worktreePath, filePath)
  return rel.length > 0 && !rel.startsWith("..") ? rel : filePath
}

const effectiveChainDepth = (chain: ReExportChain): number => {
  if (chain.cycle) return chain.depth

  const relayHops = chain.hops.slice(1, -1)
  const indexRelayCount = relayHops.filter(isDirectoryIndexFile).length
  return Math.max(1, chain.depth - Math.min(2, indexRelayCount))
}

const isDirectoryIndexFile = (filePath: string): boolean =>
  /(?:^|[\\/])index\.tsx?$/.test(filePath)

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

const compareChains = (left: ReExportChain, right: ReExportChain): number => {
  if (Number(right.cycle) !== Number(left.cycle)) {
    return Number(right.cycle) - Number(left.cycle)
  }
  if (right.depth !== left.depth) {
    return right.depth - left.depth
  }
  return left.start.localeCompare(right.start)
}

const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))

const uniqueChains = (chains: ReadonlyArray<ReExportChain>): ReadonlyArray<ReExportChain> => {
  const byKey = new Map<string, ReExportChain>()
  for (const chain of chains) {
    byKey.set(`${chain.cycle ? "cycle" : "chain"}|${chain.hops.join("\0")}`, chain)
  }
  return [...byKey.values()]
}

const selectDiagnosticChains = (
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

const countLocalExportSurfaces = (sourceFile: SourceFile): number => {
  let count = 0

  for (const statement of sourceFile.getStatements()) {
    if (Node.isExportDeclaration(statement)) {
      if (statement.getModuleSpecifierValue() !== undefined) continue
      count += Math.max(1, statement.getNamedExports().length)
      continue
    }

    if (Node.isExportAssignment(statement)) {
      count += 1
      continue
    }

    if (Node.isVariableStatement(statement)) {
      if (!hasExportModifier(statement)) continue
      count += Math.max(1, statement.getDeclarations().length)
      continue
    }

    if (
      Node.isFunctionDeclaration(statement) ||
      Node.isClassDeclaration(statement) ||
      Node.isInterfaceDeclaration(statement) ||
      Node.isTypeAliasDeclaration(statement) ||
      Node.isEnumDeclaration(statement) ||
      Node.isModuleDeclaration(statement)
    ) {
      if (hasExportModifier(statement)) count += 1
    }
  }

  return count
}

const hasExportModifier = (
  node:
    | import("ts-morph").VariableStatement
    | import("ts-morph").FunctionDeclaration
    | import("ts-morph").ClassDeclaration
    | import("ts-morph").InterfaceDeclaration
    | import("ts-morph").TypeAliasDeclaration
    | import("ts-morph").EnumDeclaration
    | import("ts-morph").ModuleDeclaration,
): boolean => node.getModifiers().some((modifier) => modifier.getText() === "export")
