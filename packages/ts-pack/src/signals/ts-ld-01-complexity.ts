import { SignalComputeError, summarize } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, DistributionalSummary, Signal } from "@skastr0/pulsar-core/signal"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import type { CalibrationDecision } from "@skastr0/pulsar-core/calibration"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import { calibrateFunctionNames } from "./ts-ld-01-calibration.js"
import {
  collectFunctionComplexities,
  type FunctionComplexityCandidate,
} from "./ts-ld-01-collection.js"

export const TsLd01Config = Schema.Struct({
  max_complexity: Schema.Number,
  top_n_diagnostics: Schema.Number,
  exclude_globs: Schema.Array(Schema.String),
})
export type TsLd01Config = typeof TsLd01Config.Type

export interface FunctionComplexity {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly complexity: number
}

export interface TsLd01Output {
  readonly functions: ReadonlyArray<FunctionComplexity>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThresholdCount: number
  readonly totalFunctions: number
  readonly maxComplexity: number
  readonly ratioPressure: number
  readonly maxComplexityPressure: number
}

export const TsLd01: Signal<TsLd01Config, TsLd01Output, TsProjectTag> = {
  id: "TS-LD-01-cyclomatic-complexity",
  title: "Cyclomatic complexity",
  aliases: ["TS-LD-01"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "callback-context-calibration-v1",
  configSchema: TsLd01Config,
  defaultConfig: {
    max_complexity: 20,
    top_n_diagnostics: 10,
    exclude_globs: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**", "**/dist/**"],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const candidates = yield* Effect.try({
        try: (): ReadonlyArray<FunctionComplexityCandidate> => {
          const functions: Array<FunctionComplexityCandidate> = []

          for (const sf of project.getSourceFiles()) {
            const path = sf.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue
            functions.push(...collectFunctionComplexities(sf))
          }

          return functions
        },
        catch: toSignalComputeError,
      })
      const { functions, calibrationDecisions } = yield* calibrateFunctionNames(
        candidates,
        calibration,
      ).pipe(Effect.mapError(toSignalComputeError))

      const perFileValues = new Map<string, Array<number>>()
      for (const fn of functions) {
        const bucket = perFileValues.get(fn.file) ?? []
        bucket.push(fn.complexity)
        perFileValues.set(fn.file, bucket)
      }

      const byFile = new Map<string, DistributionalSummary>()
      for (const [path, values] of perFileValues) {
        byFile.set(path, summarize(values))
      }

      const overThresholdCount = functions.filter(
        (f) => f.complexity > config.max_complexity,
      ).length
      const maxComplexity = functions.reduce(
        (max, f) => Math.max(max, f.complexity),
        0,
      )
      const ratio =
        functions.length === 0 ? 0 : overThresholdCount / functions.length
      const ratioPressure = Math.min(1, ratio * 2)
      const maxComplexityPressure =
        maxComplexity <= config.max_complexity || maxComplexity === 0
          ? 0
          : (maxComplexity - config.max_complexity) / maxComplexity

      return {
        functions,
        calibrationDecisions,
        byFile,
        overThresholdCount,
        totalFunctions: functions.length,
        maxComplexity,
        ratioPressure,
        maxComplexityPressure,
      }
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    const pressure = Math.max(out.ratioPressure, out.maxComplexityPressure)
    return Math.max(0, 1 - pressure)
  },
  outputMetadata: (out) =>
    out.totalFunctions === 0 ? { applicability: "not_applicable" as const } : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const sorted = [...out.functions].sort((a, b) => b.complexity - a.complexity)
    const top = sorted.slice(0, 10)
    return top.map((f) => ({
      severity: "warn" as const,
      message: `Function \`${f.name}\` has cyclomatic complexity ${f.complexity}`,
      location: { file: f.file, line: f.line },
      data: {
        complexity: f.complexity,
        name: f.name,
        maxComplexity: out.maxComplexity,
        ratioPressure: out.ratioPressure,
        maxComplexityPressure: out.maxComplexityPressure,
      },
    }))
  },
}

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({ signalId: "TS-LD-01-cyclomatic-complexity", message: String(cause), cause })
