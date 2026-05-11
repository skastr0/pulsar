import { Node, type ObjectLiteralExpression, type PropertyAssignment } from "ts-morph"
import { getFunctionName, type TsFunctionLike as FnLike } from "./shared-function-index.js"

export const isEmptyBodyText = (bodyText: string): boolean => {
  const normalized = bodyText.replace(/\s+/g, " ").trim()
  return normalized === "{}" || normalized === "{ }" || normalized === "{  }"
}

export const nearestPropertyAssignment = (
  node: Node,
): PropertyAssignment | undefined => {
  for (const ancestor of [node, ...node.getAncestors()]) {
    if (Node.isPropertyAssignment(ancestor)) return ancestor
    if (Node.isSourceFile(ancestor)) return undefined
  }
  return undefined
}

export const objectLiteralParentOfFunctionMember = (
  fn: FnLike,
): ObjectLiteralExpression | undefined => {
  if (Node.isMethodDeclaration(fn)) {
    const parent = fn.getParent()
    return Node.isObjectLiteralExpression(parent) ? parent : undefined
  }

  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return undefined
  const parent = fn.getParent()
  if (!Node.isPropertyAssignment(parent)) return undefined
  const object = parent.getParent()
  return Node.isObjectLiteralExpression(object) ? object : undefined
}

export const objectMemberNameForFunction = (fn: FnLike): string => {
  if (Node.isMethodDeclaration(fn)) return fn.getName()
  const parent = fn.getParent()
  return Node.isPropertyAssignment(parent) ? propertyNameOf(parent) : getFunctionName(fn)
}

export const objectMemberNames = (
  object: ObjectLiteralExpression,
): ReadonlySet<string> =>
  new Set(
    object.getProperties().flatMap((property) => {
      if (Node.isMethodDeclaration(property)) return [property.getName()]
      if (Node.isPropertyAssignment(property)) return [propertyNameOf(property)]
      if (Node.isShorthandPropertyAssignment(property)) return [property.getName()]
      return []
    }),
  )

export const hasFallbackAncestor = (node: Node): boolean => {
  for (const ancestor of node.getAncestors()) {
    if (Node.isIfStatement(ancestor)) return true
    if (Node.isConditionalExpression(ancestor)) return true
    if (Node.isBinaryExpression(ancestor) && ancestor.getOperatorToken().getText() === "??") return true
    if (
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isArrowFunction(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isSourceFile(ancestor)
    ) {
      return false
    }
  }
  return false
}

export const propertyNameOf = (property: PropertyAssignment): string => {
  return property.getNameNode().getText().replace(/^["']|["']$/g, "")
}

export const hasOnlyIgnoredParameters = (fn: FnLike): boolean => {
  const parameters = fn.getParameters()
  return parameters.length > 0 && parameters.every((parameter) => parameter.getName().startsWith("_"))
}
