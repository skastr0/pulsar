import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import { buildModuleGraph } from "../graph/module-graph.js"
import { TsProjectTag } from "../ts-project.js"

export const TsDe02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  hub_fan_in_threshold: Schema.Number,
  hub_fan_out_threshold: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsDe02Config = typeof TsDe02Config.Type

export interface ModuleFan {
  readonly fanIn: number
  readonly fanOut: number
}

export interface HubEntry {
  readonly file: string
  readonly fanIn: number
  readonly fanOut: number
}

export interface TsDe02Output {
  readonly byModule: ReadonlyMap<string, ModuleFan>
  readonly hubs: ReadonlyArray<HubEntry>
  readonly totalModules: number
}

/**
 * TS-DE-02 — fan-in / fan-out per module.
 *
 * For each in-project source file, counts:
 *   - fanIn:  how many other in-project files import it
 *   - fanOut: how many other in-project files it imports
 *
 * A "hub" is a file above both thresholds — a coupling concentrator.
 *
 * Threshold defaults:
 * - hub_fan_in_threshold: 10 — a file imported by 10+ modules is a
 *   de-facto shared utility; that's worth surfacing for review.
 * - hub_fan_out_threshold: 5 — combined with the fan-in threshold this
 *   catches files that both consume and are consumed widely, which is
 *   the coupling-hub shape from the research literature.
 */
export const TsDe02: Signal<TsDe02Config, TsDe02Output, TsProjectTag> = {
  id: "TS-DE-02-fan-in-fan-out",
  title: "Fan-in/fan-out",
  aliases: ["TS-DE-02"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: TsDe02Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    hub_fan_in_threshold: 10,
    hub_fan_out_threshold: 5,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsDe02Output => {
          const graph = buildModuleGraph(project, {
            excludeGlobs: config.exclude_globs,
            includeExportEdges: true,
          })

          const byModule = new Map<string, ModuleFan>()
          for (const path of graph.fileSet) {
            byModule.set(path, {
              fanIn: graph.reverseDependencies.get(path)?.size ?? 0,
              fanOut: graph.dependencies.get(path)?.size ?? 0,
            })
          }

          const hubs: Array<HubEntry> = []
          for (const [file, fan] of byModule) {
            if (
              fan.fanIn >= config.hub_fan_in_threshold &&
              fan.fanOut >= config.hub_fan_out_threshold
            ) {
              hubs.push({ file, fanIn: fan.fanIn, fanOut: fan.fanOut })
            }
          }
          // Rank hubs by combined load (sum), then file path for
          // lexical stability.
          hubs.sort((a, b) => {
            const aLoad = a.fanIn + a.fanOut
            const bLoad = b.fanIn + b.fanOut
            if (bLoad !== aLoad) return bLoad - aLoad
            return a.file < b.file ? -1 : a.file > b.file ? 1 : 0
          })

          return {
            byModule,
            hubs,
            totalModules: graph.fileSet.size,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-02-fan-in-fan-out",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.totalModules === 0) return 1
    // Hubs as a share of total modules. Multiplier 3 compresses the
    // healthy band: a repo with ~3% hubs lands near 0.9; 10% hubs sink
    // toward 0.7; anything above a third of modules being hubs is
    // essentially zero.
    const hubShare = out.hubs.length / out.totalModules
    return Math.max(0, 1 - hubShare * 3)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const top = out.hubs.slice(0, 10)
    return top.map((h) => ({
      severity: "warn" as const,
      message: `Hub module: ${h.file} (fanIn=${h.fanIn}, fanOut=${h.fanOut})`,
      location: { file: h.file },
      data: {
        file: h.file,
        fanIn: h.fanIn,
        fanOut: h.fanOut,
      },
    }))
  },
}
