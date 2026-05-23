import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import { Effect, Schema } from "effect"
import { relative } from "node:path"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  modulePathForAncestors,
  namedChildrenOf,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsDe01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsDe01Config = typeof RsDe01Config.Type

interface TraitCouplingDetail {
  readonly trait: string
  readonly type: string
  readonly file: string
  readonly relativeFile: string
  readonly line: number
  readonly traitLocal: boolean
  readonly typeLocal: boolean
  readonly orphanWorkaroundCandidate: boolean
  readonly family: TraitCouplingFamily
  readonly concerning: boolean
}

type TraitCouplingFamily =
  | "standard-library-ergonomic"
  | "serialization"
  | "framework-adapter"
  | "application-external"

interface TraitCouplingModuleSummary {
  readonly module: string
  readonly file: string
  readonly foreignTraitImpls: number
  readonly concerningForeignTraitImpls: number
  readonly ordinaryForeignTraitImpls: number
  readonly details: ReadonlyArray<TraitCouplingDetail>
}

interface RsDe01Output {
  readonly byModule: ReadonlyMap<
    string,
    {
      readonly foreignTraitImpls: number
      readonly concerningForeignTraitImpls: number
      readonly ordinaryForeignTraitImpls: number
      readonly details: ReadonlyArray<TraitCouplingDetail>
    }
  >
  readonly modules: ReadonlyArray<TraitCouplingModuleSummary>
  readonly sourceFileCount: number
  readonly analyzedFileCount: number
  readonly totalTraitImpls: number
  readonly totalForeignTraitImpls: number
  readonly totalConcerningForeignTraitImpls: number
  readonly diagnosticLimit: number
  readonly analysisMode: "syntax-and-local-name-resolution"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RsDe01FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "metadata",
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

export const RsDe01: Signal<RsDe01Config, RsDe01Output, RustProjectTag> = {
  id: "RS-DE-01-trait-coupling",
  title: "Trait coupling",
  aliases: ["RS-DE-01"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  cacheVersion: "trait-coupling-config-applicability-diagnostics-v1",
  configSchema: RsDe01Config,
  factorDefinitions: RsDe01FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsDe01Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsDe01Output> => {
          const facts = await collectRustProjectFacts(project)
          const localTraitNames = new Map<string, Set<string>>()
          const localTypeNames = new Map<string, Set<string>>()
          const crateRootNames = new Map<string, Set<string>>()

          for (const item of facts.items) {
            const traitBucket = localTraitNames.get(item.crateName) ?? new Set<string>()
            const typeBucket = localTypeNames.get(item.crateName) ?? new Set<string>()
            const rootBucket = crateRootNames.get(item.crateName) ?? new Set<string>()
            if (item.kind === "trait") traitBucket.add(item.name)
            if (["struct", "enum", "type"].includes(item.kind)) typeBucket.add(item.name)
            if (item.relativeModulePath === "crate") rootBucket.add(item.name)
            localTraitNames.set(item.crateName, traitBucket)
            localTypeNames.set(item.crateName, typeBucket)
            crateRootNames.set(item.crateName, rootBucket)
          }
          for (const module of facts.modules) {
            const rootBucket = crateRootNames.get(module.crateName) ?? new Set<string>()
            const segments = module.relativeModulePath.split("::")
            const root = segments[1]
            if (segments[0] === "crate" && root !== undefined) rootBucket.add(root)
            crateRootNames.set(module.crateName, rootBucket)
          }

          const sourceFiles = project.sourceFiles
          const analyzedFiles = sourceFiles.filter((file) =>
            !isExcluded(file, normalizedConfig.exclude_globs)
          )
          let totalTraitImpls = 0
          const grouped = new Map<string, TraitCouplingModuleSummary>()
          for (const file of analyzedFiles) {
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors }) => {
              if (node.type !== "impl_item") return
              const filteredChildren = namedChildrenOf(node).filter(
                (child) =>
                  child.type !== "type_parameters" &&
                  child.type !== "where_clause" &&
                  child.type !== "declaration_list",
              )
              if (filteredChildren.length < 2) return

              const traitNode = filteredChildren[0]
              const typeNode = filteredChildren[1]
              if (traitNode === undefined || typeNode === undefined) return

              totalTraitImpls += 1
              const traitLocal = isLocalPath(
                traitNode,
                scope.crateName,
                localTraitNames.get(scope.crateName) ?? new Set(),
                crateRootNames.get(scope.crateName) ?? new Set(),
              )
              if (traitLocal) return

              const typeLocal = isLocalPath(
                typeNode,
                scope.crateName,
                localTypeNames.get(scope.crateName) ?? new Set(),
                crateRootNames.get(scope.crateName) ?? new Set(),
              )
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              const family = classifyForeignTrait(traitNode.text)
              const detail: TraitCouplingDetail = {
                trait: traitNode.text,
                type: typeNode.text,
                file,
                relativeFile: relative(project.worktreePath, file),
                line: node.startPosition.row + 1,
                traitLocal,
                typeLocal,
                orphanWorkaroundCandidate: !traitLocal && !typeLocal,
                family,
                concerning:
                  family === "application-external" || (!traitLocal && !typeLocal),
              }
              const current = grouped.get(modulePath)
              const nextDetails = sortTraitCouplingDetails([...(current?.details ?? []), detail])
              grouped.set(modulePath, {
                module: modulePath,
                file: current?.file ?? file,
                foreignTraitImpls: nextDetails.length,
                concerningForeignTraitImpls: nextDetails.filter((entry) => entry.concerning).length,
                ordinaryForeignTraitImpls: nextDetails.filter((entry) => !entry.concerning).length,
                details: nextDetails,
              })
            })
          }

