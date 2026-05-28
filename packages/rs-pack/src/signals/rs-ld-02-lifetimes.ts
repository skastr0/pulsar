import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { type RustProject, RustProjectTag } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { rustAnalysisOutputMetadata } from "./shared-applicability.js"
import { isExcluded } from "./shared-globs.js"
import { collectActiveRustFunctionKeys, rustFunctionKey } from "./shared-rust-function-keys.js"

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
  readonly totalAnalyzedFunctions: number
  readonly lifetimeFunctionCount: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly maxLifetimeComplexity: number
  readonly diagnosticLimit: number
  readonly scoreMode: "double-weighted-over-threshold-lifetime-functions"
  readonly scoreDenominator: "lifetime-bearing-functions"
  readonly overThresholdLifetimeShare: number
  readonly weightedLifetimePressure: number
}

const DEFAULT_MAX_LIFETIME_COMPLEXITY = 4
const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_LD_02_SCORE_MODE = "double-weighted-over-threshold-lifetime-functions" as const
const RS_LD_02_SCORE_DENOMINATOR = "lifetime-bearing-functions" as const

const RS_LD_02_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.max_lifetime_complexity",
    title: "Config max lifetime complexity",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MAX_LIFETIME_COMPLEXITY,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd02: Signal<RsLd02Config, RsLd02Output, RustProjectTag> = {
  id: "RS-LD-02-lifetime-complexity",
  title: "Lifetime complexity",
  aliases: ["RS-LD-02"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "lifetime-complexity-config-applicability-diagnostics-cfg-test-score-v3",
  configSchema: RsLd02Config,
  factorDefinitions: RS_LD_02_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_lifetime_complexity: DEFAULT_MAX_LIFETIME_COMPLEXITY,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd02Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd02Output> => {
          const facts = await collectRustProjectFacts(project)
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          const activeFunctionKeys = await collectActiveRustFunctionKeys(project, analyzedSourceFiles)
          const analyzedFunctions = facts.functions.filter(
            (fn) =>
              !isExcluded(fn.file, normalizedConfig.exclude_globs) &&
              activeFunctionKeys.has(rustFunctionKey(fn)),
          )
          const functions = analyzedFunctions
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
          const overThresholdCount = functions.filter(
            (fn) => fn.complexity > normalizedConfig.max_lifetime_complexity,
          ).length
          const overThresholdLifetimeShare = ratio(overThresholdCount, functions.length)

          return {
            functions,
            byFile,
            overThresholdCount,
            totalFunctions: functions.length,
            totalAnalyzedFunctions: analyzedFunctions.length,
            lifetimeFunctionCount: functions.length,
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            maxLifetimeComplexity: normalizedConfig.max_lifetime_complexity,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_LD_02_SCORE_MODE,
            scoreDenominator: RS_LD_02_SCORE_DENOMINATOR,
            overThresholdLifetimeShare,
            weightedLifetimePressure: Math.min(1, overThresholdLifetimeShare * 2),
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-02-lifetime-complexity", message: String(cause), cause }),
      })
    }),
  score: (out) => Math.max(0, 1 - out.weightedLifetimePressure),
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-02 found no Rust source files for lifetime analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          totalAnalyzedFunctions: out.totalAnalyzedFunctions,
          lifetimeFunctionCount: out.lifetimeFunctionCount,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.functions.slice(0, out.diagnosticLimit).map((fn) => ({
      severity: fn.complexity > out.maxLifetimeComplexity ? ("warn" as const) : ("info" as const),
      message: `Lifetime complexity in ${fn.name}: ${fn.complexity} (params:${fn.lifetimeParams}, bounds:${fn.lifetimeBounds}, in:${fn.inputPositions}, out:${fn.outputPositions})`,
      location: { file: fn.file, line: fn.line },
      data: {
        ...fn,
        maxLifetimeComplexity: out.maxLifetimeComplexity,
        scoreMode: out.scoreMode,
        scoreDenominator: out.scoreDenominator,
      },
    }))
  },
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.analyzedSourceFileCount,
      evidenceItemCount: out.lifetimeFunctionCount,
    }),
  factorLedger: () => makeRsLd02FactorLedger(),
}

type NormalizedRsLd02Config = RsLd02Config

const normalizeRsLd02Config = (config: RsLd02Config): NormalizedRsLd02Config => ({
  exclude_globs: config.exclude_globs,
  max_lifetime_complexity: Number.isFinite(config.max_lifetime_complexity)
    ? Math.max(0, Math.floor(config.max_lifetime_complexity))
    : DEFAULT_MAX_LIFETIME_COMPLEXITY,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsLd02FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-LD-02-lifetime-complexity", RS_LD_02_FACTOR_DEFINITIONS)

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator
