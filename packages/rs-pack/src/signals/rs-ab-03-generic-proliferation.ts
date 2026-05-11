import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  allNamedChildren,
  firstNamedChild,
  modulePathForAncestors,
  namedChildrenOf,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsAb03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_generic_parameters: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsAb03Config = typeof RsAb03Config.Type

interface RustGenericAnalysis {
  readonly file: string
  readonly module: string
  readonly declarationName: string
  readonly line: number
  readonly paramCount: number
  readonly whereClausePredicates: number
  readonly boundCount: number
  readonly complexity: number
}

interface RsAb03Output {
  readonly declarations: ReadonlyArray<RustGenericAnalysis>
  readonly parameterDistribution: DistributionalSummary
  readonly overThreshold: ReadonlyArray<RustGenericAnalysis>
  readonly analysisMode: "ast-parameter-and-where-clause-counts"
}

export const RsAb03: Signal<RsAb03Config, RsAb03Output, RustProjectTag> = {
  id: "RS-AB-03-generic-proliferation",
  title: "Generic proliferation",
  aliases: ["RS-AB-03"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: RsAb03Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_generic_parameters: 3,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAb03Output> => {
          const declarations: Array<RustGenericAnalysis> = []
          for (const file of project.sourceFiles) {
            if (isExcluded(file, config.exclude_globs)) continue
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated || !isGenericTrackedNode(node.type)) return
              const typeParameters = firstNamedChild(node, "type_parameters")
              const whereClause = firstNamedChild(node, "where_clause")
              const paramCount = namedChildrenOf(typeParameters ?? node).filter((child) =>
                ["type_parameter", "lifetime_parameter", "const_parameter"].includes(child.type),
              ).length
              if (paramCount === 0) return
              const whereClausePredicates = namedChildrenOf(whereClause ?? node).length
              const boundCount = countNamedDescendants(typeParameters, "trait_bounds") + countNamedDescendants(whereClause, "trait_bounds")
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              declarations.push({
                file,
                module: modulePath,
                declarationName: declarationName(node),
                line: node.startPosition.row + 1,
                paramCount,
                whereClausePredicates,
                boundCount,
                complexity: paramCount + whereClausePredicates + boundCount,
              })
            })
          }

          declarations.sort((left, right) => right.paramCount - left.paramCount || left.file.localeCompare(right.file))
          return {
            declarations,
            parameterDistribution: summarize(declarations.map((entry) => entry.paramCount)),
            overThreshold: declarations.filter((entry) => entry.paramCount > config.max_generic_parameters),
            analysisMode: "ast-parameter-and-where-clause-counts",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-03-generic-proliferation", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.declarations.length === 0) return 1
    return Math.max(0, 1 - out.overThreshold.length / out.declarations.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, 10).map((entry) => ({
      severity: "warn" as const,
      message: `${entry.declarationName} uses ${entry.paramCount} generic parameters`,
      location: { file: entry.file, line: entry.line },
      data: {
        module: entry.module,
        paramCount: entry.paramCount,
        whereClausePredicates: entry.whereClausePredicates,
        boundCount: entry.boundCount,
        complexity: entry.complexity,
        analysisMode: out.analysisMode,
      },
    })),
}

const isGenericTrackedNode = (type: string): boolean =>
  ["function_item", "struct_item", "enum_item", "trait_item", "type_item", "impl_item"].includes(type)

const declarationName = (node: ReturnType<typeof namedChildrenOf>[number]): string => {
  if (node.type === "impl_item") {
    const target = namedChildrenOf(node).find(
      (child) => child.type !== "type_parameters" && child.type !== "where_clause" && child.type !== "declaration_list",
    )
    return `impl ${target?.text ?? "<unknown>"}`
  }
  return firstNamedChild(node, "identifier")?.text ?? firstNamedChild(node, "type_identifier")?.text ?? "<anonymous>"
}

const countNamedDescendants = (
  node: ReturnType<typeof namedChildrenOf>[number] | undefined,
  type: string,
): number => {
  if (node === undefined) return 0
  let count = 0
  const walk = (current: ReturnType<typeof namedChildrenOf>[number]): void => {
    if (current.type === type) count += 1
    for (const child of namedChildrenOf(current)) walk(child)
  }
  walk(node)
  return count
}
