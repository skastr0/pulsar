import type { TypeScriptCallbackContextNameValue } from "@skastr0/pulsar-core/calibration"
import type { FunctionComplexity } from "./ts-ld-01-complexity.js"
import {
  compilerPropertyNameText as propertyNameText,
  isCompilerFunctionLike,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"
import {
  SyntaxKind,
  isArrowFunction,
  isBinaryExpression,
  isCallExpression,
  isConstructorDeclaration,
  isExportAssignment,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isSetAccessorDeclaration,
  isSourceFile,
  isStringLiteral,
  isVariableDeclaration,
  type ArrowFunction,
  type CallExpression,
  type FunctionExpression,
  type Node,
  type PropertyAccessExpression,
  type PropertyAssignment,
  type SourceFile,
} from "../tsgo-api.js"

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
  const file = sourceFile.fileName
  const functions: Array<MutableFunctionComplexity & {
    callbackContext?: FunctionNameCalibrationInput
  }> = []

  const visit = (node: Node, currentFunction: MutableFunctionComplexity | undefined): void => {
    if (isCompilerFunctionLike(node)) {
      const start = node.getStart(sourceFile)
      const nameInfo = functionName(node)
      const fn = {
        file,
        name: nameInfo.name,
        line: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
        complexity: 1,
        ...(nameInfo.callbackContext !== undefined
          ? { callbackContext: nameInfo.callbackContext }
          : {}),
      }
      functions.push(fn)
      node.forEachChild((child) => visit(child, fn))
      return
    }

    if (currentFunction !== undefined) {
      if (BRANCHING_KINDS.has(node.kind)) {
        currentFunction.complexity += 1
      }
      if (isBinaryExpression(node) && isComplexityOperator(node.operatorToken.kind)) {
        currentFunction.complexity += 1
      }
    }

    node.forEachChild((child) => visit(child, currentFunction))
  }

  visit(sourceFile, undefined)
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
    isFunctionDeclaration(fn) ||
    isMethodDeclaration(fn) ||
    isFunctionExpression(fn)
  ) {
    const name = fn.name
    if (name !== undefined) return { name: propertyNameText(name) }
  }
  if (isConstructorDeclaration(fn)) return { name: "constructor" }
  if (isGetAccessorDeclaration(fn)) return { name: `get ${propertyNameText(fn.name)}` }
  if (isSetAccessorDeclaration(fn)) return { name: `set ${propertyNameText(fn.name)}` }

  const parent = fn.parent
  if (isVariableDeclaration(parent) && isIdentifier(parent.name)) {
    return { name: parent.name.text }
  }
  if (isPropertyAssignment(parent)) {
    return objectPropertyFunctionName(parent)
  }
  if (isExportAssignment(parent)) {
    return { name: "<default export>" }
  }
  if ((isArrowFunction(fn) || isFunctionExpression(fn)) && isCallExpression(parent)) {
    return callExpressionCallbackName(parent, fn)
  }
  return { name: "<anonymous>" }
}

const objectPropertyFunctionName = (
  property: PropertyAssignment,
): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  const objectLiteral = property.parent
  if (!isObjectLiteralExpression(objectLiteral)) {
    return { name: propertyNameText(property.name) }
  }

  const call = objectLiteral.parent
  if (!isCallExpression(call)) {
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
  call: CallExpression,
  fn: ArrowFunction | FunctionExpression,
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

const nearestCallbackOwnerName = (node: Node): string | undefined => {
  let current: Node | undefined = node.parent
  while (current !== undefined && !isSourceFile(current)) {
    if (isVariableDeclaration(current) && isIdentifier(current.name)) {
      return current.name.text
    }
    if (isPropertyAssignment(current)) {
      return propertyNameText(current.name)
    }
    if (
      (isFunctionDeclaration(current) ||
        isMethodDeclaration(current) ||
        isFunctionExpression(current)) &&
      current.name !== undefined
    ) {
      return propertyNameText(current.name)
    }
    current = current.parent
  }
  return undefined
}

const callExpressionName = (call: CallExpression): string | undefined => {
  const expression = call.expression
  if (isIdentifier(expression)) return expression.text
  if (isPropertyAccessExpression(expression)) return propertyAccessName(expression)
  if (isCallExpression(expression)) return callExpressionName(expression)
  return undefined
}

const effectFnLabelFromOuterCall = (call: CallExpression): string | undefined => {
  const expression = call.expression
  if (!isCallExpression(expression)) return undefined
  if (callExpressionName(expression) !== "Effect.fn") return undefined
  const label = expression.arguments[0]
  return label !== undefined && isStringLiteral(label) ? label.text : undefined
}

const propertyAccessName = (node: PropertyAccessExpression): string => {
  const parts: Array<string> = [node.name.text]
  let expression = node.expression
  while (isPropertyAccessExpression(expression)) {
    parts.unshift(expression.name.text)
    expression = expression.expression
  }
  if (isIdentifier(expression)) parts.unshift(expression.text)
  return parts.join(".")
}
