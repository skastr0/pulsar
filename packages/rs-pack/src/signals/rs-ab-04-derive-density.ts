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

const RsAb04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_custom_derives: Schema.Number,
  max_derive_count: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsAb04Config = typeof RsAb04Config.Type

interface DeriveDensityEntry {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly deriveCount: number
  readonly standardDerives: ReadonlyArray<string>
  readonly customDerives: ReadonlyArray<string>
}

interface RsAb04Output {
  readonly types: ReadonlyArray<DeriveDensityEntry>
  readonly overThreshold: ReadonlyArray<DeriveDensityEntry>
  readonly distribution: DistributionalSummary
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly trackedTypeCount: number
  readonly deriveBearingTypeCount: number
  readonly maxCustomDerives: number
  readonly maxDeriveCount: number
  readonly diagnosticLimit: number
  readonly analysisMode: "attribute-attached-derive-count"
}

const DEFAULT_MAX_CUSTOM_DERIVES = 1
const DEFAULT_MAX_DERIVE_COUNT = 4
const DEFAULT_TOP_N_DIAGNOSTICS = 10

const STANDARD_DERIVES = new Set([
  "Clone",
  "Copy",
  "Debug",
  "Default",
  "Eq",
  "PartialEq",
  "Ord",
  "PartialOrd",
  "Hash",
])

const RS_AB_04_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.max_custom_derives",
    title: "Config max custom derives",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MAX_CUSTOM_DERIVES,
  },
  {
    path: "config.max_derive_count",
    title: "Config max derive count",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MAX_DERIVE_COUNT,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsAb04: Signal<RsAb04Config, RsAb04Output, RustProjectTag> = {
  id: "RS-AB-04-derive-density",
  title: "Derive density",
  aliases: ["RS-AB-04"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  cacheVersion: "derive-density-config-applicability-diagnostics-cfg-attr-thresholds-v4",
  configSchema: RsAb04Config,
  factorDefinitions: RS_AB_04_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    max_custom_derives: DEFAULT_MAX_CUSTOM_DERIVES,
    max_derive_count: DEFAULT_MAX_DERIVE_COUNT,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsAb04Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAb04Output> => {
          const entries: Array<DeriveDensityEntry> = []
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          for (const file of analyzedSourceFiles) {
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, attachedAttributes, testGated }) => {
              if (testGated || !["struct_item", "enum_item", "union_item"].includes(node.type)) return
              const derives = attachedAttributes.flatMap(extractDerives)
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              entries.push({
                file,
                module: modulePath,
                name: firstNamedChild(node, "type_identifier")?.text ?? "<anonymous>",
                line: node.startPosition.row + 1,
                deriveCount: derives.length,
                standardDerives: derives.filter((derive) => STANDARD_DERIVES.has(derive)),
                customDerives: derives.filter((derive) => !STANDARD_DERIVES.has(derive)),
              })
            })
          }

          entries.sort((left, right) => right.deriveCount - left.deriveCount || left.file.localeCompare(right.file))
          return {
            types: entries,
            overThreshold: entries.filter((entry) =>
              exceedsThresholds(entry, normalizedConfig).length > 0,
            ),
            distribution: summarize(entries.map((entry) => entry.deriveCount)),
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            trackedTypeCount: entries.length,
            deriveBearingTypeCount: entries.filter((entry) => entry.deriveCount > 0).length,
            maxCustomDerives: normalizedConfig.max_custom_derives,
            maxDeriveCount: normalizedConfig.max_derive_count,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "attribute-attached-derive-count",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-04-derive-density", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.types.length === 0) return 1
    return Math.max(0, 1 - out.overThreshold.length / out.types.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-AB-04 found no Rust source files for derive density analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          trackedTypeCount: out.trackedTypeCount,
          deriveBearingTypeCount: out.deriveBearingTypeCount,
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
        deriveCount: entry.deriveCount,
        standardDerives: entry.standardDerives,
        customDerives: entry.customDerives,
        maxCustomDerives: out.maxCustomDerives,
        maxDeriveCount: out.maxDeriveCount,
        thresholdsExceeded: thresholdsExceeded(entry, out),
        analysisMode: out.analysisMode,
      },
    }))
  },
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.analyzedSourceFileCount,
      evidenceItemCount: Math.min(out.trackedTypeCount, out.deriveBearingTypeCount),
    }),
  factorLedger: () => makeRsAb04FactorLedger(),
}

type NormalizedRsAb04Config = RsAb04Config

