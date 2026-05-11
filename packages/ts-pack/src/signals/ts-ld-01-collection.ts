import type { TypeScriptCallbackContextNameValue } from "@skastr0/pulsar-core"
import {
  type SourceFile,
  SyntaxKind,
  ts,
} from "ts-morph"
import type { FunctionComplexity } from "./ts-ld-01-complexity.js"
import {
  compilerPropertyNameText as propertyNameText,
  isCompilerFunctionLike,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"

type MutableFunctionComplexity = {
  file: string
  name: string
  line: number
  complexity: number
}

type FunctionNameCalibrationInput = Omit<TypeScriptCallbackContextNameValue, "file" | "line">

export type FunctionComplexityCandidate = FunctionComplexity & {
  readonly callbackContext?: FunctionNameCalibrationInput
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

export const collectFunctionComplexities = (
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
