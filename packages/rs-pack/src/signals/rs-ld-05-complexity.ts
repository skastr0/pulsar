import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
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
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsLd05Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_complexity: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsLd05Config = typeof RsLd05Config.Type

interface RustFunctionComplexity {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly complexity: number
}

interface RsLd05Output {
  readonly functions: ReadonlyArray<RustFunctionComplexity>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThresholdCount: number
  readonly totalFunctions: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly maxComplexity: number
  readonly diagnosticLimit: number
  readonly analysisMode: "standard-cyclomatic"
  readonly scoreMode: "double-weighted-over-threshold-functions"
  readonly scoreDenominator: "analyzed-functions"
  readonly overThresholdFunctionShare: number
  readonly weightedComplexityPressure: number
}

const DEFAULT_MAX_COMPLEXITY = 10
const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_LD_05_SCORE_MODE = "double-weighted-over-threshold-functions" as const
const RS_LD_05_SCORE_DENOMINATOR = "analyzed-functions" as const

const RsLd05FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.max_complexity",
    title: "Config max complexity",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MAX_COMPLEXITY,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd05: Signal<RsLd05Config, RsLd05Output, RustProjectTag> = {
  id: "RS-LD-05-cyclomatic-complexity",
  title: "Cyclomatic complexity",
  aliases: ["RS-LD-05"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "cyclomatic-complexity-config-applicability-diagnostics-cfg-test-v1",
  configSchema: RsLd05Config,
  factorDefinitions: RsLd05FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_complexity: DEFAULT_MAX_COMPLEXITY,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd05Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsLd05Output> => {
          const facts = await collectRustProjectFacts(project)
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          const activeFunctionKeys = await collectActiveFunctionKeys(project, analyzedSourceFiles)
          const functions = facts.functions
            .filter((fn) =>
              !isExcluded(fn.file, normalizedConfig.exclude_globs) &&
              activeFunctionKeys.has(complexityFunctionKey(fn)),
            )
            .map((fn) => ({
              file: fn.file,
              module: fn.modulePath,
              name: fn.name,
              line: fn.line,
              complexity: fn.complexity,
            }))
            .sort((a, b) => b.complexity - a.complexity || a.file.localeCompare(b.file) || a.line - b.line)

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
          const overThresholdCount = functions.filter((fn) => fn.complexity > normalizedConfig.max_complexity).length
          const overThresholdFunctionShare = ratio(overThresholdCount, functions.length)

          return {
            functions,
            byFile,
            overThresholdCount,
            totalFunctions: functions.length,
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            maxComplexity: normalizedConfig.max_complexity,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "standard-cyclomatic",
            scoreMode: RS_LD_05_SCORE_MODE,
            scoreDenominator: RS_LD_05_SCORE_DENOMINATOR,
            overThresholdFunctionShare,
            weightedComplexityPressure: Math.min(1, overThresholdFunctionShare * 2),
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-05-cyclomatic-complexity", message: String(cause), cause }),
      })
    }),
  score: (out) => Math.max(0, 1 - out.weightedComplexityPressure),
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-05 found no Rust source files for cyclomatic complexity analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          totalFunctions: out.totalFunctions,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.functions.slice(0, out.diagnosticLimit).map((fn) => ({
      severity: fn.complexity > out.maxComplexity ? ("warn" as const) : ("info" as const),
      message: `Function ${fn.name} has cyclomatic complexity ${fn.complexity}`,
      location: { file: fn.file, line: fn.line },
      data: {
        ...fn,
        maxComplexity: out.maxComplexity,
        analysisMode: out.analysisMode,
        scoreMode: out.scoreMode,
        scoreDenominator: out.scoreDenominator,
      },
    }))
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.totalFunctions === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsLd05FactorLedger(),
}

type NormalizedRsLd05Config = RsLd05Config

const normalizeRsLd05Config = (config: RsLd05Config): NormalizedRsLd05Config => ({
  exclude_globs: config.exclude_globs,
  max_complexity: Number.isFinite(config.max_complexity)
    ? Math.max(0, Math.floor(config.max_complexity))
    : DEFAULT_MAX_COMPLEXITY,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsLd05FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-LD-05-cyclomatic-complexity",
    RsLd05FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

const collectActiveFunctionKeys = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlySet<string>> => {
  const keys = new Set<string>()
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated || node.type !== "function_item") return
      const name = firstNamedChild(node, "identifier")?.text
      if (name === undefined) return
      const { modulePath } = modulePathForAncestors(scope, ancestors)
      keys.add(complexityFunctionKey({
        file,
        modulePath,
        name,
        line: node.startPosition.row + 1,
      }))
    })
  }
  return keys
}

const complexityFunctionKey = (fn: {
  readonly file: string
  readonly modulePath: string
  readonly name: string
  readonly line: number
}): string => `${fn.file}:${fn.line}:${fn.modulePath}::${fn.name}`
