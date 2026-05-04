import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { relative } from "node:path"
import { type ArrowFunction, type FunctionExpression, Node, SyntaxKind } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  getFunctionBody,
  getFunctionLikeEntriesForSourceFile,
  getFunctionName,
  type TsFunctionLike as FnLike,
} from "./shared-function-index.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"

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
  readonly scoreBudgetFunctions: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly detectionMinTokens?: number
  readonly diagnosticLimit?: number
}

const DEFAULT_SCORE_BUDGET_MIN_TOKENS = 12

type CloneCandidate = {
  readonly fn: FnLike
  readonly path: string
  readonly body: string
  readonly startLine: number
  readonly endLine: number
  readonly exactHash: string
  readonly structuralHash: string
  readonly changed: boolean
  readonly tokenCount: number
}

export const TsSl01: Signal<TsSl01Config, TsSl01Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-01",
  tier: 1,
  category: "generated-slop",
  kind: "legibility",
  cacheVersion: "parallel-implementation-family-impact-v1",
  configSchema: TsSl01Config,
  defaultConfig: {
    exclude_globs: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "example/**",
      "**/example/**",
      "examples/**",
      "**/examples/**",
      "fixture/**",
      "**/fixture/**",
      "fixtures/**",
      "**/fixtures/**",
      "sample/**",
      "**/sample/**",
      "samples/**",
      "**/samples/**",
      "sdk-samples/**",
      "**/sdk-samples/**",
      "playground/**",
      "playground-*/**",
      "playgrounds/**",
      "template/**",
      "**/template/**",
      "templates/**",
      "**/templates/**",
    ],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
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
          const functions: Array<CloneCandidate> = []
          let scoreBudgetFunctions = 0
          let totalFunctionsAnalyzed = 0
          const hunkMap = buildHunkMap(context.worktreePath, context.changedHunks)
          const structuralAnalysisCache = new Map<
            string,
            { readonly tokenCount: number; readonly structuralHash: string }
          >()

          for (const sourceFile of project.getSourceFiles()) {
            if (sourceFile.isDeclarationFile()) continue

            const path = sourceFile.getFilePath()
            const relativePath = relative(context.worktreePath, path).replace(/\\/g, "/")
            if (matchesSourcePath(path, relativePath, config.exclude_globs)) continue
            if (isGeneratedSourceFileHeader(sourceFile.compilerNode.text.slice(0, 2048))) continue
            if (matchesSourcePath(path, relativePath, config.test_globs)) continue

            for (const { fn, path: functionPath } of getFunctionLikeEntriesForSourceFile(sourceFile)) {
              const startLine = fn.getStartLineNumber()
              const endLine = fn.getEndLineNumber()
              const changed =
                hunkMap === undefined ||
                lineRangeOverlapsHunkRanges(startLine, endLine, hunkMap.get(path) ?? [])

              const body = getFunctionBody(fn)
              if (body === undefined) continue

              const exactHash = hashExactSource(body)
              const cacheKey = `${exactHash}:${body.length}`
              const structuralAnalysis =
                structuralAnalysisCache.get(cacheKey) ??
                analyzeStructuralBody(body, structuralAnalysisCache, cacheKey)

              if (changed && structuralAnalysis.tokenCount >= DEFAULT_SCORE_BUDGET_MIN_TOKENS) {
                scoreBudgetFunctions += 1
              }

              if (structuralAnalysis.tokenCount < config.min_tokens) continue
              if (changed) {
                totalFunctionsAnalyzed += 1
              }

              functions.push({
                fn,
                path: functionPath,
                body,
                startLine,
                endLine,
                exactHash,
                structuralHash: structuralAnalysis.structuralHash,
                changed,
                tokenCount: structuralAnalysis.tokenCount,
              })
            }
          }

          const scopeMode = context.changedHunks.length > 0 ? "changed-hunks" : "whole-tree"
          const exactGroups = buildExactGroups(functions, config, scopeMode)
          const structuralGroups = buildStructuralGroups(functions, config, scopeMode)

          const groups: Array<CloneGroup> = []
          let groupIndex = 0

          for (const g of exactGroups) {
            groups.push({
              groupId: `exact-${groupIndex++}`,
              kind: "exact",
              tokenCount: g.tokenCount,
              members: g.members.map((member) => member.member),
              structuralHash: g.hash,
            })
          }

          for (const g of structuralGroups) {
            groups.push({
              groupId: `structural-${groupIndex++}`,
              kind: "structural",
              tokenCount: g.tokenCount,
              members: g.members.map((member) => member.member),
              structuralHash: g.hash,
            })
          }

          return {
            groups: groups
              .sort((a, b) =>
                cloneGroupImpact(b, scopeMode, config.min_tokens) - cloneGroupImpact(a, scopeMode, config.min_tokens) ||
                b.members.length - a.members.length ||
                b.tokenCount - a.tokenCount,
              ),
            totalFunctionsAnalyzed,
            scoreBudgetFunctions,
            scopeMode,
            detectionMinTokens: config.min_tokens,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-01", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    const minTokens = out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens
    const penalty = out.groups.reduce(
      (sum, group) => sum + cloneGroupImpact(group, out.scopeMode, minTokens),
      0,
    )
    if (penalty === 0) return 1
    const expectedCleanBudget = Math.max(80, out.scoreBudgetFunctions * 0.12)
    return Math.max(0, 1 - Math.min(1, penalty / expectedCleanBudget))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.groups
      .filter((group) => cloneGroupImpact(
        group,
        out.scopeMode,
        out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens,
      ) > 0)
      .slice(0, out.diagnosticLimit ?? 10)
      .map((group) => ({
      severity: cloneGroupSeverity(
        group,
        out.scopeMode,
        out.detectionMinTokens ?? TsSl01.defaultConfig.min_tokens,
      ),
      message:
        `${group.kind} clone group with ${group.members.length} members (${group.tokenCount} tokens): ` +
        cloneMemberSummary(group.members),
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

const analyzeStructuralBody = (
  body: string,
  cache: Map<string, { readonly tokenCount: number; readonly structuralHash: string }>,
  cacheKey: string,
): { readonly tokenCount: number; readonly structuralHash: string } => {
  const analysis = analyzeStructuralSource(body)
  cache.set(cacheKey, analysis)
  return analysis
}

const matchesSourcePath = (
  absolutePath: string,
  relativePath: string,
  globs: ReadonlyArray<string>,
): boolean => isExcluded(absolutePath, globs) || matchesAnyGlob(relativePath, globs)

const isGeneratedSourceFileHeader = (header: string): boolean => {
  return (
    /\bcode generated\b[\s\S]{0,160}\bdo not edit\b/i.test(header) ||
    /\bauto-generated\b[\s\S]{0,160}\bdo not edit\b/i.test(header) ||
    /\bfile generated from\b[\s\S]{0,160}\bopenapi spec\b/i.test(header) ||
    /@generated\b/i.test(header)
  )
}

const cloneMemberSummary = (members: ReadonlyArray<CloneGroupMember>): string => {
  const visible = members
    .slice(0, 3)
    .map((member) => `${member.file}:${member.startLine} ${member.name}`)
  const hidden = members.length - visible.length
  return hidden > 0 ? `${visible.join(", ")} (+${hidden} more)` : visible.join(", ")
}

const cloneGroupImpact = (
  group: CloneGroup,
  scopeMode: TsSl01Output["scopeMode"],
  minTokens: number,
): number => {
  const extraMembers = Math.max(0, group.members.length - 1)
  if (extraMembers === 0) return 0

  if (group.kind === "exact") {
    if (group.tokenCount < 20 && minTokens >= DEFAULT_SCORE_BUDGET_MIN_TOKENS) return 0
    if (scopeMode === "whole-tree" && group.tokenCount < 20) return 0
    const isParallelImplementationFamily =
      scopeMode === "whole-tree" && isParallelImplementationFamilyClone(group.members)
    const memberPressure = isParallelImplementationFamily
      ? Math.log2(group.members.length)
      : scopeMode === "whole-tree" && group.tokenCount < 50
      ? Math.log2(group.members.length) * 0.5
      : extraMembers
    const familyWeight = isParallelImplementationFamily ? 0.35 : 1
    return memberPressure * 1.2 * Math.min(3, Math.max(0.3, group.tokenCount / 30)) * familyWeight
  }

  if (scopeMode === "changed-hunks") {
    return extraMembers * Math.min(1.5, Math.max(0.1, group.tokenCount / 60))
  }

  if (group.tokenCount < 30) return 0
  return extraMembers * Math.min(0.35, (group.tokenCount - 30) / 120)
}

const isParallelImplementationFamilyClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  if (members.length < 2) return false
  if (isSiblingImplementationVariantClone(members)) return true

  const descriptors = members.map(parallelPackageDescriptor)
  if (descriptors.some((descriptor) => descriptor === undefined)) return false

  const packages = new Set(descriptors.map((descriptor) => descriptor!.packageName))
  if (packages.size < 2) return false

  const familyNames = new Set(descriptors.map((descriptor) => descriptor!.familyName))
  if (familyNames.size !== 1) return false

  const functionNames = new Set(members.map((member) => member.name))
  const relativeTails = new Set(descriptors.map((descriptor) => descriptor!.relativeTail))
  const basenames = new Set(descriptors.map((descriptor) => descriptor!.basename))
  return functionNames.size === 1 && (relativeTails.size === 1 || basenames.size === 1)
}

const isSiblingImplementationVariantClone = (
  members: ReadonlyArray<CloneGroupMember>,
): boolean => {
  const functionNames = new Set(members.map((member) => member.name))
  if (functionNames.size !== 1) return false

  const pathParts = members.map((member) =>
    member.file.replace(/\\/g, "/").split("/").filter((part) => part.length > 0),
  )
  const minLength = Math.min(...pathParts.map((parts) => parts.length))
  for (let familyIndex = 0; familyIndex < minLength - 3; familyIndex++) {
    const familyName = pathParts[0]?.[familyIndex]
    if (familyName === undefined) continue
    if (pathParts.some((parts) => parts[familyIndex] !== familyName)) continue

    const variants = new Set(pathParts.map((parts) => parts[familyIndex + 1]))
    if (variants.size < 2 || variants.has(undefined)) continue

    const tails = pathParts.map((parts) => parts.slice(familyIndex + 2).join("/"))
    if (tails.some((tail) => tail.split("/").length < 2)) continue
    if (new Set(tails).size === 1) return true
  }

  return false
}

const parallelPackageDescriptor = (
  member: CloneGroupMember,
):
  | {
      readonly familyName: string
      readonly packageName: string
      readonly relativeTail: string
      readonly basename: string
    }
  | undefined => {
  const parts = member.file.replace(/\\/g, "/").split("/")
  const packagesIndex = parts.lastIndexOf("packages")
  if (packagesIndex !== -1 && packagesIndex + 2 < parts.length) {
    const packageName = parts[packagesIndex + 1]
    if (packageName === undefined || packageName.length === 0) return undefined
    const tail = parts.slice(packagesIndex + 2).join("/")
    const basename = parts[parts.length - 1]
    if (tail.length === 0 || basename === undefined) return undefined
    return { familyName: parts.slice(0, packagesIndex + 1).join("/"), packageName, relativeTail: tail, basename }
  }
  return undefined
}

const cloneGroupSeverity = (
  group: CloneGroup,
  scopeMode: TsSl01Output["scopeMode"],
  minTokens: number,
): Diagnostic["severity"] => {
  if (group.kind === "exact") return group.tokenCount < 30 ? "info" : "warn"
  return cloneGroupImpact(group, scopeMode, minTokens) >= 5 ? "warn" : "info"
}

const isStructuralCloneEligible = (fn: FnLike): boolean => {
  if (isAstPredicateUnionGuard(fn)) {
    return false
  }

  if (isJsxComponentAdapter(fn)) {
    return false
  }

  if (isSvgIconComponent(fn)) {
    return false
  }

  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if ((Node.isCallExpression(parent) || Node.isPropertyAssignment(parent)) && hasSingleOperationalStatement(fn)) {
      return false
    }
    if (isSmallEffectGenCallback(fn)) {
      return false
    }
  }

  return true
}

const isAstPredicateUnionGuard = (fn: FnLike): boolean => {
  const name = getFunctionName(fn)
  if (!/^is[A-Z]/.test(name)) return false
  if (!("getBody" in fn) || typeof fn.getBody !== "function") return false
  const body = fn.getBody()
  if (body === undefined) return false

  if (Node.isBlock(body)) {
    const statements = body.getStatements()
    if (statements.length !== 1) return false
    const statement = statements[0]
    if (!Node.isReturnStatement(statement)) return false
    const expression = statement.getExpression()
    return expression !== undefined && isAstPredicateUnionExpression(expression)
  }

  return isAstPredicateUnionExpression(body)
}

const isAstPredicateUnionExpression = (node: Node): boolean => {
  if (Node.isParenthesizedExpression(node)) {
    return isAstPredicateUnionExpression(node.getExpression())
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.BarBarToken) {
    return (
      isAstPredicateUnionExpression(node.getLeft()) &&
      isAstPredicateUnionExpression(node.getRight())
    )
  }
  if (!Node.isCallExpression(node)) return false
  const callee = node.getExpression().getText()
  return /^ts\.is[A-Z]/.test(callee) || /^Node\.is[A-Z]/.test(callee)
}

const isJsxComponentAdapter = (fn: FnLike): boolean => {
  if (!("getBody" in fn) || typeof fn.getBody !== "function") return false
  const body = fn.getBody()
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  if (statements.length !== 2) return false

  const setup = statements[0]?.getText() ?? ""
  const returned = statements[1]?.getText() ?? ""
  return (
    /\bsplitProps\s*\(/.test(setup) &&
    /^return\s*\(?\s*</s.test(returned) &&
    returned.includes("{...") &&
    returned.includes("classList")
  )
}

const isSvgIconComponent = (fn: FnLike): boolean => {
  if (!Node.isFunctionDeclaration(fn)) return false
  if (!/^Icon[A-Z]/.test(getFunctionName(fn))) return false
  const parameters = fn.getParameters()
  if (parameters.length > 1) return false
  const body = fn.getBody()
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  if (statements.length !== 1) return false
  const statement = statements[0]
  if (!Node.isReturnStatement(statement)) return false
  const returned = statement.getExpression()?.getText() ?? ""
  return /^(\(\s*)?<svg\b/s.test(returned) && /\{\s*\.\.\.\s*props\s*\}/.test(returned)
}

const isExactCloneEligible = (fn: FnLike, tokenCount: number): boolean => {
  if (tokenCount <= 40 && (isJsxRenderCallback(fn) || isSmallJsxReturnFunction(fn))) {
    return false
  }

  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if (Node.isCallExpression(parent) && hasSingleOperationalStatement(fn)) {
      return false
    }
  }

  return true
}

const isJsxRenderCallback = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false

  let current: Node | undefined = fn.getParent()
  while (current !== undefined && !Node.isSourceFile(current)) {
    if (Node.isJsxExpression(current)) return true
    current = current.getParent()
  }
  return false
}

const isSmallJsxReturnFunction = (fn: FnLike): boolean => {
  if (!("getBody" in fn) || typeof fn.getBody !== "function") return false
  const body = fn.getBody()
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  if (statements.length !== 1) return false
  return /^return\s*\(?\s*</s.test(statements[0]?.getText() ?? "")
}

const hasSingleOperationalStatement = (fn: ArrowFunction | FunctionExpression): boolean => {
  const body = fn.getBody()
  if (!Node.isBlock(body)) return true
  return body.getStatements().length === 1
}

const isSmallEffectGenCallback = (fn: ArrowFunction | FunctionExpression): boolean => {
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  if (parent.getExpression().getText() !== "Effect.gen") return false

  const body = fn.getBody()
  if (!Node.isBlock(body)) return true
  return body.getStatements().length <= 3
}

const buildHunkMap = (
  worktreePath: string,
  hunks: ReadonlyArray<{ file: string; oldStart: number; oldLines: number; newStart: number; newLines: number }>,
): Map<string, ReadonlyArray<{ start: number; end: number }>> | undefined => {
  if (hunks.length === 0) return undefined

  const map = new Map<string, Array<{ start: number; end: number }>>()
  for (const hunk of hunks) {
    const file = hunk.file.startsWith(worktreePath) ? hunk.file : `${worktreePath}/${hunk.file}`
    const ranges = map.get(file) ?? []
    ranges.push({
      start: hunk.newStart,
      end: hunk.newStart + hunk.newLines,
    })
    map.set(file, ranges)
  }
  return map
}

const lineRangeOverlapsHunkRanges = (
  startLine: number,
  endLine: number,
  ranges: ReadonlyArray<{ start: number; end: number }>,
): boolean => {
  if (ranges.length === 0) return false

  for (const range of ranges) {
    if (startLine < range.end && endLine >= range.start) {
      return true
    }
  }

  return false
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

const IDENTIFIER_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const PUNCTUATION_TOKENS = new Set("{}()[],;:.<>+-*/%&|!?=".split(""))
const THREE_CHAR_OPERATORS = new Set(["!==", "===", ">>>", "..."])
const TWO_CHAR_OPERATORS = new Set([
  "=>",
  "==",
  "!=",
  "<=",
  ">=",
  "**",
  "++",
  "--",
  "&&",
  "||",
  "<<",
  ">>",
])

const analyzeStructuralSource = (
  source: string,
): { readonly tokenCount: number; readonly structuralHash: string } => {
  const state: StructuralScanState = {
    hash: 0,
    tokenCount: 0,
    segmentHasQuestion: false,
    pending: undefined,
    pendingColonWasTernary: false,
    pendingPrev: undefined,
    pendingPrevColonWasTernary: false,
    pendingPrevPrev: undefined,
  }

  scanStructuralSource(source, (token) => {
    acceptStructuralToken(state, token)
  })
  flushPendingStructuralToken(state, undefined)

  return {
    tokenCount: state.tokenCount,
    structuralHash: Math.abs(state.hash).toString(36),
  }
}

type StructuralScanState = {
  hash: number
  tokenCount: number
  segmentHasQuestion: boolean
  pending: string | undefined
  pendingColonWasTernary: boolean
  pendingPrev: string | undefined
  pendingPrevColonWasTernary: boolean
  pendingPrevPrev: string | undefined
}

const scanStructuralSource = (
  source: string,
  accept: (token: string) => void,
): void => {
  let index = 0

  while (index < source.length) {
    const char = source[index]!
    const charCode = source.charCodeAt(index)

    if (isWhitespaceCharCode(charCode)) {
      index++
      continue
    }

    if (char === "/" && source[index + 1] === "/") {
      index = skipLineComment(source, index + 2)
      continue
    }

    if (char === "/" && source[index + 1] === "*") {
      index = skipBlockComment(source, index + 2)
      continue
    }

    if (char === "\"" || char === "'") {
      const end = skipQuotedString(source, index, char)
      accept(source.slice(index, end))
      index = end
      continue
    }

    if (char === "`") {
      index = skipTemplateLiteral(source, index + 1)
      accept("TMPL")
      continue
    }

    if (isIdentifierStartCharCode(charCode)) {
      const end = scanIdentifierEnd(source, index + 1)
      accept(source.slice(index, end))
      index = end
      continue
    }

    if (isDigitCharCode(charCode)) {
      index = scanNumberEnd(source, index)
      accept("NUM")
      continue
    }

    const three = source.slice(index, index + 3)
    if (THREE_CHAR_OPERATORS.has(three)) {
      accept(three)
      index += 3
      continue
    }

    const two = source.slice(index, index + 2)
    if (TWO_CHAR_OPERATORS.has(two)) {
      accept(two)
      index += 2
      continue
    }

    if (PUNCTUATION_TOKENS.has(char)) {
      accept(char)
    }
    index++
  }
}

const isWhitespaceCharCode = (charCode: number): boolean =>
  charCode === 9 ||
  charCode === 10 ||
  charCode === 11 ||
  charCode === 12 ||
  charCode === 13 ||
  charCode === 32

const isIdentifierStartCharCode = (charCode: number): boolean =>
  (charCode >= 65 && charCode <= 90) ||
  (charCode >= 97 && charCode <= 122) ||
  charCode === 36 ||
  charCode === 95

const isIdentifierPartCharCode = (charCode: number): boolean =>
  isIdentifierStartCharCode(charCode) || isDigitCharCode(charCode)

const isDigitCharCode = (charCode: number): boolean =>
  charCode >= 48 && charCode <= 57

const skipLineComment = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length && source[cursor] !== "\n") cursor++
  return cursor
}

const skipBlockComment = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length) {
    if (source[cursor] === "*" && source[cursor + 1] === "/") return cursor + 2
    cursor++
  }
  return source.length
}

const skipQuotedString = (source: string, index: number, quote: "\"" | "'"): number => {
  let cursor = index + 1
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === "\\") {
      cursor += 2
      continue
    }
    cursor++
    if (char === quote) return cursor
  }
  return source.length
}

