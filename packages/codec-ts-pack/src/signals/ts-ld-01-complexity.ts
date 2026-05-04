import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import {
  type SourceFile,
  SyntaxKind,
  ts,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  compilerPropertyNameText as propertyNameText,
  isCompilerFunctionLike,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"
import { isExcluded } from "./shared-globs.js"

type MutableFunctionComplexity = {
  file: string
  name: string
  line: number
  complexity: number
}

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

export const TsLd01: Signal<TsLd01Config, TsLd01Output, TsProjectTag> = {
  id: "TS-LD-01",
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "contextual-callback-names-v1",
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
            for (const fn of collectFunctionComplexities(sf)) {
              functions.push(fn)
              const bucket = perFileValues.get(path) ?? []
              bucket.push(fn.complexity)
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

const collectFunctionComplexities = (sourceFile: SourceFile): ReadonlyArray<FunctionComplexity> => {
  const compilerSourceFile = sourceFile.compilerNode
  const file = sourceFile.getFilePath()
  const functions: Array<MutableFunctionComplexity> = []

  const visit = (node: ts.Node, currentFunction: MutableFunctionComplexity | undefined): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(compilerSourceFile)
      const fn = {
        file,
        name: functionName(node),
        line: compilerSourceFile.getLineAndCharacterOfPosition(start).line + 1,
        complexity: 1,
      }
      functions.push(fn)
      ts.forEachChild(node, (child) => visit(child, fn))
      return
    }

    if (currentFunction !== undefined) {
      if (BRANCHING_KINDS.has(node.kind)) {
        currentFunction.complexity += 1
      }
      if (ts.isBinaryExpression(node) && isComplexityOperator(node.operatorToken.kind)) {
        currentFunction.complexity += 1
      }
    }

    ts.forEachChild(node, (child) => visit(child, currentFunction))
  }

  visit(compilerSourceFile, undefined)
  return functions
}

const isComplexityOperator = (kind: SyntaxKind): boolean =>
  kind === SyntaxKind.AmpersandAmpersandToken ||
  kind === SyntaxKind.BarBarToken ||
  kind === SyntaxKind.QuestionQuestionToken

const functionName = (fn: CompilerFunctionLike): string => {
  if (
    ts.isFunctionDeclaration(fn) ||
    ts.isMethodDeclaration(fn) ||
    ts.isFunctionExpression(fn)
  ) {
    const name = fn.name
    if (name !== undefined) return propertyNameText(name)
  }
  if (ts.isConstructorDeclaration(fn)) return "constructor"
  if (ts.isGetAccessorDeclaration(fn)) return `get ${propertyNameText(fn.name)}`
  if (ts.isSetAccessorDeclaration(fn)) return `set ${propertyNameText(fn.name)}`

  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text
  }
  if (ts.isPropertyAssignment(parent)) {
    return contextualObjectPropertyCallbackName(parent) ?? propertyNameText(parent.name)
  }
  if (ts.isExportAssignment(parent)) {
    return "<default export>"
  }
  return "<anonymous>"
}

const contextualObjectPropertyCallbackName = (
  property: ts.PropertyAssignment,
): string | undefined => {
  const objectLiteral = property.parent
  if (!ts.isObjectLiteralExpression(objectLiteral)) return undefined

  const call = objectLiteral.parent
  if (!ts.isCallExpression(call)) return undefined

  const propertyName = propertyNameText(property.name)
  const callee = callExpressionName(call)
  const owner = nearestCallbackOwnerName(call)

  if (owner !== undefined && callee !== undefined) return `${owner}/${callee}/${propertyName}`
  if (owner !== undefined) return `${owner}/${propertyName}`
  if (callee !== undefined) return `${callee}/${propertyName}`
  return undefined
}

const nearestCallbackOwnerName = (node: ts.Node): string | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined && !ts.isSourceFile(current)) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    if (ts.isPropertyAssignment(current)) {
      return propertyNameText(current.name)
    }
    if (
      (ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current) ||
        ts.isFunctionExpression(current)) &&
      current.name !== undefined
    ) {
      return propertyNameText(current.name)
    }
    current = current.parent
  }
  return undefined
}

const callExpressionName = (call: ts.CallExpression): string | undefined => {
  const expression = call.expression
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return propertyAccessName(expression)
  return undefined
}

const propertyAccessName = (node: ts.PropertyAccessExpression): string => {
  const parts: Array<string> = [node.name.text]
  let expression = node.expression
  while (ts.isPropertyAccessExpression(expression)) {
    parts.unshift(expression.name.text)
    expression = expression.expression
  }
  if (ts.isIdentifier(expression)) parts.unshift(expression.text)
  return parts.join(".")
}
