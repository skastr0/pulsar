import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { type FunctionDeclaration, type MethodDeclaration, type ArrowFunction, type FunctionExpression, type ConstructorDeclaration, type GetAccessorDeclaration, type SetAccessorDeclaration, Node, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"

type FnLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

export const TsSl01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  min_tokens: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsSl01Config = typeof TsSl01Config.Type

export interface CloneGroupMember {
  readonly file: string
  readonly name: string
  readonly startLine: number
  readonly endLine: number
}

export interface CloneGroup {
  readonly groupId: string
  readonly kind: "exact" | "structural"
  readonly tokenCount: number
  readonly members: ReadonlyArray<CloneGroupMember>
  readonly structuralHash: string
}

export interface TsSl01Output {
  readonly groups: ReadonlyArray<CloneGroup>
  readonly totalFunctionsAnalyzed: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
}

export const TsSl01: Signal<TsSl01Config, TsSl01Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-01",
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  configSchema: TsSl01Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    test_globs: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**"],
    min_tokens: 12,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.try({
        try: (): TsSl01Output => {
          const functions: Array<{
            exactHash: string
            structuralHash: string
            structuralEligible: boolean
            tokenCount: number
            member: CloneGroupMember
          }> = []

          for (const sourceFile of project.getSourceFiles()) {
            const path = sourceFile.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue
            if (matchesAnyGlob(path, config.test_globs)) continue

            for (const fn of collectFunctionLike(sourceFile)) {
              if (!lineRangeOverlapsHunks(path, fn, context.worktreePath, context.changedHunks)) {
                continue
              }

              const body = getFunctionBody(fn)
              if (body === undefined) continue

              const exactTokens = tokenizeExact(body)
              const structuralTokens = tokenizeStructural(body)

              if (structuralTokens.length < config.min_tokens) continue

              const member: CloneGroupMember = {
                file: path,
                name: getFunctionName(fn),
                startLine: fn.getStartLineNumber(),
                endLine: fn.getEndLineNumber(),
              }

              functions.push({
                exactHash: hashTokens(exactTokens),
                structuralHash: hashTokens(structuralTokens),
                structuralEligible: isStructuralCloneEligible(fn),
                tokenCount: structuralTokens.length,
                member,
              })
            }
          }

          const exactGroups = buildGroups(functions, "exact", config)
          const structuralGroups = buildGroups(functions, "structural", config).filter((group) => {
            const exactVariants = new Set(
              group.members.map((member) =>
                functions.find((fn) =>
                  fn.member.file === member.file && fn.member.startLine === member.startLine,
                )?.exactHash,
              ),
            )
            return exactVariants.size > 1
          })

          const groups: Array<CloneGroup> = []
          let groupIndex = 0

          for (const g of exactGroups) {
            groups.push({
              groupId: `exact-${groupIndex++}`,
              kind: "exact",
              tokenCount: g.tokenCount,
              members: g.members,
              structuralHash: g.hash,
            })
          }

          for (const g of structuralGroups) {
            groups.push({
              groupId: `structural-${groupIndex++}`,
              kind: "structural",
              tokenCount: g.tokenCount,
              members: g.members,
              structuralHash: g.hash,
            })
          }

          return {
            groups: groups.sort((a, b) => b.members.length - a.members.length || b.tokenCount - a.tokenCount),
            totalFunctionsAnalyzed: functions.length,
            scopeMode: context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-01", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const cloneMembers = out.groups.reduce((sum, group) => sum + group.members.length, 0)
    if (cloneMembers === 0) return 1
    return Math.max(0, 1 - Math.min(1, cloneMembers / 20))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.groups.slice(0, 10).map((group) => ({
      severity: group.kind === "exact" ? ("warn" as const) : ("info" as const),
      message: `${group.kind} clone group with ${group.members.length} members (${group.tokenCount} tokens)`,
      location: {
        file: group.members[0]?.file ?? "unknown",
        line: group.members[0]?.startLine,
      },
      data: {
        groupId: group.groupId,
        kind: group.kind,
        tokenCount: group.tokenCount,
        members: group.members,
        structuralHash: group.structuralHash,
      },
    })),
}

const collectFunctionLike = (sourceFile: SourceFile): ReadonlyArray<FnLike> => {
  const results: Array<FnLike> = []
  sourceFile.forEachDescendant((node) => {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    ) {
      results.push(node as FnLike)
    }
  })
  return results
}

const getFunctionBody = (fn: FnLike): string | undefined => {
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody()
    return body?.getText()
  }
  if ("getBody" in fn && typeof fn.getBody === "function") {
    const body = fn.getBody()
    return body?.getText()
  }
  return undefined
}

const getFunctionName = (fn: FnLike): string => {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn) || Node.isFunctionExpression(fn)) {
    const name = fn.getName?.()
    if (name) return name
  }
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) {
      return parent.getName()
    }
    if (Node.isExportAssignment(parent)) {
      return "<default export>"
    }
  }
  if (Node.isConstructorDeclaration(fn)) return "constructor"
  if (Node.isGetAccessorDeclaration(fn)) return `get ${fn.getName()}`
  if (Node.isSetAccessorDeclaration(fn)) return `set ${fn.getName()}`
  return "<anonymous>"
}

const isStructuralCloneEligible = (fn: FnLike): boolean => {
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if ((Node.isCallExpression(parent) || Node.isPropertyAssignment(parent)) && hasSingleOperationalStatement(fn)) {
      return false
    }
  }

  return true
}