const skipTemplateLiteral = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length) {
    const char = source[cursor]
    if (char === "\\") {
      cursor += 2
      continue
    }
    cursor++
    if (char === "`") return cursor
  }
  return source.length
}

const scanIdentifierEnd = (source: string, index: number): number => {
  let cursor = index
  while (cursor < source.length && isIdentifierPartCharCode(source.charCodeAt(cursor))) {
    cursor++
  }
  return cursor
}

const scanNumberEnd = (source: string, index: number): number => {
  let cursor = index + 1
  while (cursor < source.length) {
    const charCode = source.charCodeAt(cursor)
    const char = source[cursor]!
    if (isDigitCharCode(charCode) || char === "_") {
      cursor++
      continue
    }
    if (char === "." && source[cursor + 1] !== ".") {
      cursor++
      continue
    }
    if (char === "x" || char === "X" || char === "o" || char === "O" || char === "b" || char === "B") {
      cursor++
      continue
    }
    if ((charCode >= 65 && charCode <= 70) || (charCode >= 97 && charCode <= 102)) {
      cursor++
      continue
    }
    if (
      (char === "+" || char === "-") &&
      (source[cursor - 1] === "e" || source[cursor - 1] === "E")
    ) {
      cursor++
      continue
    }
    return cursor
  }
  return cursor
}

