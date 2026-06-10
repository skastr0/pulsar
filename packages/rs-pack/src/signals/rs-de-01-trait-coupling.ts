import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
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
import { rustAnalysisOutputMetadata } from "./shared-applicability.js"
import { isExcluded } from "./shared-globs.js"

const RsDe01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  min_trait_impl_evidence: Schema.Number,
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
  | "async-io-ecosystem"
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
  readonly testGatedTraitImpls: number
  readonly totalForeignTraitImpls: number
  readonly totalConcerningForeignTraitImpls: number
  readonly evidenceFloor: number
  readonly diagnosticLimit: number
  readonly analysisMode: "syntax-and-workspace-name-resolution"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const DEFAULT_MIN_TRAIT_IMPL_EVIDENCE = 10

const RS_DE_01_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
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
  {
    path: "config.min_trait_impl_evidence",
    title: "Config min trait impl evidence",
    valueKind: "number",
    scoreRole: "threshold",
    description:
      "Minimum trait-impl evidence used as the score denominator floor; repositories with fewer trait impls than this cannot be zeroed by a handful of flagged impls.",
    defaultValue: DEFAULT_MIN_TRAIT_IMPL_EVIDENCE,
  },
]

export const RsDe01: Signal<RsDe01Config, RsDe01Output, RustProjectTag> = {
  id: "RS-DE-01-trait-coupling",
  title: "Trait coupling",
  aliases: ["RS-DE-01"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  cacheVersion: "trait-coupling-ratio-score-workspace-locality-test-gating-v4-idiomatic-allowlists-inner-attr-gating",
  configSchema: RsDe01Config,
  factorDefinitions: RS_DE_01_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
    min_trait_impl_evidence: DEFAULT_MIN_TRAIT_IMPL_EVIDENCE,
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

          // Traits and types defined anywhere in the workspace are local:
          // implementing a sibling crate's trait is intra-workspace wiring,
          // not foreign-trait coupling.
          const workspaceTraitNames = unionOfSets(localTraitNames.values())
          const workspaceTypeNames = unionOfSets(localTypeNames.values())
          const workspaceCrateTokens = new Set<string>()
          for (const crateName of [
            ...project.manifests
              .map((manifest) => manifest.packageName ?? manifest.name)
              .filter((name): name is string => name !== undefined),
            ...crateRootNames.keys(),
          ]) {
            workspaceCrateTokens.add(crateName)
            workspaceCrateTokens.add(crateName.replace(/-/g, "_"))
          }
          const rootTokensByCrate = new Map<string, ReadonlySet<string>>()
          const rootTokensFor = (crateName: string): ReadonlySet<string> => {
            const cached = rootTokensByCrate.get(crateName)
            if (cached !== undefined) return cached
            const tokens = new Set<string>([
              crateName,
              crateName.replace(/-/g, "_"),
              ...workspaceCrateTokens,
              ...(crateRootNames.get(crateName) ?? []),
            ])
            rootTokensByCrate.set(crateName, tokens)
            return tokens
          }

          const sourceFiles = project.sourceFiles
          const analyzedFiles = sourceFiles.filter((file) =>
            !isExcluded(file, normalizedConfig.exclude_globs)
          )
          let totalTraitImpls = 0
          let testGatedTraitImpls = 0
          const grouped = new Map<string, TraitCouplingModuleSummary>()
          for (const file of analyzedFiles) {
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
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

              if (testGated) {
                // #[cfg(test)] impls are test scaffolding, not production
                // trait coupling; they neither add pressure nor evidence.
                testGatedTraitImpls += 1
                return
              }

              totalTraitImpls += 1
              const rootTokens = rootTokensFor(scope.crateName)
              const traitLocal = isLocalPath(traitNode, workspaceTraitNames, rootTokens)
              if (traitLocal) return

              const typeLocal = isLocalPath(typeNode, workspaceTypeNames, rootTokens)
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
            testGatedTraitImpls,
            totalForeignTraitImpls: modules.reduce(
              (sum, module) => sum + module.foreignTraitImpls,
              0,
            ),
            totalConcerningForeignTraitImpls: modules.reduce(
              (sum, module) => sum + module.concerningForeignTraitImpls,
              0,
            ),
            evidenceFloor: normalizedConfig.min_trait_impl_evidence,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "syntax-and-workspace-name-resolution",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-01-trait-coupling", message: String(cause), cause }),
      })
    }),
  score: (out) => Math.max(0, 1 - scorePenaltyForOutput(out)),
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-DE-01 found no Rust source files to analyze",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedFileCount: out.analyzedFileCount,
          totalTraitImpls: out.totalTraitImpls,
          testGatedTraitImpls: out.testGatedTraitImpls,
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
          message: `Module ${module.module}: ${module.concerningForeignTraitImpls} of ${module.foreignTraitImpls} foreign trait impls flagged (trait family outside the recognized allowlists, or foreign trait implemented for a foreign type)`,
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
            scoring: {
              totalTraitImpls: out.totalTraitImpls,
              testGatedTraitImpls: out.testGatedTraitImpls,
              totalConcerningForeignTraitImpls: out.totalConcerningForeignTraitImpls,
              evidenceFloor: out.evidenceFloor,
              scoreDenominator: scoreDenominatorForOutput(out),
              scorePenalty: scorePenaltyForOutput(out),
            },
            analysisMode: out.analysisMode,
          },
        }
      })
  },
  outputMetadata: (out) =>
    rustAnalysisOutputMetadata({
      sourceFileCount: out.sourceFileCount,
      analyzedItemCount: out.analyzedFileCount,
      evidenceItemCount: out.totalTraitImpls,
    }),
  factorLedger: () => makeRsDe01FactorLedger(),
}

