import {
  CalibrationContextTag,
  type CalibrationDecision,
  type CalibrationProcessorError,
  type Diagnostic,
  type DistributionalSummary,
  type ResolvedCalibrationContext,
  type Signal,
  SignalComputeError,
  summarize,
  type TypeScriptCallbackContextNameValue,
} from "@skastr0/pulsar-core"
import { Effect, Option, Schema } from "effect"
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

type FunctionNameCalibrationInput = Omit<TypeScriptCallbackContextNameValue, "file" | "line">

type FunctionComplexityCandidate = FunctionComplexity & {
  readonly callbackContext?: FunctionNameCalibrationInput
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
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly byFile: ReadonlyMap<string, DistributionalSummary>
  readonly overThresholdCount: number
  readonly totalFunctions: number
  readonly maxComplexity: number
  readonly ratioPressure: number
  readonly maxComplexityPressure: number
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
  id: "TS-LD-01-cyclomatic-complexity",
  title: "Cyclomatic complexity",
  aliases: ["TS-LD-01"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "callback-context-calibration-v1",
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
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const candidates = yield* Effect.try({
        try: (): ReadonlyArray<FunctionComplexityCandidate> => {
          const functions: Array<FunctionComplexityCandidate> = []

          for (const sf of project.getSourceFiles()) {
            const path = sf.getFilePath()
            if (isExcluded(path, config.exclude_globs)) continue
            functions.push(...collectFunctionComplexities(sf))
          }

          return functions
        },
        catch: toSignalComputeError,
      })
      const { functions, calibrationDecisions } = yield* calibrateFunctionNames(
        candidates,
        calibration,
      ).pipe(Effect.mapError(toSignalComputeError))

      const perFileValues = new Map<string, Array<number>>()
      for (const fn of functions) {
        const bucket = perFileValues.get(fn.file) ?? []
        bucket.push(fn.complexity)
        perFileValues.set(fn.file, bucket)
      }

      const byFile = new Map<string, DistributionalSummary>()
      for (const [path, values] of perFileValues) {
        byFile.set(path, summarize(values))
      }

      const overThresholdCount = functions.filter(
        (f) => f.complexity > config.max_complexity,
      ).length
      const maxComplexity = functions.reduce(
        (max, f) => Math.max(max, f.complexity),
        0,
      )
      const ratio =
        functions.length === 0 ? 0 : overThresholdCount / functions.length
      const ratioPressure = Math.min(1, ratio * 2)
      const maxComplexityPressure =
        maxComplexity <= config.max_complexity || maxComplexity === 0
          ? 0
          : (maxComplexity - config.max_complexity) / maxComplexity

      return {
        functions,
        calibrationDecisions,
        byFile,
        overThresholdCount,
        totalFunctions: functions.length,
        maxComplexity,
        ratioPressure,
        maxComplexityPressure,
      }
    }),
  score: (out) => {
    if (out.totalFunctions === 0) return 1
    const pressure = Math.max(out.ratioPressure, out.maxComplexityPressure)
    return Math.max(0, 1 - pressure)
  },
  outputMetadata: (out) =>
    out.totalFunctions === 0 ? { applicability: "not_applicable" as const } : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const sorted = [...out.functions].sort((a, b) => b.complexity - a.complexity)
    const top = sorted.slice(0, 10)
    return top.map((f) => ({
      severity: "warn" as const,
      message: `Function \`${f.name}\` has cyclomatic complexity ${f.complexity}`,
      location: { file: f.file, line: f.line },
      data: {
        complexity: f.complexity,
        name: f.name,
        maxComplexity: out.maxComplexity,
        ratioPressure: out.ratioPressure,
        maxComplexityPressure: out.maxComplexityPressure,
      },
    }))
  },
}

