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
  SyntaxKind,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"

type FnLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

export const TsLd01Config = Schema.Struct({
  max_complexity: Schema.Number,
  top_n_diagnostics: Schema.Number,
  exclude_globs: Schema.Array(Schema.String),
})
export type TsLd01Config = typeof TsLd01Config.Type

export interface FunctionComplexity {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly complexity: number
}

export interface TsLd01Output {
  readonly functions: ReadonlyArray<FunctionComplexity>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThresholdCount: number
  readonly totalFunctions: number
}

const BRANCHING_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CaseClause,
  SyntaxKind.CatchClause,
  SyntaxKind.ConditionalExpression,
])

const cyclomaticComplexity = (fn: FnLike): number => {
  let complexity = 1
  fn.forEachDescendant((node) => {
    if (BRANCHING_KINDS.has(node.getKind())) {
      complexity += 1
      return
    }
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getKind()
      if (
        op === SyntaxKind.AmpersandAmpersandToken ||
        op === SyntaxKind.BarBarToken ||
        op === SyntaxKind.QuestionQuestionToken
      ) {
        complexity += 1
      }
    }
  })
  return complexity
}

const functionName = (fn: FnLike): string => {
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isFunctionExpression(fn)
  ) {
    const name = fn.getName?.()
    if (name) return name
  }
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) {
      return parent.getName()
    }
  }
  return "<anonymous>"
}

const collectFunctions = (sourceFile: SourceFile): ReadonlyArray<FnLike> => {
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

export const TsLd01: Signal<TsLd01Config, TsLd01Output, TsProjectTag> = {
  id: "TS-LD-01",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  configSchema: TsLd01Config,
  defaultConfig: {
    max_complexity: 20,
    top_n_diagnostics: 10,
    exclude_globs: ["**/*.test.ts", "**/*.spec.ts", "**/node_modules/**", "**/dist/**"],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsLd01Output => {
          const functions: Array<FunctionComplexity> = []
          const perFileValues = new Map<string, Array<number>>()

          for (const sf of project.getSourceFiles()) {
            const path = sf.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue
            for (const fn of collectFunctions(sf)) {
              const complexity = cyclomaticComplexity(fn)
              const name = functionName(fn)
              functions.push({
                file: path,
                name,
                line: fn.getStartLineNumber(),
                complexity,
              })
              const bucket = perFileValues.get(path) ?? []
              bucket.push(complexity)
              perFileValues.set(path, bucket)
            }
          }

          const byFile = new Map<string, DistributionalSummary>()
          for (const [path, values] of perFileValues) {
            byFile.set(path, summarize(values))
          }

          const overThresholdCount = functions.filter(
            (f) => f.complexity > config.max_complexity,
          ).length

          return {
            functions,
            byFile,
            overThresholdCount,
            totalFunctions: functions.length,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-LD-01", message: String(cause), cause }),
      })
      return result
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    const ratio = out.overThresholdCount / out.totalFunctions
    return Math.max(0, 1 - ratio * 2)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const sorted = [...out.functions].sort((a, b) => b.complexity - a.complexity)
    const top = sorted.slice(0, 10)
    return top.map((f) => ({
      severity: "warn" as const,
      message: `Function \`${f.name}\` has cyclomatic complexity ${f.complexity}`,
      location: { file: f.file, line: f.line },
      data: { complexity: f.complexity, name: f.name },
    }))
  },
}

const isExcluded = (path: string, globs: ReadonlyArray<string>): boolean => {
  for (const glob of globs) {
    if (matchesGlob(path, glob)) return true
  }
  return false
}

const matchesGlob = (path: string, glob: string): boolean => {
  const regex = new RegExp(
    "^" +
      glob
        .replace(/\./g, "\\.")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$",
  )
  return regex.test(path)
}