const acceptStructuralToken = (
  state: StructuralScanState,
  token: string,
): void => {
  const colonWasTernary = structuralTokenColonWasTernary(state, token)
  state.tokenCount += 1
  flushPendingStructuralToken(state, token)
  state.pendingPrevPrev = state.pendingPrev
  state.pendingPrev = state.pending
  state.pendingPrevColonWasTernary = state.pendingColonWasTernary
  state.pending = token
  state.pendingColonWasTernary = colonWasTernary
}

const structuralTokenColonWasTernary = (
  state: StructuralScanState,
  token: string,
): boolean => {
  if (token === ";" || token === "," || token === "{" || token === "}") {
    state.segmentHasQuestion = false
    return false
  }
  if (token === "?") {
    state.segmentHasQuestion = true
    return false
  }
  if (token === ":" && state.segmentHasQuestion) {
    state.segmentHasQuestion = false
    return true
  }
  return false
}

const flushPendingStructuralToken = (
  state: StructuralScanState,
  nextToken: string | undefined,
): void => {
  const token = state.pending
  if (token === undefined) return

  state.hash = appendTokenHash(
    state.hash,
    structuralTokenFor(
      token,
      nextToken,
      state.pendingPrev,
      state.pendingPrevColonWasTernary,
      state.pendingPrevPrev,
    ),
  )
}

