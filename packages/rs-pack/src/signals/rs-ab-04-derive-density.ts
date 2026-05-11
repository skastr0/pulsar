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

export interface DeriveDensityEntry {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly deriveCount: number
  readonly standardDerives: ReadonlyArray<string>
  readonly customDerives: ReadonlyArray<string>
}

export interface RsAb04Output {
  readonly types: ReadonlyArray<DeriveDensityEntry>
  readonly distribution: DistributionalSummary
  readonly analysisMode: "attribute-attached-derive-count"
}

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

export const RsAb04: Signal<RsAb04Config, RsAb04Output, RustProjectTag> = {
  id: "RS-AB-04-derive-density",
  title: "Derive density",
  aliases: ["RS-AB-04"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: RsAb04Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAb04Output> => {
          const entries: Array<DeriveDensityEntry> = []
          for (const file of project.sourceFiles) {
            if (isExcluded(file, config.exclude_globs)) continue
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, attachedAttributes, testGated }) => {
              if (testGated || !["struct_item", "enum_item", "union_item"].includes(node.type)) return
              const derives = attachedAttributes.flatMap(extractDerives)
              if (derives.length === 0) return
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
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.types.slice(0, 10).map((entry) => ({
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
    })),
}

const extractDerives = (attribute: { readonly text: string }): ReadonlyArray<string> => {
  const match = /#\s*\[\s*derive\s*\(([^\)]*)\)\s*\]/.exec(attribute.text)
  if (match === null) return []
  return match[1]!
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}
