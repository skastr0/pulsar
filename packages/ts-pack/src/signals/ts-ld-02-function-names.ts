import {
  compilerPropertyNameText as propertyNameText,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"
import type { FunctionNameCalibrationInput } from "./ts-ld-02-model.js"
import {
  isArrowFunction,
  isCallExpression,
  isConstructorDeclaration,
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
  type PropertyAssignment,
} from "../tsgo-api.js"

export const functionName = (fn: CompilerFunctionLike): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  if (isFunctionDeclaration(fn) || isMethodDeclaration(fn) || isFunctionExpression(fn)) {
    const name = fn.name
    if (name !== undefined) return { name: propertyNameText(name) }
  }
  if (isArrowFunction(fn) || isFunctionExpression(fn)) {
    const parent = fn.parent
    if (isVariableDeclaration(parent) && isIdentifier(parent.name)) {
      return { name: parent.name.text }
    }
    if (isPropertyAssignment(parent)) return objectPropertyFunctionName(parent)
    if (isCallExpression(parent)) return callExpressionCallbackName(parent, fn)
  }
  if (isConstructorDeclaration(fn)) return { name: "<constructor>" }
  if (isGetAccessorDeclaration(fn)) return { name: `<get ${propertyNameText(fn.name)}>` }
  if (isSetAccessorDeclaration(fn)) return { name: `<set ${propertyNameText(fn.name)}>` }
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
  const callee = expressionName(call.expression)
  const owner = nearestCallbackOwnerName(call)
  const resolvedName = propertyCallbackName(owner, callee, propertyName)

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
  const callee = expressionName(call.expression)
  const owner = nearestCallbackOwnerName(call)
  const effectFnLabel = effectFnLabelFromOuterCall(call)
  const resolvedName = callCallbackName(owner, callee)

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

const propertyCallbackName = (
  owner: string | undefined,
  callee: string | undefined,
  propertyName: string,
): string => {
  if (owner !== undefined && callee !== undefined) return `${owner}/${callee}/${propertyName}`
  if (owner !== undefined) return `${owner}/${propertyName}`
  if (callee !== undefined) return `${callee}/${propertyName}`
  return propertyName
}

const callCallbackName = (owner: string | undefined, callee: string | undefined): string => {
  if (owner !== undefined && callee !== undefined) return `${owner}/${callee}`
  if (owner !== undefined) return `${owner} callback`
  if (callee !== undefined) return `${callee} callback`
  return "<anonymous>"
}

const nearestCallbackOwnerName = (node: Node): string | undefined => {
  let current: Node | undefined = node.parent
  while (current !== undefined && !isSourceFile(current)) {
    const name = declarationOwnerName(current)
    if (name !== undefined) return name
    current = current.parent
  }
  return undefined
}

const declarationOwnerName = (node: Node): string | undefined => {
  if (isVariableDeclaration(node) && isIdentifier(node.name)) return node.name.text
  if (isPropertyAssignment(node)) return propertyNameText(node.name)
  if (
    (isFunctionDeclaration(node) ||
      isMethodDeclaration(node) ||
      isFunctionExpression(node)) &&
    node.name !== undefined
  ) {
    return propertyNameText(node.name)
  }
  return undefined
}

const expressionName = (expression: Node): string | undefined => {
  if (isIdentifier(expression)) return expression.text
  if (isPropertyAccessExpression(expression)) {
    const left = expressionName(expression.expression)
    return left === undefined ? expression.name.text : `${left}.${expression.name.text}`
  }
  if (isCallExpression(expression)) return expressionName(expression.expression)
  return undefined
}

const effectFnLabelFromOuterCall = (call: CallExpression): string | undefined => {
  const expression = call.expression
  if (!isCallExpression(expression)) return undefined
  if (expressionName(expression.expression) !== "Effect.fn") return undefined
  const label = expression.arguments[0]
  return label !== undefined && isStringLiteral(label) ? label.text : undefined
}
