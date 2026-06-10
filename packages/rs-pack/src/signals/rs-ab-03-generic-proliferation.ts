import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
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
import { rustAnalysisOutputMetadata } from "./shared-applicability.js"
import { isExcluded } from "./shared-globs.js"

const RsAb03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_generic_complexity: Schema.Number,
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
  readonly complexityDistribution: DistributionalSummary
  readonly parameterDistribution: DistributionalSummary
  readonly overThreshold: ReadonlyArray<RustGenericAnalysis>
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly maxGenericComplexity: number
  readonly maxGenericParameters: number
  readonly diagnosticLimit: number
  readonly analysisMode: "ast-generic-signature-counts"
}

const DEFAULT_MAX_GENERIC_COMPLEXITY = 8
const DEFAULT_MAX_GENERIC_PARAMETERS = 3
const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RS_AB_03_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.max_generic_complexity",
    title: "Config max generic complexity",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MAX_GENERIC_COMPLEXITY,
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
  cacheVersion: "generic-proliferation-config-applicability-diagnostics-cfg-test-gating-bounds-complexity-v5-inner-attr-gating",
  configSchema: RsAb03Config,
  factorDefinitions: RS_AB_03_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_generic_complexity: DEFAULT_MAX_GENERIC_COMPLEXITY,
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
            complexityDistribution: summarize(declarations.map((entry) => entry.complexity)),
            parameterDistribution: summarize(declarations.map((entry) => entry.paramCount)),
            overThreshold: declarations.filter((entry) =>
              exceedsThresholds(entry, normalizedConfig).length > 0,
            ),
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            maxGenericComplexity: normalizedConfig.max_generic_complexity,
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
      message: diagnosticMessage(entry, out),
      location: { file: entry.file, line: entry.line },
      data: {
        module: entry.module,
        paramCount: entry.paramCount,
        whereClausePredicates: entry.whereClausePredicates,
        boundCount: entry.boundCount,
        complexity: entry.complexity,
        maxGenericComplexity: out.maxGenericComplexity,
        maxGenericParameters: out.maxGenericParameters,
        thresholdsExceeded: thresholdsExceeded(entry, out),
        analysisMode: out.analysisMode,
      },
    }))
  },
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.analyzedSourceFileCount,
      evidenceItemCount: out.declarations.length,
    }),
  factorLedger: () => makeRsAb03FactorLedger(),
}

type NormalizedRsAb03Config = RsAb03Config

const normalizeRsAb03Config = (config: RsAb03Config): NormalizedRsAb03Config => ({
  exclude_globs: config.exclude_globs,
  max_generic_complexity: Number.isFinite(config.max_generic_complexity)
    ? Math.max(0, Math.floor(config.max_generic_complexity))
    : DEFAULT_MAX_GENERIC_COMPLEXITY,
  max_generic_parameters: Number.isFinite(config.max_generic_parameters)
    ? Math.max(0, Math.floor(config.max_generic_parameters))
    : DEFAULT_MAX_GENERIC_PARAMETERS,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsAb03FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-AB-03-generic-proliferation", RS_AB_03_FACTOR_DEFINITIONS)

const isGenericTrackedNode = (type: string): boolean =>
  ["function_item", "struct_item", "enum_item", "trait_item", "type_item", "impl_item"].includes(type)

const exceedsThresholds = (
  entry: RustGenericAnalysis,
  config: Pick<NormalizedRsAb03Config, "max_generic_complexity" | "max_generic_parameters">,
): ReadonlyArray<"generic_parameters" | "generic_complexity"> => {
  const exceeded: Array<"generic_parameters" | "generic_complexity"> = []
  if (entry.paramCount > config.max_generic_parameters) exceeded.push("generic_parameters")
  if (entry.complexity > config.max_generic_complexity) exceeded.push("generic_complexity")
  return exceeded
}

const thresholdsExceeded = (
  entry: RustGenericAnalysis,
  out: Pick<RsAb03Output, "maxGenericComplexity" | "maxGenericParameters">,
): ReadonlyArray<"generic_parameters" | "generic_complexity"> =>
  exceedsThresholds(entry, {
    max_generic_complexity: out.maxGenericComplexity,
    max_generic_parameters: out.maxGenericParameters,
  })

const diagnosticMessage = (
  entry: RustGenericAnalysis,
  out: Pick<RsAb03Output, "maxGenericComplexity" | "maxGenericParameters">,
): string => {
  const exceeded = thresholdsExceeded(entry, out)
  if (exceeded.includes("generic_parameters") && exceeded.includes("generic_complexity")) {
    return `${entry.declarationName} uses ${entry.paramCount} generic parameters with generic signature complexity ${entry.complexity}`
  }
  if (exceeded.includes("generic_complexity")) {
    return `${entry.declarationName} has generic signature complexity ${entry.complexity}`
  }
  return `${entry.declarationName} uses ${entry.paramCount} generic parameters`
}

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
