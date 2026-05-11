import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { isExcluded } from "./shared-globs.js"
import { scoreDoubleWeightedThresholdRatio } from "./shared-threshold-score.js"

const RsLd02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_lifetime_complexity: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsLd02Config = typeof RsLd02Config.Type

interface LifetimeComplexityFact {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly lifetimeParams: number
  readonly lifetimeBounds: number
  readonly inputPositions: number
  readonly outputPositions: number
  readonly constraintPositions: number
  readonly complexity: number
}

interface RsLd02Output {
  readonly functions: ReadonlyArray<LifetimeComplexityFact>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThresholdCount: number
  readonly totalFunctions: number
}

export const RsLd02: Signal<RsLd02Config, RsLd02Output, RustProjectTag> = {
  id: "RS-LD-02-lifetime-complexity",
  title: "Lifetime complexity",
  aliases: ["RS-LD-02"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: RsLd02Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    max_lifetime_complexity: 4,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd02Output> => {
          const facts = await collectRustProjectFacts(project)
          const functions = facts.functions
            .filter((fn) => !isExcluded(fn.file, config.exclude_globs))
            .map((fn) => ({
              file: fn.file,
              module: fn.modulePath,
              name: fn.name,
              line: fn.line,
              lifetimeParams: fn.lifetimeParamCount,
              lifetimeBounds: fn.lifetimeBoundCount,
              inputPositions: fn.lifetimeInputCount,
              outputPositions: fn.lifetimeOutputCount,
              constraintPositions: fn.lifetimeConstraintCount,
              complexity:
                fn.lifetimeParamCount +
                fn.lifetimeBoundCount +
                fn.lifetimeInputCount +
                fn.lifetimeOutputCount +
                fn.lifetimeConstraintCount,
            }))
            .filter((fn) => fn.complexity > 0)
            .sort((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file))

          const byFileValues = new Map<string, Array<number>>()
          for (const fn of functions) {
            const bucket = byFileValues.get(fn.file) ?? []
            bucket.push(fn.complexity)
            byFileValues.set(fn.file, bucket)
          }
          const byFile = new Map<string, DistributionalSummary>()
          for (const [file, values] of byFileValues) {
            byFile.set(file, summarize(values))
          }

          return {
            functions,
            byFile,
            overThresholdCount: functions.filter(
              (fn) => fn.complexity > config.max_lifetime_complexity,
            ).length,
            totalFunctions: functions.length,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-02-lifetime-complexity", message: String(cause), cause }),
      })
    }),
  score: (out) => scoreDoubleWeightedThresholdRatio(out.overThresholdCount, out.totalFunctions),
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.functions.slice(0, 10).map((fn) => ({
      severity: fn.complexity >= 5 ? ("warn" as const) : ("info" as const),
      message: `Lifetime complexity in ${fn.name}: ${fn.complexity} (params:${fn.lifetimeParams}, bounds:${fn.lifetimeBounds}, in:${fn.inputPositions}, out:${fn.outputPositions})`,
      location: { file: fn.file, line: fn.line },
      data: { ...fn },
    })),
}