const structuralTokenFor = (
  token: string,
  nextToken: string | undefined,
  previousToken: string | undefined,
  previousColonWasTernary: boolean,
  previousPreviousToken: string | undefined,
): string => {
  if (isStringLiteralToken(token)) {
    return isObjectPropertyValue(
      previousToken,
      previousColonWasTernary,
      previousPreviousToken,
    ) ? `STR:${token}` : "STR"
  }

  if (IDENTIFIER_PATTERN.test(token) && !TS_KEYWORDS.has(token)) {
    return nextToken === ":" ? `KEY:${token}` : "ID"
  }

  return token
}

const appendTokenHash = (hash: number, token: string): number => {
  let next = hash
  for (let index = 0; index < token.length; index++) {
    const charCode = token.charCodeAt(index)
    next = ((next << 5) - next) + charCode
    next = next & next
  }
  return next
}

const countExactTokens = (source: string): number => {
  let count = 0
  let inToken = false

  for (let index = 0; index < source.length; index++) {
    const charCode = source.charCodeAt(index)
    const isWhitespace =
      charCode === 9 ||
      charCode === 10 ||
      charCode === 11 ||
      charCode === 12 ||
      charCode === 13 ||
      charCode === 32
    if (isWhitespace) {
      inToken = false
      continue
    }

    if (!inToken) {
      count++
      inToken = true
    }
  }

  return count
}

