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
import { RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsAb04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
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
  readonly distribution: DistributionalSummary
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly trackedTypeCount: number
  readonly deriveBearingTypeCount: number
  readonly diagnosticLimit: number
  readonly analysisMode: "attribute-attached-derive-count"
}

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

const RsAb04FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
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

export const RsAb04: Signal<RsAb04Config, RsAb04Output, RustProjectTag> = {
  id: "RS-AB-04-derive-density",
  title: "Derive density",
  aliases: ["RS-AB-04"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  cacheVersion: "derive-density-config-applicability-diagnostics-cfg-test-gating-v2",
  configSchema: RsAb04Config,
  factorDefinitions: RsAb04FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
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
            distribution: summarize(entries.map((entry) => entry.deriveCount)),
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            trackedTypeCount: entries.length,
            deriveBearingTypeCount: entries.filter((entry) => entry.deriveCount > 0).length,
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
    const customHeavy = out.types.filter((entry) => entry.customDerives.length >= 2).length
    return Math.max(0, 1 - customHeavy / out.types.length)
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
    return out.types.filter((entry) => entry.deriveCount > 0).slice(0, out.diagnosticLimit).map((entry) => ({
      severity: entry.customDerives.length > 0 ? ("info" as const) : ("warn" as const),
      message: `${entry.name} derives ${entry.deriveCount} macros (${entry.customDerives.length} custom)`,
      location: { file: entry.file, line: entry.line },
      data: {
        module: entry.module,
        deriveCount: entry.deriveCount,
        standardDerives: entry.standardDerives,
        customDerives: entry.customDerives,
        analysisMode: out.analysisMode,
      },
    }))
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.trackedTypeCount === 0 || out.deriveBearingTypeCount === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsAb04FactorLedger(),
}

type NormalizedRsAb04Config = RsAb04Config

const normalizeRsAb04Config = (config: RsAb04Config): NormalizedRsAb04Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsAb04FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-AB-04-derive-density",
    RsAb04FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const extractDerives = (attribute: { readonly text: string }): ReadonlyArray<string> => {
  const match = /#\s*\[\s*derive\s*\(([^\)]*)\)\s*\]/.exec(attribute.text)
  if (match === null) return []
  return match[1]!
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}
