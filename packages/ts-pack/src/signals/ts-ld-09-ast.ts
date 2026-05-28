import { ts } from "ts-morph"

export { ts }
export type { SourceFile } from "ts-morph"
import {
  type FunctionBoundaryOwner,
  isBoundaryFunctionOwner,
  isReturnTypeOwner,
} from "./ts-ld-07-boundary.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"

export const calleeName = (
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return propertyNameText(expression.name)
  return expression.getText(sourceFile).match(/\.([A-Za-z_$][A-Za-z0-9_$]*)$/u)?.[1]
}

export const expressionName = (expression: ts.Expression): string | undefined => {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return propertyNameText(expression.name)
  return undefined
}

export const nearestBoundaryOwner = (
  node: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const owner = nearestFunctionOwner(node)
  if (owner !== undefined) return isBoundaryFunctionOwner(owner, exportedNames)
  const valueName = nearestExportedValueName(node)
  return valueName !== undefined && exportedNames.has(valueName)
}

export const nearestBoundarySymbol = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined =>
  nearestFunctionName(node, sourceFile) ?? nearestExportedValueName(node)

export const nearestFunctionName = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined => {
  const owner = nearestFunctionOwner(node)
  return owner === undefined ? undefined : functionLikeName(owner, sourceFile)
}

export const functionLikeName = (
  owner: FunctionBoundaryOwner,
  sourceFile: ts.SourceFile,
): string => {
  if (ts.isFunctionDeclaration(owner) || ts.isFunctionExpression(owner)) {
    return owner.name?.text ?? nearestNamedDeclaration(owner, sourceFile) ?? "<anonymous>"
  }
  if (ts.isMethodDeclaration(owner) || ts.isMethodSignature(owner)) {
    return propertyNameText(owner.name)
  }
  if (ts.isArrowFunction(owner) || ts.isFunctionTypeNode(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<anonymous>"
  }
  if (ts.isCallSignatureDeclaration(owner)) {
    return nearestNamedDeclaration(owner, sourceFile) ?? "<call signature>"
  }
  return nearestNamedDeclaration(owner, sourceFile) ?? "<construct signature>"
}

export const isFunctionLikeNode = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node)

export const isEffectStaticCall = (expression: ts.Expression, name: string): boolean =>
  ts.isPropertyAccessExpression(expression) &&
  expressionName(expression.expression) === "Effect" &&
  propertyNameText(expression.name) === name

export const isEffectStaticReference = (expression: ts.Expression, name: string): boolean =>
  ts.isPropertyAccessExpression(expression) &&
  expressionName(expression.expression) === "Effect" &&
  propertyNameText(expression.name) === name

export const isEffectFailCall = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && isEffectStaticCall(node.expression, "fail")

export const isPromiseRejectCall = (expression: ts.Expression): boolean =>
  ts.isPropertyAccessExpression(expression) &&
  expressionName(expression.expression) === "Promise" &&
  propertyNameText(expression.name) === "reject"

export const isPipeArgument = (
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): boolean =>
  ts.isCallExpression(node.parent) &&
  node.parent.arguments.some((argument) => argument === node) &&
  calleeName(node.parent.expression, sourceFile) === "pipe"

export const positionOf = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): { readonly line: number; readonly column: number } => {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
  return {
    line: position.line + 1,
    column: position.character + 1,
  }
}

const nearestExportedValueName = (node: ts.Node): string | undefined => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
      return current.name.text
    }
    current = current.parent
  }
  return undefined
}

const nearestFunctionOwner = (node: ts.Node): FunctionBoundaryOwner | undefined => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (isReturnTypeOwner(current)) return current
    current = current.parent
  }
  return undefined
}

const nearestNamedDeclaration = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined && current !== sourceFile) {
    if (ts.isVariableDeclaration(current)) return current.name.getText(sourceFile)
    if (
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isClassDeclaration(current)
    ) {
      return current.name?.text
    }
    if (ts.isPropertyAssignment(current) || ts.isPropertySignature(current)) {
      return current.name.getText(sourceFile)
    }
    current = current.parent
  }
  return undefined
}