const hashExactSource = (source: string): string => {
  let hash = 0
  for (let index = 0; index < source.length; index++) {
    const charCode = source.charCodeAt(index)
    if (
      charCode === 9 ||
      charCode === 10 ||
      charCode === 11 ||
      charCode === 12 ||
      charCode === 13 ||
      charCode === 32
    ) {
      continue
    }
    hash = ((hash << 5) - hash) + charCode
    hash = hash & hash
  }
  return Math.abs(hash).toString(36)
}

const isStringLiteralToken = (token: string): boolean =>
  (token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))

const isObjectPropertyValue = (
  previousToken: string | undefined,
  previousColonWasTernary: boolean,
  previousPreviousToken: string | undefined,
): boolean => {
  if (previousToken !== ":" || previousColonWasTernary) return false
  return previousPreviousToken !== undefined &&
    (IDENTIFIER_PATTERN.test(previousPreviousToken) || isStringLiteralToken(previousPreviousToken))
}

type MaterializedCloneCandidate = CloneCandidate & {
  readonly member: CloneGroupMember
}

const materializeCloneCandidate = (candidate: CloneCandidate): MaterializedCloneCandidate => ({
  ...candidate,
  member: {
    file: candidate.path,
    name: getFunctionName(candidate.fn),
    startLine: candidate.startLine,
    endLine: candidate.endLine,
  },
})

