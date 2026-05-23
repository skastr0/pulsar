import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import {
  type Diagnostic,
  type DistributionalSummary,
  scoreThresholdViolationShare,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
import { parseRustFile, type RustSyntaxNode } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
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
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly maxGenericParameters: number
  readonly diagnosticLimit: number
  readonly analysisMode: "ast-generic-signature-counts"
}

const DEFAULT_MAX_GENERIC_PARAMETERS = 3
const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RsAb03FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.max_generic_parameters",
    title: "Config max generic parameters",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MAX_GENERIC_PARAMETERS,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsAb03: Signal<RsAb03Config, RsAb03Output, RustProjectTag> = {
  id: "RS-AB-03-generic-proliferation",
  title: "Generic proliferation",
  aliases: ["RS-AB-03"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  cacheVersion: "generic-proliferation-config-applicability-diagnostics-cfg-test-gating-bounds-v3",
  configSchema: RsAb03Config,
  factorDefinitions: RsAb03FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_generic_parameters: DEFAULT_MAX_GENERIC_PARAMETERS,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsAb03Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAb03Output> => {
          const declarations: Array<RustGenericAnalysis> = []
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          for (const file of analyzedSourceFiles) {
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
              const whereClausePredicates = whereClause === undefined ? 0 : namedChildrenOf(whereClause).length
              const boundCount = countSignatureBounds(node, typeParameters, whereClause)
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
            overThreshold: declarations.filter((entry) => entry.paramCount > normalizedConfig.max_generic_parameters),
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            maxGenericParameters: normalizedConfig.max_generic_parameters,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "ast-generic-signature-counts",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-03-generic-proliferation", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    return scoreThresholdViolationShare(out.declarations.length, out.overThreshold.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-AB-03 found no Rust source files for generic proliferation analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          declarationCount: out.declarations.length,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.overThreshold.slice(0, out.diagnosticLimit).map((entry) => ({
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
    }))
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.declarations.length === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsAb03FactorLedger(),
}

type NormalizedRsAb03Config = RsAb03Config

const normalizeRsAb03Config = (config: RsAb03Config): NormalizedRsAb03Config => ({
  exclude_globs: config.exclude_globs,
  max_generic_parameters: Number.isFinite(config.max_generic_parameters)
    ? Math.max(0, Math.floor(config.max_generic_parameters))
    : DEFAULT_MAX_GENERIC_PARAMETERS,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsAb03FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-AB-03-generic-proliferation",
    RsAb03FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const isGenericTrackedNode = (type: string): boolean =>
  ["function_item", "struct_item", "enum_item", "trait_item", "type_item", "impl_item"].includes(type)

const declarationName = (node: RustSyntaxNode): string => {
  if (node.type === "impl_item") {
    const target = namedChildrenOf(node).find(
      (child) => child.type !== "type_parameters" && child.type !== "where_clause" && child.type !== "declaration_list",
    )
    return `impl ${target?.text ?? "<unknown>"}`
  }
  return firstNamedChild(node, "identifier")?.text ?? firstNamedChild(node, "type_identifier")?.text ?? "<anonymous>"
}

const countSignatureBounds = (
  declaration: RustSyntaxNode,
  typeParameters: RustSyntaxNode | undefined,
  whereClause: RustSyntaxNode | undefined,
): number =>
  countBoundsIn(typeParameters) +
  countBoundsIn(whereClause) +
  namedChildrenOf(declaration)
    .filter((child) => child.type === "trait_bounds")
    .reduce((sum, bounds) => sum + countBoundItems(bounds), 0)

const countBoundsIn = (node: RustSyntaxNode | undefined): number => {
  if (node === undefined) return 0
  let count = 0
  const walk = (current: RustSyntaxNode): void => {
    if (current.type === "trait_bounds") {
      count += countBoundItems(current)
    }
    for (const child of namedChildrenOf(current)) walk(child)
  }
  walk(node)
  return count
}

const countBoundItems = (bounds: RustSyntaxNode): number => namedChildrenOf(bounds).length
