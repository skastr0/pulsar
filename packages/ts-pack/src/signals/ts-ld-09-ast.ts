import { textOf } from "../ast.js"
import {
  isArrowFunction,
  isCallExpression,
  isCallSignatureDeclaration,
  isClassDeclaration,
  isConstructorDeclaration,
  isFunctionDeclaration,
  isFunctionExpression,
  isFunctionTypeNode,
  isGetAccessorDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isMethodSignature,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertySignature,
  isSetAccessorDeclaration,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import {
  type FunctionBoundaryOwner,
  isBoundaryFunctionOwner,
  isReturnTypeOwner,
} from "./ts-ld-07-boundary.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"

export const calleeName = (
  expression: Node,
  sourceFile: SourceFile,
): string | undefined => {
  if (isIdentifier(expression)) return expression.text
  if (isPropertyAccessExpression(expression)) return propertyNameText(expression.name)
  return textOf(expression, sourceFile).match(/\.([A-Za-z_$][A-Za-z0-9_$]*)$/u)?.[1]
}

export const expressionName = (expression: Node): string | undefined => {
  if (isIdentifier(expression)) return expression.text
  if (isPropertyAccessExpression(expression)) return propertyNameText(expression.name)
  return undefined
}

export const nearestBoundaryOwner = (
  node: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const owner = nearestFunctionOwner(node)
  if (owner !== undefined) return isBoundaryFunctionOwner(owner, exportedNames)
  const valueName = nearestExportedValueName(node)
  return valueName !== undefined && exportedNames.has(valueName)
}

export const nearestBoundarySymbol = (
  node: Node,
  sourceFile: SourceFile,
): string | undefined =>
  nearestFunctionName(node, sourceFile) ?? nearestExportedValueName(node)

export const nearestFunctionName = (
  node: Node,
  sourceFile: SourceFile,
): string | undefined => {
  const owner = nearestFunctionOwner(node)
  return owner === undefined ? undefined : functionLikeName(owner, sourceFile)
}

export const functionLikeName = (
  owner: FunctionBoundaryOwner,
  sourceFile: SourceFile,
): string => {
  if (isFunctionDeclaration(owner) || isFunctionExpression(owner)) {
    return owner.name?.text ?? nearestNamedDeclaration(owner, sourceFile) ?? "<anonymous>"
  }
  if (isMethodDeclaration(owner) || isMethodSignature(owner)) {
    return propertyNameText(owner.name)
  }
  if (isArrowFunction(owner) || isFunctionTypeNode(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<anonymous>"
  }
  if (isCallSignatureDeclaration(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<call signature>"
  }
  return nearestNamedDeclaration(owner, sourceFile) ?? "<construct signature>"
}

export const isFunctionLikeNode = (node: Node): boolean =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node) ||
  isConstructorDeclaration(node) ||
  isGetAccessorDeclaration(node) ||
  isSetAccessorDeclaration(node)

export const isEffectStaticCall = (expression: Node, name: string): boolean =>
  isPropertyAccessExpression(expression) &&
  expressionName(expression.expression) === "Effect" &&
  propertyNameText(expression.name) === name

export const isEffectStaticReference = (expression: Node, name: string): boolean =>
  isPropertyAccessExpression(expression) &&
  expressionName(expression.expression) === "Effect" &&
  propertyNameText(expression.name) === name

export const isEffectFailCall = (node: Node): boolean =>
  isCallExpression(node) && isEffectStaticCall(node.expression, "fail")

export const isPromiseRejectCall = (expression: Node): boolean =>
  isPropertyAccessExpression(expression) &&
  expressionName(expression.expression) === "Promise" &&
  propertyNameText(expression.name) === "reject"

export const isPipeArgument = (
  node: import("../tsgo-api.js").CallExpression,
  sourceFile: SourceFile,
): boolean =>
  isCallExpression(node.parent) &&
  node.parent.arguments.some((argument) => argument === node) &&
  calleeName(node.parent.expression, sourceFile) === "pipe"

export const positionOf = (
  node: Node,
  sourceFile: SourceFile,
): { readonly line: number; readonly column: number } => {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    line: position.line + 1,
    column: position.character + 1,
  }
}

const nearestExportedValueName = (node: Node): string | undefined => {
  let current: Node | undefined = node
  while (current !== undefined) {
    if (isVariableDeclaration(current) && isIdentifier(current.name)) {
      return current.name.text
    }
    current = current.parent
  }
  return undefined
}

const nearestFunctionOwner = (node: Node): FunctionBoundaryOwner | undefined => {
  let current: Node | undefined = node
  while (current !== undefined) {
    if (isReturnTypeOwner(current)) return current
    current = current.parent
  }
  return undefined
}

const nearestNamedDeclaration = (
  node: Node,
  sourceFile: SourceFile,
): string | undefined => {
  let current: Node | undefined = node.parent
  while (current !== undefined && current !== sourceFile) {
    if (isVariableDeclaration(current)) return textOf(current.name, sourceFile)
    if (
      isTypeAliasDeclaration(current) ||
      isInterfaceDeclaration(current) ||
      isClassDeclaration(current)
    ) {
      return current.name === undefined ? undefined : (isIdentifier(current.name) ? current.name.text : textOf(current.name))
    }
    if (isPropertyAssignment(current) || isPropertySignature(current)) {
      return textOf(current.name, sourceFile)
    }
    current = current.parent
  }
  return undefined
}
