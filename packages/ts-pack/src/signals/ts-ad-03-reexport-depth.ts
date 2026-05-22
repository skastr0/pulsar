import { SignalContextTag, SignalComputeError, summarize } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, DistributionalSummary, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import type { SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  collectReExportChains,
  compareChains,
  effectiveChainDepth,
  type ReExportChain,
  uniqueChains,
} from "./ts-ad-03-chains.js"
import {
  formatDiagnosticPath,
  formatHopChain,
  selectDiagnosticChains,
} from "./ts-ad-03-diagnostics.js"
import {
  buildReExportAnalysis,
  type ReExportAnalysis,
} from "./ts-ad-03-reexport-analysis.js"

const TsAd03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  barrel_ratio_threshold: Schema.Number,
  index_reexport_threshold: Schema.Number,
  chain_threshold: Schema.Number,
  score_scale: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type TsAd03Config = typeof TsAd03Config.Type

interface TsAd03Output {
  readonly byFile: ReadonlyMap<string, ReExportAnalysis>
  readonly chainsOverThreshold: ReadonlyArray<ReExportChain>
  readonly stats: DistributionalSummary
  readonly threshold: number
  readonly scoreScale: number
  readonly diagnosticLimit: number
  readonly worktreePath?: string
}

export const TsAd03: Signal<TsAd03Config, TsAd03Output, TsProjectTag | SignalContextTag> = {
  id: "TS-AD-03-reexport-depth",
  title: "Re-export depth",
  aliases: ["TS-AD-03"],
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  cacheVersion: "diagnostic-limit-v1",
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
          return computeReExportDepthOutput(sourceFiles, config, context.worktreePath)
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AD-03-reexport-depth",
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

const computeReExportDepthOutput = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsAd03Config,
  worktreePath: string,
): TsAd03Output => {
  const { reExportTargets, analysisByFile } = buildReExportAnalysis(sourceFiles, config)
  const allChains = collectReExportChains(reExportTargets, analysisByFile)
  const chainsOverThreshold = uniqueChains(allChains)
    .filter((chain) => chain.depth > config.chain_threshold || chain.cycle)
    .sort(compareChains)

  return {
    byFile: analysisByFile,
    chainsOverThreshold,
    stats: summarize(allChains.map((chain) => chain.depth)),
    threshold: config.chain_threshold,
    scoreScale: config.score_scale,
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    worktreePath,
  }
}

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
