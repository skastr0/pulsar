import { ancestors, textOf } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isBinaryExpression,
  isConditionalExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isIfStatement,
  isMethodDeclaration,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isSourceFile,
  type Node,
  type ObjectLiteralExpression,
  type PropertyAssignment,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import { getFunctionName, type TsFunctionLike as FnLike } from "./shared-function-index.js"

export const isEmptyBodyText = (bodyText: string): boolean => {
  const normalized = bodyText.replace(/\s+/g, " ").trim()
  return normalized === "{}" || normalized === "{ }" || normalized === "{  }"
}

export const nearestPropertyAssignment = (
  node: Node,
): PropertyAssignment | undefined => {
  for (const ancestor of [node, ...ancestors(node)]) {
    if (isPropertyAssignment(ancestor)) return ancestor
    if (isSourceFile(ancestor)) return undefined
  }
  return undefined
}

export const objectLiteralParentOfFunctionMember = (
  fn: FnLike,
): ObjectLiteralExpression | undefined => {
  if (isMethodDeclaration(fn)) {
    const parent = fn.parent
    return isObjectLiteralExpression(parent) ? parent : undefined
  }

  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return undefined
  const parent = fn.parent
  if (!isPropertyAssignment(parent)) return undefined
  const object = parent.parent
  return isObjectLiteralExpression(object) ? object : undefined
}

export const objectMemberNameForFunction = (fn: FnLike): string => {
  if (isMethodDeclaration(fn)) return propertyNameText(fn.name)
  const parent = fn.parent
  return isPropertyAssignment(parent) ? propertyNameOf(parent) : getFunctionName(fn)
}

export const objectMemberNames = (
  object: ObjectLiteralExpression,
): ReadonlySet<string> =>
  new Set(
    object.properties.flatMap((property) => {
      if (isMethodDeclaration(property)) return [propertyNameText(property.name)]
      if (isPropertyAssignment(property)) return [propertyNameOf(property)]
      if (isShorthandPropertyAssignment(property)) return [propertyNameText(property.name)]
      return []
    }),
  )

export const hasFallbackAncestor = (node: Node): boolean => {
  for (const ancestor of ancestors(node)) {
    if (isIfStatement(ancestor)) return true
    if (isConditionalExpression(ancestor)) return true
    if (isBinaryExpression(ancestor) && ancestor.operatorToken.kind === SyntaxKind.QuestionQuestionToken) return true
    if (
      isFunctionDeclaration(ancestor) ||
      isMethodDeclaration(ancestor) ||
      isArrowFunction(ancestor) ||
      isFunctionExpression(ancestor) ||
      isSourceFile(ancestor)
    ) {
      return false
    }
  }
  return false
}

export const propertyNameOf = (property: PropertyAssignment): string =>
  textOf(property.name).replace(/^["']|["']$/g, "")

export const hasOnlyIgnoredParameters = (fn: FnLike): boolean => {
  const parameters = fn.parameters
  return parameters.length > 0 && parameters.every((parameter) =>
    (isIdentifier(parameter.name) ? parameter.name.text : textOf(parameter.name)).startsWith("_"),
  )
}
