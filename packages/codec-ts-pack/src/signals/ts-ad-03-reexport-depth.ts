import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { basename } from "node:path"
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
}

export const TsAd03: Signal<TsAd03Config, TsAd03Output, TsProjectTag> = {
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
      const result = yield* Effect.try({
        try: (): TsAd03Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          const fileSet = new Set(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
          const reExportTargets = new Map<string, ReadonlyArray<string>>()
          const analysisByFile = new Map<string, ReExportAnalysis>()

          for (const sourceFile of sourceFiles) {
            const file = sourceFile.getFilePath()
            const targets = sourceFile
              .getExportDeclarations()
              .map((declaration) => declaration.getModuleSpecifierSourceFile()?.getFilePath())
              .reduce<Array<string>>((acc, value) => {
                if (value !== undefined && fileSet.has(value)) {
                  acc.push(value)
                }
                return acc
              }, [])
            reExportTargets.set(file, targets)

            const exportedDeclarations = sourceFile.getExportedDeclarations()
            const totalExports = exportedDeclarations.size
            const reExportedCount = [...exportedDeclarations.values()].filter((declarations) =>
              declarations.some((declaration) => declaration.getSourceFile() !== sourceFile),
            ).length
            const directReExports = targets.length
            const barrelRatio =
              totalExports === 0
                ? directReExports > 0
                  ? 1
                  : 0
                : reExportedCount / totalExports
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

          const chainsOverThreshold = allChains
            .filter((chain) => chain.depth > config.chain_threshold || chain.cycle)
            .sort(compareChains)

          return {
            byFile: analysisByFile,
            chainsOverThreshold,
            stats: summarize(allChains.map((chain) => chain.depth)),
            threshold: config.chain_threshold,
            scoreScale: config.score_scale,
            diagnosticLimit: config.top_n_diagnostics,
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
    const penalty = (out.stats.max - out.threshold) / Math.max(1, out.scoreScale)
    return Math.max(0, 1 - Math.min(1, Math.max(0, penalty)))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.chainsOverThreshold.slice(0, out.diagnosticLimit).map((chain) => ({
      severity: "warn" as const,
      message:
        `${chain.cycle ? "Re-export cycle" : "Deep re-export chain"} ` +
        `(depth ${chain.depth}): ${chain.hops.join(" -> ")}`,
      location: { file: chain.start },
      data: {
        start: chain.start,
        end: chain.end,
        depth: chain.depth,
        hops: chain.hops.slice(),
        cycle: chain.cycle,
      },
    })),
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

const compareChains = (left: ReExportChain, right: ReExportChain): number => {
  if (Number(right.cycle) !== Number(left.cycle)) {
    return Number(right.cycle) - Number(left.cycle)
  }
  if (right.depth !== left.depth) {
    return right.depth - left.depth
  }
  return left.start.localeCompare(right.start)
}
