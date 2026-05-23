import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
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
import { isExcluded } from "./shared-globs.js"

const RsSl04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsSl04Config = typeof RsSl04Config.Type

interface CloneAbuseModule {
  readonly module: string
  readonly file: string
  readonly cloneCalls: number
  readonly likelyExpensiveClones: number
  readonly density: number
}

interface RsSl04Output {
  readonly modules: ReadonlyArray<CloneAbuseModule>
  readonly totalCloneCalls: number
  readonly likelyExpensiveCloneCalls: number
  readonly analysisMode: "syntax-heuristic-clone-scan"
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly analyzedFunctionCount: number
  readonly diagnosticLimit: number
  readonly scoreMode: "likely-expensive-clone-pressure"
  readonly scoreDenominator: "likely-expensive-clone-calls"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_SL_04_SCORE_MODE = "likely-expensive-clone-pressure" as const
const RS_SL_04_SCORE_DENOMINATOR = "likely-expensive-clone-calls" as const

const RsSl04FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
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

export const RsSl04: Signal<RsSl04Config, RsSl04Output, RustProjectTag> = {
  id: "RS-SL-04-clone-abuse",
  title: "Clone abuse",
  aliases: ["RS-SL-04"],
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "likely-expensive-score-cfg-test-gating-diagnostics-denominator-bindings-v5",
  configSchema: RsSl04Config,
  factorDefinitions: RsSl04FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsSl04Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsSl04Output> => {
          const functionCounts = new Map<string, number>()
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )

          const cloneCounts = new Map<string, { file: string; count: number; likelyExpensive: number }>()
          const expensiveBindings = new Map<string, Set<string>>()
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
              if (node.type === "let_declaration") {
                const binding = localCloneBinding(node)
                const functionKey = functionScopeKey(file, ancestors)
                if (binding !== undefined && functionKey !== undefined) {
                  const current = expensiveBindings.get(functionKey) ?? new Set<string>()
                  current.add(binding)
                  expensiveBindings.set(functionKey, current)
                }
                return
              }
              if (node.type !== "call_expression") return
              const fieldExpression = namedChildrenOf(node)[0]
              if (fieldExpression?.type !== "field_expression") return
              const children = namedChildrenOf(fieldExpression)
              const receiver = children[0]?.text ?? ""
              const methodName = children.at(-1)?.text
              if (methodName !== "clone") return
              const current = cloneCounts.get(modulePath) ?? {
                file,
                count: 0,
                likelyExpensive: 0,
              }
              current.count += 1
              const functionKey = functionScopeKey(file, ancestors)
              if (
                classifyClone(receiver) === "likely-expensive" ||
                (functionKey !== undefined && isExpensiveBindingClone(receiver, expensiveBindings.get(functionKey)))
              ) {
                current.likelyExpensive += 1
              }
              cloneCounts.set(modulePath, current)
            })
          }

          const modules = [...cloneCounts.entries()]
            .map(([module, entry]) => ({
              module,
              file: entry.file,
              cloneCalls: entry.count,
              likelyExpensiveClones: entry.likelyExpensive,
              density: entry.count / Math.max(1, functionCounts.get(module) ?? 1),
            }))
            .sort((left, right) => right.density - left.density || left.module.localeCompare(right.module))

          return {
            modules,
            totalCloneCalls: modules.reduce((sum, module) => sum + module.cloneCalls, 0),
            likelyExpensiveCloneCalls: modules.reduce(
              (sum, module) => sum + module.likelyExpensiveClones,
              0,
            ),
            analysisMode: "syntax-heuristic-clone-scan",
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            analyzedFunctionCount: [...functionCounts.values()].reduce((sum, count) => sum + count, 0),
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            scoreMode: RS_SL_04_SCORE_MODE,
            scoreDenominator: RS_SL_04_SCORE_DENOMINATOR,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-04-clone-abuse", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.likelyExpensiveCloneCalls === 0) return 1
    return Math.max(0, 1 - Math.min(0.8, out.likelyExpensiveCloneCalls / 25))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.sourceFileCount === 0
      ? [{
        severity: "warn" as const,
        message: "RS-SL-04 found no Rust source files for clone analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          analyzedFunctionCount: out.analyzedFunctionCount,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
      : out.modules.filter((module) => module.likelyExpensiveClones > 0)
        .slice(0, out.diagnosticLimit)
        .map((module) => ({
          severity: module.likelyExpensiveClones > 0 ? ("warn" as const) : ("info" as const),
          message: `${module.module} contains ${module.cloneCalls} clone() calls`,
          location: { file: module.file },
          data: {
            module: module.module,
            cloneCalls: module.cloneCalls,
            likelyExpensiveClones: module.likelyExpensiveClones,
            density: module.density,
            analysisMode: out.analysisMode,
            scoreMode: out.scoreMode,
            scoreDenominator: out.scoreDenominator,
          },
        })),
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.analyzedFunctionCount === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsSl04FactorLedger(),
}

type NormalizedRsSl04Config = RsSl04Config

const normalizeRsSl04Config = (config: RsSl04Config): NormalizedRsSl04Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsSl04FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-SL-04-clone-abuse",
    RsSl04FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const classifyClone = (receiver: string): "likely-expensive" | "cheap-likely" | "unknown" => {
  const normalized = receiver.trim()
  if (/\b(?:Arc|Rc)\b/.test(normalized)) return "cheap-likely"
  if (/\b(?:String|Vec|HashMap|BTreeMap|HashSet|BTreeSet)\b/.test(normalized)) {
    return "likely-expensive"
  }
  if (normalized.startsWith("vec!") || normalized.includes("to_string") || normalized.includes("format!")) {
    return "likely-expensive"
  }
  return "unknown"
}

const localCloneBinding = (node: RustSyntaxNode): string | undefined => {
  const match = /^\s*let\s+(?:mut\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::\s*([^=;]+))?(?:=\s*([\s\S]*?))?;?\s*$/.exec(node.text)
  if (match === null) return undefined
  const name = match[1]
  const declaredType = match[2] ?? ""
  const initializer = match[3] ?? ""
  const source = `${declaredType} ${initializer}`
  return name !== undefined && classifyClone(source) === "likely-expensive" ? name : undefined
}

const isExpensiveBindingClone = (
  receiver: string,
  bindings: ReadonlySet<string> | undefined,
): boolean => {
  if (bindings === undefined) return false
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(receiver)
  return match?.[1] !== undefined && bindings.has(match[1])
}

const functionScopeKey = (
  file: string,
  ancestors: ReadonlyArray<RustSyntaxNode>,
): string | undefined => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]
    if (ancestor?.type === "function_item") {
      return `${file}:${ancestor.startPosition.row + 1}`
    }
  }
  return undefined
}
