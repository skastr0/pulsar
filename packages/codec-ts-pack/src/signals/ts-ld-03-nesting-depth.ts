import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import {
  type ArrowFunction,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type GetAccessorDeclaration,
  type MethodDeclaration,
  Node,
  type SetAccessorDeclaration,
  type SourceFile,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"

type FunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

export const TsLd03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_nesting: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsLd03Config = typeof TsLd03Config.Type

export interface FunctionNesting {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly maxNesting: number
}

export interface TsLd03Output {
  readonly byFunction: ReadonlyArray<FunctionNesting>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThreshold: ReadonlyArray<FunctionNesting>
  readonly threshold: number
  readonly totalFunctions: number
  readonly diagnosticLimit: number
}

export const TsLd03: Signal<TsLd03Config, TsLd03Output, TsProjectTag> = {
  id: "TS-LD-03",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: TsLd03Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    max_nesting: 4,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsLd03Output => {
          const byFunction: Array<FunctionNesting> = []
          const byFileValues = new Map<string, Array<number>>()

          for (const sourceFile of project.getSourceFiles()) {
            const file = sourceFile.getFilePath()
            if (isExcluded(file, config.exclude_globs)) continue

            const values = byFileValues.get(file) ?? []
            for (const fn of collectFunctions(sourceFile)) {
              const maxNesting = nestingDepth(fn)
              byFunction.push({
                file,
                name: functionName(fn),
                line: fn.getStartLineNumber(),
                maxNesting,
              })
              values.push(maxNesting)
            }
            byFileValues.set(file, values)
          }

          const byFile = new Map<string, DistributionalSummary>()
          for (const [file, values] of byFileValues) {
            byFile.set(file, summarize(values))
          }

          const sorted = byFunction.slice().sort(compareNesting)
          return {
            byFunction: sorted,
            byFile,
            overThreshold: sorted.filter((entry) => entry.maxNesting > config.max_nesting),
            threshold: config.max_nesting,
            totalFunctions: sorted.length,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-03",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    return Math.max(0, 1 - out.overThreshold.length / out.totalFunctions)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.overThreshold.slice(0, out.diagnosticLimit).map((entry) => ({
      severity: "warn" as const,
      message: `Function nesting depth \`${entry.name}\` reaches ${entry.maxNesting}`,
      location: { file: entry.file, line: entry.line },
      data: {
        ...entry,
        threshold: out.threshold,
      },
    })),
}

const collectFunctions = (sourceFile: SourceFile): ReadonlyArray<FunctionLike> => {
  const results: Array<FunctionLike> = []
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
      results.push(node)
    }
  })
  return results
}

const nestingDepth = (root: FunctionLike): number => {
  const body = root.getBody()
  if (body === undefined) return 0

  const walk = (node: Node, depth: number): number => {
    let maxDepth = depth
    node.forEachChild((child) => {
      if (child !== root && isNestedFunction(child)) {
        return
      }

      if (isControlFlowNode(child)) {
        const childDepth = depth + 1
        maxDepth = Math.max(maxDepth, childDepth, walk(child, childDepth))
        return
      }

      maxDepth = Math.max(maxDepth, walk(child, depth))
    })
    return maxDepth
  }

  return walk(body, 0)
}

const isNestedFunction = (node: Node): boolean =>
  Node.isFunctionDeclaration(node) ||
  Node.isMethodDeclaration(node) ||
  Node.isArrowFunction(node) ||
  Node.isFunctionExpression(node) ||
  Node.isConstructorDeclaration(node) ||
  Node.isGetAccessorDeclaration(node) ||
  Node.isSetAccessorDeclaration(node)

const isControlFlowNode = (node: Node): boolean =>
  Node.isIfStatement(node) ||
  Node.isForStatement(node) ||
  Node.isForInStatement(node) ||
  Node.isForOfStatement(node) ||
  Node.isWhileStatement(node) ||
  Node.isDoStatement(node) ||
  Node.isSwitchStatement(node) ||
  Node.isTryStatement(node) ||
  Node.isCatchClause(node)

const functionName = (fn: FunctionLike): string => {
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isGetAccessorDeclaration(fn) ||
    Node.isSetAccessorDeclaration(fn)
  ) {
    return fn.getName() ?? "<anonymous>"
  }
  if (Node.isConstructorDeclaration(fn)) {
    return "constructor"
  }

  const parent = fn.getParent()
  if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) {
    return parent.getName()
  }
  return "<anonymous>"
}

const compareNesting = (left: FunctionNesting, right: FunctionNesting): number => {
  if (right.maxNesting !== left.maxNesting) {
    return right.maxNesting - left.maxNesting
  }
  const fileCompare = left.file.localeCompare(right.file)
  if (fileCompare !== 0) return fileCompare
  return left.line - right.line
}
