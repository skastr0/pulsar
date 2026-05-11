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

export const RsLd05Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_complexity: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type RsLd05Config = typeof RsLd05Config.Type

export interface RustFunctionComplexity {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly complexity: number
}

export interface RsLd05Output {
  readonly functions: ReadonlyArray<RustFunctionComplexity>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThresholdCount: number
  readonly totalFunctions: number
  readonly analysisMode: "standard-cyclomatic"
}

export const RsLd05: Signal<RsLd05Config, RsLd05Output, RustProjectTag> = {
  id: "RS-LD-05-cyclomatic-complexity",
  title: "Cyclomatic complexity",
  aliases: ["RS-LD-05"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: RsLd05Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    max_complexity: 10,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd05Output> => {
          const facts = await collectRustProjectFacts(project)
          const functions = facts.functions
            .filter((fn) => !isExcluded(fn.file, config.exclude_globs))
            .map((fn) => ({
              file: fn.file,
              module: fn.modulePath,
              name: fn.name,
              line: fn.line,
              complexity: fn.complexity,
            }))
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
            overThresholdCount: functions.filter((fn) => fn.complexity > config.max_complexity).length,
            totalFunctions: functions.length,
            analysisMode: "standard-cyclomatic",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-05-cyclomatic-complexity", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    return Math.max(0, 1 - (out.overThresholdCount / out.totalFunctions) * 2)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.functions.slice(0, 10).map((fn) => ({
      severity: fn.complexity > 10 ? ("warn" as const) : ("info" as const),
      message: `Function ${fn.name} has cyclomatic complexity ${fn.complexity}`,
      location: { file: fn.file, line: fn.line },
      data: { ...fn, analysisMode: out.analysisMode },
    })),
}
