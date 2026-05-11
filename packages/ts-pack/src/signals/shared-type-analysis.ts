import {
  type ExpressionWithTypeArguments,
  type ImportTypeNode,
  Node,
  type TypeNode,
  type TypeQueryNode,
  type TypeReferenceNode,
} from "ts-morph"

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
  `${node.getSourceFile().getFilePath()}:${node.getStart()}`

export const collectTypeReferenceLikeNodes = (root: Node): ReadonlyArray<TypeReferenceLikeNode> => {
  const results: Array<TypeReferenceLikeNode> = []
  root.forEachDescendant((node) => {
    if (
      Node.isTypeReference(node) ||
      Node.isExpressionWithTypeArguments(node) ||
      Node.isImportTypeNode(node) ||
      Node.isTypeQuery(node)
    ) {
      results.push(node)
    }
  })
  return results
}

export const resolveReferenceLikeDeclarations = (
  node: TypeReferenceLikeNode,
): ReadonlyArray<Node> => {
  if (Node.isTypeReference(node)) {
    return resolveSymbolDeclarations(node.getTypeName())
  }
  if (Node.isExpressionWithTypeArguments(node)) {
    return resolveSymbolDeclarations(node.getExpression())
  }
  if (Node.isImportTypeNode(node)) {
    const qualifier = node.getQualifier()
    return qualifier === undefined ? [] : resolveSymbolDeclarations(qualifier)
  }
  return resolveSymbolDeclarations(node.getExprName())
}

export const resolveReferenceLikeName = (node: TypeReferenceLikeNode): string => {
  if (Node.isTypeReference(node)) {
    return node.getTypeName().getText()
  }
  if (Node.isExpressionWithTypeArguments(node)) {
    return node.getExpression().getText()
  }
  if (Node.isImportTypeNode(node)) {
    return node.getQualifier()?.getText() ?? node.getText()
  }
  return node.getExprName().getText()
}

const typeSyntaxDepth = (node: TypeNode | undefined): number => {
  if (node === undefined) return 0
  if (Node.isParenthesizedTypeNode(node)) {
    return typeSyntaxDepth(node.getTypeNode())
  }

  let childDepth = 0
  node.forEachChild((child) => {
    if (Node.isTypeNode(child)) {
      childDepth = Math.max(childDepth, typeSyntaxDepth(child))
      return
    }
    if (Node.isExpressionWithTypeArguments(child)) {
      childDepth = Math.max(childDepth, 1 + maxTypeArgumentDepth(child))
    }
  })

  return 1 + childDepth
}

const maxTypeArgumentDepth = (
  node: TypeReferenceNode | ExpressionWithTypeArguments | ImportTypeNode | TypeQueryNode,
): number => {
  let max = 0
  for (const typeArg of node.getTypeArguments()) {
    max = Math.max(max, typeSyntaxDepth(typeArg))
  }
  return max
}

const resolveSymbolDeclarations = (node: Node): ReadonlyArray<Node> => {
  const symbol = node.getSymbol()
  const resolved = symbol?.getAliasedSymbol() ?? symbol
  return resolved?.getDeclarations() ?? []
}
