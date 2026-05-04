import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
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

export const RsSl01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  min_tokens: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type RsSl01Config = typeof RsSl01Config.Type

export interface DuplicateGroupMember {
  readonly file: string
  readonly module: string
  readonly name: string
  readonly line: number
}

export interface DuplicateGroup {
  readonly kind: "exact" | "structural"
  readonly tokenCount: number
  readonly members: ReadonlyArray<DuplicateGroupMember>
}

export interface RsSl01Output {
  readonly groups: ReadonlyArray<DuplicateGroup>
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly analysisMode: "function-body-normalization"
}

export const RsSl01: Signal<RsSl01Config, RsSl01Output, RustProjectTag | SignalContextTag> = {
  id: "RS-SL-01",
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "advisory-rust-duplication-v1",
  configSchema: RsSl01Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    min_tokens: 12,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
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

          for (const file of project.sourceFiles) {
            if (isExcluded(file, config.exclude_globs)) continue
            const scope = resolveRustFileScope(project, file)
            const tree = await parseRustFile(file)
            walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
              if (testGated || node.type !== "function_item") return
              const startLine = node.startPosition.row + 1
              const endLine = node.endPosition.row + 1
              if (
                !lineRangeOverlapsChangedHunks(
                  file,
                  startLine,
                  endLine,
                  context.worktreePath,
                  context.changedHunks,
                )
              ) {
                return
              }

              const structuralTokens = tokenizeStructural(node.text)
              if (structuralTokens.length < config.min_tokens) return
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
                },
              })
            })
          }

          const exactGroups = buildGroups(functions, "exact")
          const structuralGroups = buildGroups(functions, "structural").filter((group) => {
            const exactVariants = new Set(
              group.members.map((member) =>
                functions.find(
                  (fn) => fn.member.file === member.file && fn.member.line === member.line,
                )?.exact,
              ),
            )
            return exactVariants.size > 1
          })

          return {
            groups: [...exactGroups, ...structuralGroups].sort(
              (left, right) => right.members.length - left.members.length || right.tokenCount - left.tokenCount,
            ),
            scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
            analysisMode: "function-body-normalization",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-SL-01", message: String(cause), cause }),
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
    out.groups.slice(0, 10).map((group) => ({
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
      },
    })),
}

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
