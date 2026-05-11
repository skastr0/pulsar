import { ts } from "ts-morph"
import {
  compilerPropertyNameText as propertyNameText,
  type CompilerFunctionLike,
} from "./shared-compiler-functions.js"
import type { FunctionNameCalibrationInput } from "./ts-ld-02-model.js"

export const functionName = (fn: CompilerFunctionLike): {
  readonly name: string
  readonly callbackContext?: FunctionNameCalibrationInput
} => {
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn) || ts.isFunctionExpression(fn)) {
    const name = fn.name
    if (name !== undefined) return { name: propertyNameText(name) }
  }
  if (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) {
    const parent = fn.parent
    if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
      return { name: parent.name.text }
    }
    if (ts.isPropertyAssignment(parent)) return objectPropertyFunctionName(parent)
    if (ts.isCallExpression(parent)) return callExpressionCallbackName(parent, fn)
  }
  if (ts.isConstructorDeclaration(fn)) return { name: "<constructor>" }
  if (ts.isGetAccessorDeclaration(fn)) return { name: `<get ${propertyNameText(fn.name)}>` }
  if (ts.isSetAccessorDeclaration(fn)) return { name: `<set ${propertyNameText(fn.name)}>` }
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
  call: ts.CallExpression,
  fn: ts.ArrowFunction | ts.FunctionExpression,
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

const nearestCallbackOwnerName = (node: ts.Node): string | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined && !ts.isSourceFile(current)) {
    const name = declarationOwnerName(current)
    if (name !== undefined) return name
    current = current.parent
  }
  return undefined
}

const declarationOwnerName = (node: ts.Node): string | undefined => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if (ts.isPropertyAssignment(node)) return propertyNameText(node.name)
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node)) &&
    node.name !== undefined
  ) {
    return propertyNameText(node.name)
  }
  return undefined
}

const expressionName = (expression: ts.Expression): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) {
    const left = expressionName(expression.expression)
    return left === undefined ? expression.name.text : `${left}.${expression.name.text}`
  }
  if (ts.isCallExpression(expression)) return expressionName(expression.expression)
  return undefined
}

const effectFnLabelFromOuterCall = (call: ts.CallExpression): string | undefined => {
  const expression = call.expression
  if (!ts.isCallExpression(expression)) return undefined
  if (expressionName(expression.expression) !== "Effect.fn") return undefined
  const label = expression.arguments[0]
  return label !== undefined && ts.isStringLiteral(label) ? label.text : undefined
}