const buildExactGroups = (
  functions: ReadonlyArray<CloneCandidate>,
  _config: TsSl01Config,
  scopeMode: TsSl01Output["scopeMode"],
): ReadonlyArray<{ hash: string; tokenCount: number; members: ReadonlyArray<MaterializedCloneCandidate> }> => {
  const grouped = new Map<string, Array<(typeof functions)[number]>>()
  for (const fn of functions) {
    const key = fn.exactHash
    const bucket = grouped.get(key) ?? []
    bucket.push(fn)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .map((bucket) =>
      bucket.filter((candidate) =>
        isExactCloneEligible(candidate.fn, countExactTokens(candidate.body)),
      ),
    )
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .map((bucket) => ({
      hash: bucket[0]!.exactHash,
      tokenCount: bucket[0]!.tokenCount,
      members: bucket.map(materializeCloneCandidate),
    }))
}

const buildStructuralGroups = (
  functions: ReadonlyArray<CloneCandidate>,
  _config: TsSl01Config,
  scopeMode: TsSl01Output["scopeMode"],
): ReadonlyArray<{ hash: string; tokenCount: number; members: ReadonlyArray<MaterializedCloneCandidate> }> => {
  const grouped = new Map<string, Array<(typeof functions)[number]>>()
  for (const fn of functions) {
    const key = fn.structuralHash
    const bucket = grouped.get(key) ?? []
    bucket.push(fn)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .map((bucket) => bucket.filter((candidate) => isStructuralCloneEligible(candidate.fn)))
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .filter((bucket) => new Set(bucket.map((candidate) => candidate.exactHash)).size > 1)
    .map((bucket) => ({
      hash: bucket[0]!.structuralHash,
      tokenCount: bucket[0]!.tokenCount,
      members: bucket.map(materializeCloneCandidate),
    }))
}

const shouldRetainCloneBucket = (
  bucket: ReadonlyArray<CloneCandidate>,
  scopeMode: TsSl01Output["scopeMode"],
): boolean =>
  scopeMode === "whole-tree" || bucket.some((candidate) => candidate.changed)
