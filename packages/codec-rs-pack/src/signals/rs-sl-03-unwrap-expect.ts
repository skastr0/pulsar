import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
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

export const RsSl03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsSl03Config = typeof RsSl03Config.Type

export interface PanicDensityModule {
  readonly module: string
  readonly file: string
  readonly unwrapExpectCalls: number
  readonly density: number
}

export interface RsSl03Output {
  readonly modules: ReadonlyArray<PanicDensityModule>
  readonly totalCalls: number
  readonly analysisMode: "call-expression-field-scan"
}

export const RsSl03: Signal<RsSl03Config, RsSl03Output, RustProjectTag> = {
  id: "RS-SL-03",
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "advisory-density-scaled-v1",
  configSchema: RsSl03Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsSl03Output> => {
          const facts = await collectRustProjectFacts(project)
          const functionCounts = new Map<string, number>()
          for (const fn of facts.functions) {
            if (isExcluded(fn.file, config.exclude_globs)) continue
            functionCounts.set(fn.modulePath, (functionCounts.get(fn.modulePath) ?? 0) + 1)
          }

          const callCounts = new Map<string, { file: string; count: number }>()
          for (const file of project.sourceFiles) {
            if (isExcluded(file, config.exclude_globs)) continue
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated || node.type !== "call_expression") return
              const fieldExpression = namedChildrenOf(node)[0]
              if (fieldExpression?.type !== "field_expression") return
              const methodName = namedChildrenOf(fieldExpression).at(-1)?.text
              if (methodName !== "unwrap" && methodName !== "expect") return
              const { modulePath } = modulePathForAncestors(scope, ancestors)
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
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-03", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalCalls === 0) return 1
    const riskyModules = out.modules.filter((module) => module.density >= 1).length
    const penalty = riskyModules * 0.05 + out.totalCalls * 0.001
    return Math.max(0, 1 - Math.min(0.5, penalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.modules.slice(0, 10).map((module) => ({
      severity: module.density >= 1 ? ("warn" as const) : ("info" as const),
      message: `${module.module} contains ${module.unwrapExpectCalls} unwrap/expect call sites`,
      location: { file: module.file },
      data: {
        module: module.module,
        unwrapExpectCalls: module.unwrapExpectCalls,
        density: module.density,
        analysisMode: out.analysisMode,
      },
    })),
}