type NormalizedRsDe01Config = RsDe01Config

const normalizeRsDe01Config = (config: RsDe01Config): NormalizedRsDe01Config => ({
  exclude_globs: [...config.exclude_globs],
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
  min_trait_impl_evidence: Number.isFinite(config.min_trait_impl_evidence)
    ? Math.max(1, Math.floor(config.min_trait_impl_evidence))
    : DEFAULT_MIN_TRAIT_IMPL_EVIDENCE,
})

const scoreDenominatorForOutput = (out: RsDe01Output): number =>
  Math.max(out.totalTraitImpls, out.evidenceFloor, 1)

const scorePenaltyForOutput = (out: RsDe01Output): number => {
  if (out.totalConcerningForeignTraitImpls === 0) return 0
  return Math.min(1, out.totalConcerningForeignTraitImpls / scoreDenominatorForOutput(out))
}

const unionOfSets = (sets: Iterable<ReadonlySet<string>>): ReadonlySet<string> => {
  const union = new Set<string>()
  for (const set of sets) for (const value of set) union.add(value)
  return union
}

const makeRsDe01FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-DE-01-trait-coupling", RS_DE_01_FACTOR_DEFINITIONS)

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
  "Borrow",
  "BorrowMut",
  "BufRead",
  "Clone",
  "Copy",
  "Debug",
  "Default",
  "Deref",
  "DerefMut",
  "Display",
  "DoubleEndedIterator",
  "Drop",
  "Eq",
  "Error",
  "ExactSizeIterator",
  "Extend",
  "From",
  "FromIterator",
  "FromStr",
  "FusedIterator",
  "Hash",
  "Index",
  "IndexMut",
  "Into",
  "IntoIterator",
  "Iterator",
  "Ord",
  "PartialEq",
  "PartialOrd",
  "Read",
  "Seek",
  "ToString",
  "TryFrom",
  "TryInto",
  "Write",
  // std::ops operators — math/time/money types implement these by design.
  "Add",
  "AddAssign",
  "BitAnd",
  "BitAndAssign",
  "BitOr",
  "BitOrAssign",
  "BitXor",
  "BitXorAssign",
  "Div",
  "DivAssign",
  "Mul",
  "MulAssign",
  "Neg",
  "Not",
  "Rem",
  "RemAssign",
  "Shl",
  "ShlAssign",
  "Shr",
  "ShrAssign",
  "Sub",
  "SubAssign",
  // Marker traits — `unsafe impl Send/Sync` is a deliberate, reviewed act,
  // not foreign-trait coupling debt.
  "Send",
  "Sync",
  "Unpin",
  // std::fmt beyond Display/Debug.
  "Binary",
  "LowerExp",
  "LowerHex",
  "Octal",
  "Pointer",
  "UpperExp",
  "UpperHex",
  // std::iter aggregation extension points.
  "Product",
  "Sum",
])

// serde's manual-implementation infrastructure: hand-written Deserialize
// impls REQUIRE a Visitor; Serializer/Deserializer and the Serialize*
// helper traits are the canonical extension surface.
const SERIALIZATION_TRAITS = new Set([
  "Deserialize",
  "DeserializeOwned",
  "DeserializeSeed",
  "Deserializer",
  "Serialize",
  "SerializeMap",
  "SerializeSeq",
  "SerializeStruct",
  "SerializeStructVariant",
  "SerializeTuple",
  "SerializeTupleStruct",
  "SerializeTupleVariant",
  "Serializer",
  "Visitor",
])
const FRAMEWORK_ADAPTER_TRAITS = new Set(["IntoResponse"])
// Canonical async/IO ecosystem extension points (futures, tokio, std::future):
// implementing these on local wrappers is idiomatic interop, not coupling debt.
const ASYNC_IO_ECOSYSTEM_TRAITS = new Set([
  "AsyncBufRead",
  "AsyncRead",
  "AsyncSeek",
  "AsyncWrite",
  "FusedFuture",
  "FusedStream",
  "Future",
  "Sink",
  "Stream",
  "TryStream",
])

const classifyForeignTrait = (traitName: string): TraitCouplingFamily => {
  const segment = finalTraitSegment(traitName)
  if (STANDARD_ERGONOMIC_TRAITS.has(segment)) return "standard-library-ergonomic"
  if (SERIALIZATION_TRAITS.has(segment)) return "serialization"
  if (FRAMEWORK_ADAPTER_TRAITS.has(segment)) return "framework-adapter"
  if (ASYNC_IO_ECOSYSTEM_TRAITS.has(segment)) return "async-io-ecosystem"
  return "application-external"
}

const finalTraitSegment = (traitName: string): string => {
  const withoutGenerics = traitName.replace(/<.*$/, "")
  return withoutGenerics.split("::").at(-1)?.trim() ?? withoutGenerics.trim()
}

const isLocalPath = (
  node: ReturnType<typeof namedChildrenOf>[number],
  workspaceNames: ReadonlySet<string>,
  rootTokens: ReadonlySet<string>,
): boolean => {
  const root = symbolRoot(node)
  if (root === undefined) return false
  if (["crate", "self", "super"].includes(root)) return true
  return workspaceNames.has(root) || rootTokens.has(root)
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
    case "scoped_type_identifier": {
      // Recurse: for `crate::module::Trait` the first child is the nested
      // scoped path `crate::module`, whose own root is what locality is
      // judged on. Taking .text here would yield "crate::module" and
      // misclassify every 3+ segment local path as foreign.
      const first = namedChildrenOf(node)[0]
      return first === undefined ? undefined : symbolRoot(first)
    }
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