const collectFunctionComplexities = (
  sourceFile: SourceFile,
): ReadonlyArray<FunctionComplexityCandidate> => {
  const compilerSourceFile = sourceFile.compilerNode
  const file = sourceFile.getFilePath()
  const functions: Array<MutableFunctionComplexity & {
    callbackContext?: FunctionNameCalibrationInput
  }> = []

  const visit = (node: ts.Node, currentFunction: MutableFunctionComplexity | undefined): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(compilerSourceFile)
      const nameInfo = functionName(node)
      const fn = {
        file,
        name: nameInfo.name,
        line: compilerSourceFile.getLineAndCharacterOfPosition(start).line + 1,
        complexity: 1,
        ...(nameInfo.callbackContext !== undefined
          ? { callbackContext: nameInfo.callbackContext }
          : {}),
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

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({ signalId: "TS-LD-01-cyclomatic-complexity", message: String(cause), cause })

const calibrateFunctionNames = (
  candidates: ReadonlyArray<FunctionComplexityCandidate>,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<
  {
    readonly functions: ReadonlyArray<FunctionComplexity>
    readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  },
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    if (Option.isNone(calibration)) {
      return {
        functions: candidates.map(stripFunctionNameCalibration),
        calibrationDecisions: [],
      }
    }

    const functions: Array<FunctionComplexity> = []
    const calibrationDecisions: Array<CalibrationDecision> = []
    for (const candidate of candidates) {
      const callbackContext = candidate.callbackContext
      if (callbackContext === undefined) {
        functions.push(stripFunctionNameCalibration(candidate))
        continue
      }

      const result = yield* calibration.value.runSlot("typescript.callback-context-namer", {
        file: candidate.file,
        line: candidate.line,
        ...callbackContext,
      })
      calibrationDecisions.push(...result.decisions)
      functions.push({
        file: candidate.file,
        line: candidate.line,
        complexity: candidate.complexity,
        name: result.value.resolvedName,
      })
    }

    return { functions, calibrationDecisions }
  })

const stripFunctionNameCalibration = (
  candidate: FunctionComplexityCandidate,
): FunctionComplexity => ({
  file: candidate.file,
  name: candidate.name,
  line: candidate.line,
  complexity: candidate.complexity,
})

const functionName = (fn: CompilerFunctionLike): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  if (
    ts.isFunctionDeclaration(fn) ||
    ts.isMethodDeclaration(fn) ||
    ts.isFunctionExpression(fn)
  ) {
    const name = fn.name
    if (name !== undefined) return { name: propertyNameText(name) }
  }
  if (ts.isConstructorDeclaration(fn)) return { name: "constructor" }
  if (ts.isGetAccessorDeclaration(fn)) return { name: `get ${propertyNameText(fn.name)}` }
  if (ts.isSetAccessorDeclaration(fn)) return { name: `set ${propertyNameText(fn.name)}` }

  const parent = fn.parent
  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return { name: parent.name.text }
  }
  if (ts.isPropertyAssignment(parent)) {
    return objectPropertyFunctionName(parent)
  }
  if (ts.isExportAssignment(parent)) {
    return { name: "<default export>" }
  }
  if ((ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && ts.isCallExpression(parent)) {
    return callExpressionCallbackName(parent, fn)
  }
  return { name: "<anonymous>" }
}

const objectPropertyFunctionName = (
  property: ts.PropertyAssignment,
): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  const objectLiteral = property.parent
  if (!ts.isObjectLiteralExpression(objectLiteral)) {
    return { name: propertyNameText(property.name) }
  }

  const call = objectLiteral.parent
  if (!ts.isCallExpression(call)) {
    return { name: propertyNameText(property.name) }
  }

  const propertyName = propertyNameText(property.name)
  const callee = callExpressionName(call)
  const owner = nearestCallbackOwnerName(call)
  const resolvedName =
    owner !== undefined && callee !== undefined
      ? `${owner}/${callee}/${propertyName}`
      : owner !== undefined
      ? `${owner}/${propertyName}`
      : callee !== undefined
      ? `${callee}/${propertyName}`
      : propertyName

  return {
    name: resolvedName,
    callbackContext: {
      fallbackName: propertyName,
      resolvedName,
      metadata: {
        ...(callee !== undefined ? { calleeText: callee } : {}),
        ...(owner !== undefined ? { ownerName: owner } : {}),
        propertyName,
      },
    },
  }
}

const callExpressionCallbackName = (
  call: ts.CallExpression,
  fn: ts.ArrowFunction | ts.FunctionExpression,
): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  const callee = callExpressionName(call)
  const owner = nearestCallbackOwnerName(call)
  const effectFnLabel = effectFnLabelFromOuterCall(call)
  const resolvedName =
    owner !== undefined && callee !== undefined
      ? `${owner}/${callee}`
      : owner !== undefined
      ? `${owner} callback`
      : callee !== undefined
      ? `${callee} callback`
      : "<anonymous>"

  return {
    name: resolvedName,
    callbackContext: {
      fallbackName: "<anonymous>",
      resolvedName,
      metadata: {
        ...(callee !== undefined ? { calleeText: callee } : {}),
        ...(owner !== undefined ? { ownerName: owner } : {}),
        ...(effectFnLabel !== undefined ? { effectFnLabel } : {}),
        argumentIndex: call.arguments.findIndex((arg) => arg === fn),
      },
    },
  }
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
  if (ts.isCallExpression(expression)) return callExpressionName(expression)
  return undefined
}

const effectFnLabelFromOuterCall = (call: ts.CallExpression): string | undefined => {
  const expression = call.expression
  if (!ts.isCallExpression(expression)) return undefined
  if (callExpressionName(expression) !== "Effect.fn") return undefined
  const label = expression.arguments[0]
  return label !== undefined && ts.isStringLiteral(label) ? label.text : undefined
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
