import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
import { parseRustFile, type RustSyntaxNode } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  modulePathForAncestors,
  namedChildrenOf,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { rustAnalyzedFunctionOutputMetadata } from "./shared-applicability.js"
import { isExcluded } from "./shared-globs.js"

const RsSl03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsSl03Config = typeof RsSl03Config.Type

interface PanicDensityModule {
  readonly module: string
  readonly file: string
  readonly unwrapExpectCalls: number
  readonly density: number
}

interface RsSl03Output {
  readonly modules: ReadonlyArray<PanicDensityModule>
  readonly totalCalls: number
  readonly analysisMode: "call-expression-field-scan"
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly analyzedFunctionCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "bounded-unwrap-expect-density"
  readonly scoreDenominator: "analyzed-functions-per-module"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_SL_03_SCORE_MODE = "bounded-unwrap-expect-density" as const
const RS_SL_03_SCORE_DENOMINATOR = "analyzed-functions-per-module" as const

const RS_SL_03_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsSl03: Signal<RsSl03Config, RsSl03Output, RustProjectTag> = {
  id: "RS-SL-03-unwrap-expect",
  title: "Unwrap/expect usage",
  aliases: ["RS-SL-03"],
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "advisory-density-scaled-cfg-test-gating-diagnostics-denominator-ufcs-cfg-predicate-v7-inner-attr-gating",
  configSchema: RsSl03Config,
  factorDefinitions: RS_SL_03_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsSl03Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsSl03Output> => {
          const functionCounts = new Map<string, number>()
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )

          const callCounts = new Map<string, { file: string; count: number }>()
          for (const file of analyzedSourceFiles) {
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated) return
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              if (node.type === "function_item") {
                functionCounts.set(modulePath, (functionCounts.get(modulePath) ?? 0) + 1)
                return
              }
              if (node.type !== "call_expression") return
              const callName = unwrapExpectCallName(node)
              if (callName === undefined) return
              const current = callCounts.get(modulePath) ?? { file, count: 0 }
              current.count += 1
              callCounts.set(modulePath, current)
            })
          }

          const modules = [...callCounts.entries()]
            .map(([module, entry]) => ({
              module,
              file: entry.file,
              unwrapExpectCalls: entry.count,
              density: entry.count / Math.max(1, functionCounts.get(module) ?? 1),
            }))
            .sort((left, right) => right.density - left.density || left.module.localeCompare(right.module))

          return {
            modules,
            totalCalls: modules.reduce((sum, module) => sum + module.unwrapExpectCalls, 0),
            analysisMode: "call-expression-field-scan",
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            analyzedFunctionCount: [...functionCounts.values()].reduce((sum, count) => sum + count, 0),
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_SL_03_SCORE_MODE,
            scoreDenominator: RS_SL_03_SCORE_DENOMINATOR,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-03-unwrap-expect", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalCalls === 0) return 1
    const riskyModules = out.modules.filter((module) => module.density >= 1).length
    const penalty = riskyModules * 0.05 + out.totalCalls * 0.001
    return Math.max(0, 1 - Math.min(0.5, penalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.sourceFileCount === 0
      ? [{
        severity: "warn" as const,
        message: "RS-SL-03 found no Rust source files for unwrap/expect analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          analyzedFunctionCount: out.analyzedFunctionCount,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
      : out.modules.slice(0, out.diagnosticLimit).map((module) => ({
        severity: module.density >= 1 ? ("warn" as const) : ("info" as const),
        message: `${module.module} contains ${module.unwrapExpectCalls} unwrap/expect call sites`,
        location: { file: module.file },
        data: {
          module: module.module,
          unwrapExpectCalls: module.unwrapExpectCalls,
          density: module.density,
          analysisMode: out.analysisMode,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      })),
  outputMetadata: rustAnalyzedFunctionOutputMetadata,
  factorLedger: () => makeRsSl03FactorLedger(),
}

type NormalizedRsSl03Config = RsSl03Config

const normalizeRsSl03Config = (config: RsSl03Config): NormalizedRsSl03Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsSl03FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-SL-03-unwrap-expect", RS_SL_03_FACTOR_DEFINITIONS)

const unwrapExpectCallName = (node: RustSyntaxNode): "unwrap" | "expect" | undefined => {
  const callee = namedChildrenOf(node)[0]
  if (callee === undefined) return undefined
  if (callee.type === "field_expression") {
    return unwrapExpectName(namedChildrenOf(callee).at(-1)?.text)
  }
  if (callee.type === "scoped_identifier" || callee.type === "generic_function") {
    return unwrapExpectName(callee.text.split("::").at(-1))
  }
  return undefined
}

const unwrapExpectName = (name: string | undefined): "unwrap" | "expect" | undefined =>
  name === "unwrap" || name === "expect" ? name : undefined