const hasSingleOperationalStatement = (fn: ArrowFunction | FunctionExpression): boolean => {
  const body = fn.getBody()
  if (!Node.isBlock(body)) return true
  return body.getStatements().length === 1
}

const lineRangeOverlapsHunks = (
  filePath: string,
  fn: FnLike,
  worktreePath: string,
  hunks: ReadonlyArray<{ file: string; oldStart: number; oldLines: number; newStart: number; newLines: number }>,
): boolean => {
  if (hunks.length === 0) return true
  const absoluteFile = filePath.startsWith(worktreePath) ? filePath : `${worktreePath}/${filePath}`
  const startLine = fn.getStartLineNumber()
  const endLine = fn.getEndLineNumber()

  for (const hunk of hunks) {
    const hunkFileAbsolute = hunk.file.startsWith(worktreePath) ? hunk.file : `${worktreePath}/${hunk.file}`
    if (hunkFileAbsolute !== absoluteFile) continue

    const hunkStart = hunk.newStart
    const hunkEnd = hunk.newStart + hunk.newLines

    if (startLine < hunkEnd && endLine >= hunkStart) {
      return true
    }
  }

  return false
}

const tokenizeExact = (source: string): ReadonlyArray<string> => {
  const normalized = source.replace(/\s+/g, " ").trim()
  return normalized.split(/\s+/)
}

const TS_KEYWORDS = new Set([
  "abstract", "any", "as", "async", "await", "bigint", "boolean", "break", "case", "catch",
  "class", "const", "constructor", "continue", "debugger", "declare", "default", "delete",
  "do", "else", "enum", "export", "extends", "false", "finally", "for", "from", "function",
  "get", "if", "implements", "import", "in", "infer", "instanceof", "interface", "is",
  "keyof", "let", "module", "namespace", "never", "new", "null", "number", "object",
  "of", "package", "private", "protected", "public", "readonly", "return", "require",
  "set", "static", "string", "super", "switch", "symbol", "this", "throw", "true",
  "try", "type", "typeof", "undefined", "unique", "unknown", "var", "void", "while",
  "with", "yield",
])

const tokenizeStructural = (source: string): ReadonlyArray<string> => {
  const stripped = source
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/`[\s\S]*?`/g, "TMPL")
    .replace(/\b\d+(?:_\d+)*(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g, "NUM")
    .replace(/\b0[xX][0-9a-fA-F]+\b/g, "NUM")
    .replace(/\b0[oO][0-7]+\b/g, "NUM")
    .replace(/\b0[bB][01]+\b/g, "NUM")

  const rawTokens = stripped.match(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[A-Za-z_$][A-Za-z0-9_$]*|=>|===|!==|==|!=|<=|>=|\*\*|\+\+|--|&&|\|\||<<|>>|>>>|\.\.\.|[{}()[\],;:.<>+\-*\/%&|!?=]/g,
  ) ?? []

  const structuralTokens = rawTokens.map((token, index) => {
    if (isStringLiteralToken(token)) {
      return isObjectPropertyValue(rawTokens, index) ? `STR:${token}` : "STR"
    }

    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(token) && !TS_KEYWORDS.has(token)) {
      return rawTokens[index + 1] === ":" ? `KEY:${token}` : "ID"
    }

    return token
  })

  return structuralTokens
}

const isStringLiteralToken = (token: string): boolean =>
  (token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))

const isObjectPropertyValue = (tokens: ReadonlyArray<string>, index: number): boolean => {
  const colonIndex = index - 1
  if (tokens[colonIndex] !== ":" || isTernaryColon(tokens, colonIndex)) return false
  const key = tokens[index - 2]
  return key !== undefined && (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) || isStringLiteralToken(key))
}

const isTernaryColon = (tokens: ReadonlyArray<string>, colonIndex: number): boolean => {
  for (let index = colonIndex - 1; index >= 0; index--) {
    const token = tokens[index]
    if (token === undefined || token === ";" || token === "," || token === "{" || token === "}") return false
    if (token === "?") return true
  }
  return false
}

const hashTokens = (tokens: ReadonlyArray<string>): string => {
  let hash = 0
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]
    if (token === undefined) continue
    for (let j = 0; j < token.length; j++) {
      const charCode = token.charCodeAt(j)
      hash = ((hash << 5) - hash) + charCode
      hash = hash & hash
    }
  }
  return Math.abs(hash).toString(36)
}

const buildGroups = (
  functions: ReadonlyArray<{
    exactHash: string
    structuralHash: string
    structuralEligible: boolean
    tokenCount: number
    member: CloneGroupMember
  }>,
  kind: "exact" | "structural",
  _config: TsSl01Config,
): ReadonlyArray<{ hash: string; tokenCount: number; members: ReadonlyArray<CloneGroupMember> }> => {
  const grouped = new Map<string, Array<(typeof functions)[number]>>()
  for (const fn of functions) {
    if (kind === "structural" && !fn.structuralEligible) continue
    const key = kind === "exact" ? fn.exactHash : fn.structuralHash
    const bucket = grouped.get(key) ?? []
    bucket.push(fn)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .filter((bucket) => bucket.length > 1)
    .map((bucket) => ({
      hash: kind === "exact" ? bucket[0]!.exactHash : bucket[0]!.structuralHash,
      tokenCount: bucket[0]!.tokenCount,
      members: bucket.map((entry) => entry.member),
    }))
}