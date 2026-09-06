import { textOf, walkDescendants } from "../ast.js"
import {
  isExpressionWithTypeArguments,
  isImportTypeNode,
  isParenthesizedTypeNode,
  isTypeNode,
  isTypeQueryNode,
  isTypeReferenceNode,
  type ExpressionWithTypeArguments,
  type ImportTypeNode,
  type Node,
  type TypeNode,
  type TypeQueryNode,
  type TypeReferenceNode,
} from "../tsgo-api.js"

type TypeReferenceLikeNode =
  | TypeReferenceNode
  | ExpressionWithTypeArguments
  | ImportTypeNode
  | TypeQueryNode

export const STANDARD_UTILITY_TYPE_ALIASES: ReadonlySet<string> = new Set([
  "Awaited",
  "ConstructorParameters",
  "Exclude",
  "Extract",
  "InstanceType",
  "Lowercase",
  "NoInfer",
  "NonNullable",
  "Omit",
  "OmitThisParameter",
  "Parameters",
  "Partial",
  "Pick",
  "Readonly",
  "Record",
  "Required",
  "ReturnType",
  "ThisParameterType",
  "ThisType",
  "Uppercase",
  "Capitalize",
  "Uncapitalize",
])

export const declarationKey = (node: Node): string =>
  `${node.getSourceFile().fileName}:${node.getStart(node.getSourceFile())}`

export const collectTypeReferenceLikeNodes = (root: Node): ReadonlyArray<TypeReferenceLikeNode> => {
  const results: Array<TypeReferenceLikeNode> = []
  walkDescendants(root, (node) => {
    if (
      isTypeReferenceNode(node) ||
      isExpressionWithTypeArguments(node) ||
      isImportTypeNode(node) ||
      isTypeQueryNode(node)
    ) {
      results.push(node)
    }
  })
  return results
}

export const resolveReferenceLikeDeclarations = (
  _node: TypeReferenceLikeNode,
): ReadonlyArray<Node> => []

export const resolveReferenceLikeName = (node: TypeReferenceLikeNode): string => {
  if (isTypeReferenceNode(node)) {
    return textOf(node.typeName)
  }
  if (isExpressionWithTypeArguments(node)) {
    return textOf(node.expression)
  }
  if (isImportTypeNode(node)) {
    return node.qualifier === undefined ? textOf(node) : textOf(node.qualifier)
  }
  return textOf(node.exprName)
}

export const typeSyntaxDepth = (node: TypeNode | undefined): number => {
  if (node === undefined) return 0
  if (isParenthesizedTypeNode(node)) {
    return typeSyntaxDepth(node.type)
  }

  let childDepth = 0
  node.forEachChild((child) => {
    if (isTypeNode(child)) {
      childDepth = Math.max(childDepth, typeSyntaxDepth(child))
      return
    }
    if (isExpressionWithTypeArguments(child)) {
      childDepth = Math.max(childDepth, 1 + maxTypeArgumentDepth(child))
    }
  })

  return 1 + childDepth
}

const maxTypeArgumentDepth = (
  node: TypeReferenceNode | ExpressionWithTypeArguments | ImportTypeNode | TypeQueryNode,
): number => {
  let max = 0
  for (const typeArg of node.typeArguments ?? []) {
    max = Math.max(max, typeSyntaxDepth(typeArg))
  }
  return max
}
