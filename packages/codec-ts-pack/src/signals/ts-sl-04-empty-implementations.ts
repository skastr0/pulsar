import {
  SignalContextTag,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import {
  type FunctionDeclaration,
  type MethodDeclaration,
  type ArrowFunction,
  type FunctionExpression,
  type ConstructorDeclaration,
  type GetAccessorDeclaration,
  type SetAccessorDeclaration,
  Node,
  type SourceFile,
} from "ts-morph"
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

export const TsSl04Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  hard_gate_production: Schema.Boolean,
})
export type TsSl04Config = typeof TsSl04Config.Type

type StubKind = "throw-not-implemented" | "empty-body" | "todo-comment" | "mock-return"

export interface Stub {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly kind: StubKind
  readonly inTestPath: boolean
  readonly message: string | undefined
}

export interface TsSl04Output {
  readonly stubs: ReadonlyArray<Stub>
  readonly byKind: ReadonlyMap<StubKind, number>
  readonly productionStubs: ReadonlyArray<Stub>
  readonly testStubs: ReadonlyArray<Stub>
  readonly totalFunctions: number
}

export const TsSl04: Signal<TsSl04Config, TsSl04Output, TsProjectTag | SignalContextTag> = {
  id: "TS-SL-04",
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  configSchema: TsSl04Config,
  defaultConfig: {
    exclude_globs: ["**/node_modules/**", "**/dist/**", "**/.turbo/**"],
    test_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
      "**/tests/**",
    ],
    top_n_diagnostics: 20,
    hard_gate_production: true,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const context = yield* SignalContextTag
      return yield* Effect.try({
        try: (): TsSl04Output => {
          const stubs: Array<Stub> = []
          let totalFunctions = 0

          for (const sourceFile of project.getSourceFiles()) {
            const path = sourceFile.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue

            const isTestPath = matchesAnyGlob(path, config.test_globs)

            for (const fn of collectFunctionLike(sourceFile)) {
              if (!lineRangeOverlapsHunks(path, fn, context.worktreePath, context.changedHunks)) {
                continue
              }

              // Skip abstract methods — they intentionally have no body
              if (isAbstractMethod(fn)) {
                continue
              }

              totalFunctions++

              const body = getFunctionBody(fn)
              if (body === undefined) {
                continue
              }

              if (isIntentionalNoop(path, fn, body)) {
                continue
              }

              const stubKind = classifyStub(body)
              if (stubKind !== undefined) {
                stubs.push(createStub(path, fn, stubKind.kind, stubKind.message, isTestPath))
              }
            }
          }

          const byKind = new Map<StubKind, number>()
          for (const stub of stubs) {
            byKind.set(stub.kind, (byKind.get(stub.kind) ?? 0) + 1)
          }

          return {
            stubs: stubs.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
            byKind,
            productionStubs: stubs.filter((s) => !s.inTestPath),
            testStubs: stubs.filter((s) => s.inTestPath),
            totalFunctions,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-04", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    const penalty = out.productionStubs.length * 0.2
    return Math.max(0, 1 - penalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnostics: Array<Diagnostic> = []
    const topN = out.stubs.slice(0, 20)

    for (const stub of topN) {
      const severity =
        !stub.inTestPath
          ? ("block" as const)
          : stub.inTestPath
            ? ("info" as const)
            : ("warn" as const)

      diagnostics.push({
        severity,
        message: `${stub.name}: ${stub.kind}${stub.message ? ` — "${stub.message}"` : ""}`,
        location: { file: stub.file, line: stub.line },
        data: {
          hash: computeDiagnosticHash(`${stub.file}:${stub.line}:${stub.kind}`),
          kind: stub.kind,
          inTestPath: stub.inTestPath,
          message: stub.message,
        },
      })
    }

    return diagnostics
  },
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

const isAbstractMethod = (fn: FnLike): boolean => {
  return Node.isMethodDeclaration(fn) && fn.isAbstract()
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

const createStub = (
  file: string,
  fn: FnLike,
  kind: StubKind,
  message: string | undefined,
  inTestPath: boolean,
): Stub => ({
  file,
  name: getFunctionName(fn),
  line: fn.getStartLineNumber(),
  kind,
  inTestPath,
  message,
})

const isIntentionalNoop = (filePath: string, fn: FnLike, bodyText: string): boolean => {
  if (!isEmptyBodyText(bodyText) && !isNoopImplementationFile(filePath)) {
    return false
  }

  if (isNoopImplementationFile(filePath)) {
    return true
  }

  if (isPromiseSwallowHandler(fn)) {
    return true
  }

  return hasNoopName(getFunctionName(fn))
}

const isEmptyBodyText = (bodyText: string): boolean => {
  const normalized = bodyText.replace(/\s+/g, " ").trim()
  return normalized === "{}" || normalized === "{ }" || normalized === "{  }"
}

const isNoopImplementationFile = (filePath: string): boolean => {
  const fileName = filePath.split(/[\\/]/).at(-1) ?? filePath
  return /(?:^|[._-])noop(?:[._-]|$)/i.test(fileName)
}

const hasNoopName = (name: string): boolean => /(?:^|[^a-z0-9])no[-_]?op(?:$|[^a-z0-9]|[A-Z])/i.test(name)

const isPromiseSwallowHandler = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) {
    return false
  }

  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) {
    return false
  }

  const expression = parent.getExpression()
  return Node.isPropertyAccessExpression(expression) && ["catch", "finally"].includes(expression.getName())
}

const classifyStub = (bodyText: string): { kind: StubKind; message: string } | undefined => {
  const normalized = bodyText.replace(/\s+/g, " ").trim()

  const throwMatch = /throw\s+new\s+(?:Error|TypeError|RangeError)\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/i.exec(
    normalized,
  )
  if (throwMatch) {
    const message = throwMatch[1]!.toLowerCase()
    if (/not\s*implemented|todo|fixme|stub/i.test(message)) {
      return { kind: "throw-not-implemented", message: throwMatch[1]! }
    }
  }

  if (isEmptyBodyText(bodyText)) {
    return { kind: "empty-body", message: "Empty implementation" }
  }

  const commentOnlyMatch = /^\{\s*(?:\/\/|\/\*|\*\/|#).*$/
  if (commentOnlyMatch.test(normalized)) {
    const commentText = normalized.replace(/^\{\s*\/\/\s*/, "").replace(/\*\/\s*\}$/, "")
    if (/todo|fixme|xxx/i.test(commentText)) {
      return { kind: "todo-comment", message: commentText }
    }
  }

  const returnLiteralMatch = /^\{\s*return\s+(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\d+|true|false|null|undefined|\[\s*\]|\{\s*\})\s*;?\s*\}$/.exec(
    normalized,
  )
  if (returnLiteralMatch) {
    const returnedText = (returnLiteralMatch[1] ?? returnLiteralMatch[2] ?? returnLiteralMatch[3] ?? "").toLowerCase()
    if (/placeholder|mock|todo|fixme|not\s*implemented|stub/.test(returnedText)) {
      return { kind: "mock-return", message: "Returns placeholder literal" }
    }
  }

  return undefined
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