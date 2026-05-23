import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import { Effect, Schema } from "effect"
import { RustProjectTag } from "../project.js"
import { parseRustFile } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  lineRangeOverlapsChangedHunks,
  modulePathForAncestors,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsSl01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  min_tokens: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsSl01Config = typeof RsSl01Config.Type

interface DuplicateGroupMember {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
  readonly changed: boolean
}

interface DuplicateGroup {
  readonly kind: "exact" | "structural"
  readonly tokenCount: number
  readonly members: ReadonlyArray<DuplicateGroupMember>
}

interface RsSl01Output {
  readonly groups: ReadonlyArray<DuplicateGroup>
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly analysisMode: "function-body-normalization"
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly analyzedFunctionCount: number
  readonly exactGroupCount: number
  readonly structuralGroupCount: number
  readonly duplicateGroupCount: number
  readonly diagnosticLimit: number
  readonly minTokens: number
  readonly scoreMode: "bounded-duplicate-function-pressure"
  readonly scoreDenominator: "analyzed-functions"
}

const DEFAULT_MIN_TOKENS = 12
const DEFAULT_TOP_N_DIAGNOSTICS = 10
const RS_SL_01_SCORE_MODE = "bounded-duplicate-function-pressure" as const
const RS_SL_01_SCORE_DENOMINATOR = "analyzed-functions" as const

const RsSl01FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.min_tokens",
    title: "Config min tokens",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_MIN_TOKENS,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsSl01: Signal<RsSl01Config, RsSl01Output, RustProjectTag | SignalContextTag> = {
  id: "RS-SL-01-duplication",
  title: "Duplication",
  aliases: ["RS-SL-01"],
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "advisory-rust-duplication-cfg-test-diagnostics-changed-hunks-v4",
  configSchema: RsSl01Config,
  factorDefinitions: RsSl01FactorDefinitions,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    min_tokens: DEFAULT_MIN_TOKENS,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsSl01Config(config)
      const project = yield* RustProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsSl01Output> => {
          const functions: Array<{
            exact: string
            structural: string
            tokenCount: number
            member: DuplicateGroupMember
          }> = []

          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )

          for (const file of analyzedSourceFiles) {
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated || node.type !== "function_item") return
              const startLine = node.startPosition.row + 1
              const endLine = node.endPosition.row + 1
              const changed = lineRangeOverlapsChangedHunks(
                file,
                startLine,
                endLine,
                context.worktreePath,
                context.changedHunks,
              )

              const structuralTokens = tokenizeStructural(node.text)
              if (structuralTokens.length < normalizedConfig.min_tokens) return
              const { modulePath } = modulePathForAncestors(scope, ancestors)
              functions.push({
                exact: normalizeExact(node.text),
                structural: structuralTokens.join(" "),
                tokenCount: structuralTokens.length,
                member: {
                  file,
                  module: modulePath,
                  name: firstNamedChild(node, "identifier")?.text ?? "<anonymous>",
                  line: startLine,
                  changed,
                },
              })
            })
          }

          const exactGroups = filterGroupsForScope(
            buildGroups(functions, "exact"),
            context.changedHunks.length > 0,
          )
          const structuralGroups = filterGroupsForScope(buildGroups(functions, "structural"), context.changedHunks.length > 0).filter((group) => {
            const exactVariants = new Set(
              group.members.map((member) =>
                functions.find(
                  (fn) => fn.member.file === member.file && fn.member.line === member.line,
                )?.exact,
              ),
            )
            return exactVariants.size > 1
          })
          const groups = [...exactGroups, ...structuralGroups].sort(
            (left, right) => right.members.length - left.members.length || right.tokenCount - left.tokenCount,
          )

          return {
            groups,
            scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
            analysisMode: "function-body-normalization",
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            analyzedFunctionCount: functions.length,
            exactGroupCount: exactGroups.length,
            structuralGroupCount: structuralGroups.length,
            duplicateGroupCount: groups.length,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            minTokens: normalizedConfig.min_tokens,
            scoreMode: RS_SL_01_SCORE_MODE,
            scoreDenominator: RS_SL_01_SCORE_DENOMINATOR,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-01-duplication", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const exactDuplicateMembers = out.groups
      .filter((group) => group.kind === "exact" && group.tokenCount >= 30)
      .reduce((sum, group) => sum + group.members.length, 0)
    const structuralGroupCount = out.groups.filter((group) => group.kind === "structural").length
    if (exactDuplicateMembers === 0 && structuralGroupCount === 0) return 1
    const exactPenalty = Math.min(0.35, exactDuplicateMembers / 200)
    const structuralPenalty = Math.min(0.15, structuralGroupCount / 250)
    return Math.max(0, 1 - Math.min(0.5, exactPenalty + structuralPenalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.sourceFileCount === 0
      ? [{
        severity: "warn" as const,
        message: "RS-SL-01 found no Rust source files for duplication analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          analyzedFunctionCount: out.analyzedFunctionCount,
          scoreMode: out.scoreMode,
          scoreDenominator: out.scoreDenominator,
        },
      }].slice(0, out.diagnosticLimit)
      : out.groups.slice(0, out.diagnosticLimit).map((group) => ({
      severity: group.kind === "exact" ? ("warn" as const) : ("info" as const),
      message: `${group.kind} duplicate group with ${group.members.length} functions`,
      location: {
        file: group.members[0]?.file ?? "unknown.rs",
        line: group.members[0]?.line,
      },
      data: {
        kind: group.kind,
        tokenCount: group.tokenCount,
        members: group.members,
        scopeMode: out.scopeMode,
        analysisMode: out.analysisMode,
        minTokens: out.minTokens,
        scoreMode: out.scoreMode,
        scoreDenominator: out.scoreDenominator,
      },
    })),
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.analyzedFunctionCount === 0) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsSl01FactorLedger(),
}

