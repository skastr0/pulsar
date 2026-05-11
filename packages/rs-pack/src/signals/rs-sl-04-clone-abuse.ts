import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
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

export interface CloneAbuseModule {
  readonly module: string
  readonly file: string
  readonly cloneCalls: number
  readonly likelyExpensiveClones: number
}

export interface RsSl04Output {
  readonly modules: ReadonlyArray<CloneAbuseModule>
  readonly totalCloneCalls: number
  readonly analysisMode: "syntax-heuristic-clone-scan"
}

export const RsSl04: Signal<RsSl04Config, RsSl04Output, RustProjectTag> = {
  id: "RS-SL-04-clone-abuse",
  title: "Clone abuse",
  aliases: ["RS-SL-04"],
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "likely-expensive-score-v1",
  configSchema: RsSl04Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsSl04Output> => {
          const facts = await collectRustProjectFacts(project)
          const functionCounts = new Map<string, number>()
          for (const fn of facts.functions) {
            if (isExcluded(fn.file, config.exclude_globs)) continue
            functionCounts.set(fn.modulePath, (functionCounts.get(fn.modulePath) ?? 0) + 1)
          }

          const cloneCounts = new Map<string, { file: string; count: number; likelyExpensive: number }>()
          for (const file of project.sourceFiles) {
            if (isExcluded(file, config.exclude_globs)) continue
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated || node.type !== "call_expression") return
              const fieldExpression = namedChildrenOf(node)[0]
              if (fieldExpression?.type !== "field_expression") return
              const children = namedChildrenOf(fieldExpression)
              const receiver = children[0]?.text ?? ""
              const methodName = children.at(-1)?.text
              if (methodName !== "clone") return
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              const current = cloneCounts.get(modulePath) ?? {
                file,
                count: 0,
                likelyExpensive: 0,
              }
              current.count += 1
              if (classifyClone(receiver) === "likely-expensive") {
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
            .map(({ density, ...rest }) => rest)

          return {
            modules,
            totalCloneCalls: modules.reduce((sum, module) => sum + module.cloneCalls, 0),
            analysisMode: "syntax-heuristic-clone-scan",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-04-clone-abuse", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const likelyExpensiveClones = out.modules.reduce(
      (sum, module) => sum + module.likelyExpensiveClones,
      0,
    )
    if (likelyExpensiveClones === 0) return 1
    return Math.max(0, 1 - Math.min(0.8, likelyExpensiveClones / 25))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.modules.filter((module) => module.likelyExpensiveClones > 0).slice(0, 10).map((module) => ({
      severity: module.likelyExpensiveClones > 0 ? ("warn" as const) : ("info" as const),
      message: `${module.module} contains ${module.cloneCalls} clone() calls`,
      location: { file: module.file },
      data: {
        module: module.module,
        cloneCalls: module.cloneCalls,
        likelyExpensiveClones: module.likelyExpensiveClones,
        analysisMode: out.analysisMode,
      },
    })),
}

const classifyClone = (receiver: string): "likely-expensive" | "cheap-likely" | "unknown" => {
  if (/\b(?:Arc|Rc)\b/.test(receiver)) return "cheap-likely"
  if (/\b(?:String|Vec|HashMap|BTreeMap|HashSet|BTreeSet)\b/.test(receiver)) {
    return "likely-expensive"
  }
  if (receiver.startsWith("vec!") || receiver.includes("to_string") || receiver.includes("format!")) {
    return "likely-expensive"
  }
  return "unknown"
}
