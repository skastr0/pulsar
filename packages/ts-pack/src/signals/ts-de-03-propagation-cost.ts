import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { buildModuleGraph } from "../graph/module-graph.js"
import { computeReachabilityCounts } from "../graph/reachability.js"
import { condenseGraph, tarjanSccs } from "../graph/tarjan.js"
import { TsProjectTag } from "../ts-project.js"

export const TsDe03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  target: Schema.Number,
  scale: Schema.Number,
  small_sample_threshold: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsDe03Config = typeof TsDe03Config.Type

export interface PropagationInfo {
  readonly reverseReach: number
  readonly forwardReach: number
  readonly directDependents: number
  readonly directDependencies: number
}

export interface TsDe03Output {
  readonly byModule: ReadonlyMap<string, PropagationInfo>
  readonly propagationCost: number
  readonly top10Propagators: ReadonlyArray<{ file: string; reverseReach: number }>
  readonly totalModules: number
  readonly reachabilityMode: "bitset" | "bloom"
  readonly target: number
  readonly scale: number
  readonly smallSampleThreshold: number
  readonly diagnosticLimit: number
}

export const TsDe03: Signal<TsDe03Config, TsDe03Output, TsProjectTag> = {
  id: "TS-DE-03-propagation-cost",
  title: "Propagation cost",
  aliases: ["TS-DE-03"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: TsDe03Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    target: 0.3,
    scale: 0.4,
    small_sample_threshold: 20,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsDe03Output => {
          const moduleGraph = buildModuleGraph(project, {
            excludeGlobs: config.exclude_globs,
            includeExportEdges: false,
          })
          return computePropagationCost(moduleGraph, config)
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-03-propagation-cost",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    const penalty = (out.propagationCost - out.target) / out.scale
    return Math.max(0, 1 - Math.min(1, Math.max(0, penalty)))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    if (out.totalModules < out.smallSampleThreshold) {
      diagnostics.push({
        severity: "warn" as const,
        message:
          `Propagation cost sample size is small (${out.totalModules} modules; ` +
          `threshold ${out.smallSampleThreshold})`,
        data: {
          totalModules: out.totalModules,
          threshold: out.smallSampleThreshold,
        },
      })
    }

    if (out.propagationCost <= out.target) {
      return diagnostics
    }

    diagnostics.push(
      ...out.top10Propagators.slice(0, out.diagnosticLimit).map((entry) => ({
        severity: "warn" as const,
        message: `High propagation cost module: ${entry.file} (reverse reach ${entry.reverseReach})`,
        location: { file: entry.file },
        data: {
          file: entry.file,
          reverseReach: entry.reverseReach,
          propagationCost: out.propagationCost,
          reachabilityMode: out.reachabilityMode,
        },
      })),
    )

    return diagnostics
  },
}

type ModuleGraph = ReturnType<typeof buildModuleGraph>
type ReachabilityMode = TsDe03Output["reachabilityMode"]

const computePropagationCost = (
  moduleGraph: ModuleGraph,
  config: TsDe03Config,
): TsDe03Output => {
  const moduleIndexByFile = indexModulesByFile(moduleGraph)
  const sccs = tarjanSccs(moduleGraph.dependencies)
  const condensed = condenseGraph(moduleGraph.dependencies, sccs)
  const componentModules = condensed.components.map((component) =>
    component
      .map((file) => moduleIndexByFile.get(file))
      .filter((index): index is number => index !== undefined),
  )
  const forwardReach = computeReachabilityCounts(
    condensed.dag,
    componentModules,
    moduleGraph.sourceFiles.length,
  )
  const reverseReach = computeReachabilityCounts(
    condensed.reverseDag,
    componentModules,
    moduleGraph.sourceFiles.length,
  )
  const byModule = buildPropagationInfo(
    moduleGraph,
    condensed,
    forwardReach.counts,
    reverseReach.counts,
  )

  return buildPropagationOutput(byModule, reverseReach.mode, config)
}

const indexModulesByFile = (moduleGraph: ModuleGraph): ReadonlyMap<string, number> =>
  new Map<string, number>(
    moduleGraph.sourceFiles.map((sourceFile, index) => [sourceFile.getFilePath(), index] as const),
  )

const buildPropagationInfo = (
  moduleGraph: ModuleGraph,
  condensed: ReturnType<typeof condenseGraph>,
  forwardReach: ReadonlyArray<number>,
  reverseReach: ReadonlyArray<number>,
): ReadonlyMap<string, PropagationInfo> => {
  const byModule = new Map<string, PropagationInfo>()

  for (const sourceFile of moduleGraph.sourceFiles) {
    const file = sourceFile.getFilePath()
    const componentIndex = condensed.nodeToComponent.get(file)
    if (componentIndex === undefined) continue
    const intraComponent = (condensed.components[componentIndex]?.length ?? 1) - 1
    byModule.set(file, {
      forwardReach: intraComponent + (forwardReach[componentIndex] ?? 0),
      reverseReach: intraComponent + (reverseReach[componentIndex] ?? 0),
      directDependencies: moduleGraph.dependencies.get(file)?.size ?? 0,
      directDependents: moduleGraph.reverseDependencies.get(file)?.size ?? 0,
    })
  }

  return byModule
}

const buildPropagationOutput = (
  byModule: ReadonlyMap<string, PropagationInfo>,
  reachabilityMode: ReachabilityMode,
  config: TsDe03Config,
): TsDe03Output => {
  const totalModules = byModule.size
  const reverseReachTotal = [...byModule.values()].reduce((sum, info) => sum + info.reverseReach, 0)

  return {
    byModule,
    propagationCost: totalModules === 0 ? 0 : reverseReachTotal / (totalModules * totalModules),
    top10Propagators: topPropagators(byModule),
    totalModules,
    reachabilityMode,
    target: config.target,
    scale: config.scale,
    smallSampleThreshold: config.small_sample_threshold,
    diagnosticLimit: config.top_n_diagnostics,
  }
}

const topPropagators = (
  byModule: ReadonlyMap<string, PropagationInfo>,
): ReadonlyArray<{ file: string; reverseReach: number }> =>
  [...byModule.entries()]
    .map(([file, info]) => ({ file, reverseReach: info.reverseReach }))
    .sort((left, right) => {
      if (right.reverseReach !== left.reverseReach) {
        return right.reverseReach - left.reverseReach
      }
      return left.file.localeCompare(right.file)
    })
    .slice(0, 10)