          const modules = [...grouped.values()].sort(
            (left, right) =>
              right.concerningForeignTraitImpls - left.concerningForeignTraitImpls ||
              right.foreignTraitImpls - left.foreignTraitImpls ||
              left.module.localeCompare(right.module),
          )
          return {
            byModule: new Map(
              modules.map((module) => [
                module.module,
                {
                  foreignTraitImpls: module.foreignTraitImpls,
                  concerningForeignTraitImpls: module.concerningForeignTraitImpls,
                  ordinaryForeignTraitImpls: module.ordinaryForeignTraitImpls,
                  details: module.details,
                },
              ]),
            ),
            modules,
            sourceFileCount: sourceFiles.length,
            analyzedFileCount: analyzedFiles.length,
            totalTraitImpls,
            totalForeignTraitImpls: modules.reduce(
              (sum, module) => sum + module.foreignTraitImpls,
              0,
            ),
            totalConcerningForeignTraitImpls: modules.reduce(
              (sum, module) => sum + module.concerningForeignTraitImpls,
              0,
            ),
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "syntax-and-local-name-resolution",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-01-trait-coupling", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalConcerningForeignTraitImpls === 0) return 1
    return Math.max(0, 1 - Math.min(1, out.totalConcerningForeignTraitImpls / 2))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-DE-01 found no Rust source files to analyze",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedFileCount: out.analyzedFileCount,
          totalTraitImpls: out.totalTraitImpls,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.modules
      .filter((module) => module.concerningForeignTraitImpls > 0)
      .slice(0, out.diagnosticLimit)
      .map((module) => {
        const concerningDetails = module.details.filter((detail) => detail.concerning)
        const firstConcerning = concerningDetails[0] ?? module.details[0]
        return {
          severity: concerningDetails.some((detail) => detail.orphanWorkaroundCandidate)
            ? ("warn" as const)
            : ("info" as const),
          message: `Module ${module.module} implements ${module.concerningForeignTraitImpls} concerning foreign traits (${module.ordinaryForeignTraitImpls} ordinary)`,
          location: {
            file: firstConcerning?.file ?? module.file,
            ...(firstConcerning === undefined ? {} : { line: firstConcerning.line }),
          },
          data: {
            hash: hashTraitCouplingModule(module),
            module: module.module,
            foreignTraitImpls: module.foreignTraitImpls,
            concerningForeignTraitImpls: module.concerningForeignTraitImpls,
            ordinaryForeignTraitImpls: module.ordinaryForeignTraitImpls,
            orphanWorkaroundCandidates: concerningDetails.filter(
              (detail) => detail.orphanWorkaroundCandidate,
            ).length,
            details: concerningDetails.map((detail) => diagnosticDetail(detail)),
            analysisMode: out.analysisMode,
          },
        }
      })
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedFileCount === 0 || out.totalTraitImpls === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsDe01FactorLedger(),
}

type NormalizedRsDe01Config = RsDe01Config

const normalizeRsDe01Config = (config: RsDe01Config): NormalizedRsDe01Config => ({
  exclude_globs: [...config.exclude_globs],
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsDe01FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-DE-01-trait-coupling",
    RsDe01FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const sortTraitCouplingDetails = (
  details: ReadonlyArray<TraitCouplingDetail>,
): ReadonlyArray<TraitCouplingDetail> =>
  [...details].sort(compareTraitCouplingDetails)

const compareTraitCouplingDetails = (
  left: TraitCouplingDetail,
  right: TraitCouplingDetail,
): number =>
  left.relativeFile.localeCompare(right.relativeFile) ||
  left.line - right.line ||
  left.trait.localeCompare(right.trait) ||
  left.type.localeCompare(right.type)

const diagnosticDetail = (detail: TraitCouplingDetail) => ({
  trait: detail.trait,
  type: detail.type,
  file: detail.file,
  relativeFile: detail.relativeFile,
  line: detail.line,
  family: detail.family,
  traitLocal: detail.traitLocal,
  typeLocal: detail.typeLocal,
  orphanWorkaroundCandidate: detail.orphanWorkaroundCandidate,
})

const hashTraitCouplingModule = (module: TraitCouplingModuleSummary): string =>
  computeDiagnosticHash(
    [
      module.module,
      module.foreignTraitImpls,
      module.concerningForeignTraitImpls,
      module.ordinaryForeignTraitImpls,
      ...sortTraitCouplingDetails(module.details).map((detail) =>
        [
          detail.relativeFile,
          detail.line,
          detail.trait,
          detail.type,
          detail.family,
          detail.concerning,
          detail.orphanWorkaroundCandidate,
        ].join(":"),
      ),
    ].join("|"),
  )

const STANDARD_ERGONOMIC_TRAITS = new Set([
  "AsMut",
  "AsRef",
  "Clone",
  "Copy",
  "Debug",
  "Default",
  "Deref",
  "DerefMut",
  "Display",
  "Drop",
  "Eq",
  "Error",
  "Extend",
  "From",
  "FromIterator",
  "FromStr",
  "Hash",
  "Index",
  "IndexMut",
  "Into",
  "IntoIterator",
  "Iterator",
  "Ord",
  "PartialEq",
  "PartialOrd",
  "ToString",
  "TryFrom",
  "TryInto",
])

const SERIALIZATION_TRAITS = new Set(["Deserialize", "Serialize"])
const FRAMEWORK_ADAPTER_TRAITS = new Set(["IntoResponse"])

const classifyForeignTrait = (traitName: string): TraitCouplingFamily => {
  const segment = finalTraitSegment(traitName)
  if (STANDARD_ERGONOMIC_TRAITS.has(segment)) return "standard-library-ergonomic"
  if (SERIALIZATION_TRAITS.has(segment)) return "serialization"
  if (FRAMEWORK_ADAPTER_TRAITS.has(segment)) return "framework-adapter"
  return "application-external"
}

const finalTraitSegment = (traitName: string): string => {
  const withoutGenerics = traitName.replace(/<.*$/, "")
  return withoutGenerics.split("::").at(-1)?.trim() ?? withoutGenerics.trim()
}

const isLocalPath = (
  node: ReturnType<typeof namedChildrenOf>[number],
  crateName: string,
  localNames: ReadonlySet<string>,
  crateRootNames: ReadonlySet<string>,
): boolean => {
  const root = symbolRoot(node)
  if (root === undefined) return false
  if (["crate", "self", "super", crateName].includes(root)) return true
  return localNames.has(root) || crateRootNames.has(root)
}

const symbolRoot = (node: ReturnType<typeof namedChildrenOf>[number]): string | undefined => {
  switch (node.type) {
    case "identifier":
    case "type_identifier":
    case "primitive_type":
    case "crate":
    case "self":
    case "super":
      return node.text
    case "scoped_identifier":
    case "scoped_type_identifier":
      return namedChildrenOf(node)[0]?.text
    case "generic_type":
    case "reference_type":
    case "pointer_type":
    case "dynamic_type":
    case "bounded_type":
      return symbolRoot(namedChildrenOf(node)[0] ?? node)
    default:
      return firstNamedChild(node, "type_identifier")?.text ?? firstNamedChild(node, "identifier")?.text
  }
}