const normalizeRsAb04Config = (config: RsAb04Config): NormalizedRsAb04Config => ({
  exclude_globs: config.exclude_globs,
  max_custom_derives: Number.isFinite(config.max_custom_derives)
    ? Math.max(0, Math.floor(config.max_custom_derives))
    : DEFAULT_MAX_CUSTOM_DERIVES,
  max_derive_count: Number.isFinite(config.max_derive_count)
    ? Math.max(0, Math.floor(config.max_derive_count))
    : DEFAULT_MAX_DERIVE_COUNT,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsAb04FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-AB-04-derive-density", RS_AB_04_FACTOR_DEFINITIONS)

const exceedsThresholds = (
  entry: DeriveDensityEntry,
  config: Pick<NormalizedRsAb04Config, "max_custom_derives" | "max_derive_count">,
): ReadonlyArray<"derive_count" | "custom_derives"> => {
  const exceeded: Array<"derive_count" | "custom_derives"> = []
  if (entry.deriveCount > config.max_derive_count) exceeded.push("derive_count")
  if (entry.customDerives.length > config.max_custom_derives) exceeded.push("custom_derives")
  return exceeded
}

const thresholdsExceeded = (
  entry: DeriveDensityEntry,
  out: Pick<RsAb04Output, "maxCustomDerives" | "maxDeriveCount">,
): ReadonlyArray<"derive_count" | "custom_derives"> =>
  exceedsThresholds(entry, {
    max_custom_derives: out.maxCustomDerives,
    max_derive_count: out.maxDeriveCount,
  })

const diagnosticMessage = (
  entry: DeriveDensityEntry,
  out: Pick<RsAb04Output, "maxCustomDerives" | "maxDeriveCount">,
): string => {
  const exceeded = thresholdsExceeded(entry, out)
  if (exceeded.includes("derive_count") && exceeded.includes("custom_derives")) {
    return `${entry.name} derives ${entry.deriveCount} macros with ${entry.customDerives.length} custom`
  }
  if (exceeded.includes("custom_derives")) {
    return `${entry.name} derives ${entry.customDerives.length} custom macros`
  }
  return `${entry.name} derives ${entry.deriveCount} macros`
}

const extractDerives = (attributeItem: RustSyntaxNode): ReadonlyArray<string> => {
  const attribute = firstNamedChild(attributeItem, "attribute") ?? attributeItem
  const children = namedChildrenOf(attribute)
  const attributeName = children.find((child) => child.type === "identifier")?.text
  const tokenTree = children.find((child) => child.type === "token_tree")
  if (attributeName === "derive") return deriveNamesFromTokenTree(tokenTree)
  if (attributeName === "cfg_attr") return deriveNamesFromCfgAttr(tokenTree)
  return []
}

const deriveNamesFromCfgAttr = (tokenTree: RustSyntaxNode | undefined): ReadonlyArray<string> => {
  if (tokenTree === undefined) return []
  const parts = splitTopLevelCommas(unwrapOuterParens(tokenTree.text))
  const cfgExpression = parts[0]
  if (cfgExpression === undefined || isCfgTestExpression(cfgExpression)) return []
  return parts.slice(1).flatMap(deriveNamesFromAttributeText)
}

const deriveNamesFromTokenTree = (tokenTree: RustSyntaxNode | undefined): ReadonlyArray<string> =>
  tokenTree === undefined ? [] : splitTopLevelCommas(unwrapOuterParens(tokenTree.text))

const deriveNamesFromAttributeText = (attributeText: string): ReadonlyArray<string> => {
  const match = /^derive\s*\((.*)\)$/s.exec(attributeText.trim())
  if (match === null) return []
  return splitTopLevelCommas(match[1] ?? "")
}

const unwrapOuterParens = (value: string): string => {
  const trimmed = value.trim()
  return trimmed.startsWith("(") && trimmed.endsWith(")") ? trimmed.slice(1, -1) : trimmed
}

const splitTopLevelCommas = (value: string): ReadonlyArray<string> => {
  const parts: Array<string> = []
  let depth = 0
  let start = 0
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char === "(" || char === "[" || char === "{") depth += 1
    if (char === ")" || char === "]" || char === "}") depth = Math.max(0, depth - 1)
    if (char === "," && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter((part) => part.length > 0)
}

const isCfgTestExpression = (value: string): boolean => {
  const cfgExpression = value.replace(/\s+/g, "")
  const withoutNotTest = cfgExpression.replace(/not\(test\)/g, "")
  return /(^|[^A-Za-z0-9_])test([^A-Za-z0-9_]|$)/.test(withoutNotTest)
}