type NormalizedRsSl01Config = RsSl01Config

const normalizeRsSl01Config = (config: RsSl01Config): NormalizedRsSl01Config => ({
  exclude_globs: config.exclude_globs,
  min_tokens: Number.isFinite(config.min_tokens)
    ? Math.max(0, Math.floor(config.min_tokens))
    : DEFAULT_MIN_TOKENS,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsSl01FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-SL-01-duplication",
    RsSl01FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

const buildGroups = (
  functions: ReadonlyArray<{
    exact: string
    structural: string
    tokenCount: number
    member: DuplicateGroupMember
  }>,
  kind: "exact" | "structural",
): ReadonlyArray<DuplicateGroup> => {
  const grouped = new Map<string, Array<typeof functions[number]>>()
  for (const fn of functions) {
    const key = kind === "exact" ? fn.exact : fn.structural
    const bucket = grouped.get(key) ?? []
    bucket.push(fn)
    grouped.set(key, bucket)
  }
  return [...grouped.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      kind,
      tokenCount: group[0]?.tokenCount ?? 0,
      members: group.map((entry) => entry.member),
    }))
}

const filterGroupsForScope = (
  groups: ReadonlyArray<DuplicateGroup>,
  changedHunksOnly: boolean,
): ReadonlyArray<DuplicateGroup> =>
  changedHunksOnly
    ? groups.filter((group) => group.members.some((member) => member.changed))
    : groups

const normalizeExact = (source: string): string => source.replace(/\s+/g, " ").trim()

const RUST_KEYWORDS = new Set([
  "as",
  "async",
  "await",
  "break",
  "const",
  "continue",
  "crate",
  "dyn",
  "else",
  "enum",
  "false",
  "fn",
  "for",
  "if",
  "impl",
  "in",
  "let",
  "loop",
  "match",
  "mod",
  "move",
  "mut",
  "pub",
  "ref",
  "return",
  "self",
  "Self",
  "static",
  "struct",
  "super",
  "trait",
  "true",
  "type",
  "unsafe",
  "use",
  "where",
  "while",
])

const tokenizeStructural = (source: string): ReadonlyArray<string> => {
  const stripped = source
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/r#*"[\s\S]*?"#*/g, "STR")
    .replace(/"(?:[^"\\]|\\.)*"/g, "STR")
    .replace(/'(?:[^'\\]|\\.)'/g, "CHR")
    .replace(/\b\d+(?:_\d+)*(?:\.\d+)?\b/g, "NUM")
    .replace(/'[A-Za-z_][A-Za-z0-9_]*/g, "LIFETIME")
  const rawTokens = stripped.match(/[A-Za-z_][A-Za-z0-9_]*|::|->|=>|==|!=|<=|>=|&&|\|\||[{}()[\],;:.<>+\-*\/%&|!?=]/g) ?? []
  return rawTokens.map((token) =>
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(token) && !RUST_KEYWORDS.has(token) ? "ID" : token,
  )
}
