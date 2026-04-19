import {
  type ArrowFunction,
  type ClassDeclaration,
  type ExpressionWithTypeArguments,
  type FunctionDeclaration,
  type FunctionExpression,
  type ImportTypeNode,
  type InterfaceDeclaration,
  Node,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeNode,
  type TypeParameterDeclaration,
  type TypeQueryNode,
  type TypeReferenceNode,
  type MethodDeclaration,
} from "ts-morph"

export type GenericTrackedDeclaration =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | TypeAliasDeclaration
  | InterfaceDeclaration
  | ClassDeclaration

export type FunctionLikeDeclaration =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression

export type TypeReferenceLikeNode =
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

export const declarationName = (node: Node): string => {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isTypeAliasDeclaration(node) ||
    Node.isInterfaceDeclaration(node) ||
    Node.isClassDeclaration(node)
  ) {
    const name = node.getName?.()
    if (name !== undefined && name !== "") return name
  }

  if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) {
    const parent = node.getParent()
    if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) {
      return parent.getName()
    }
    if (Node.isExportAssignment(parent)) {
      return "<default export>"
    }
  }

  return "<anonymous>"
}

export const buildExportedDeclarationSet = (sourceFile: SourceFile): ReadonlySet<string> => {
  const ids = new Set<string>()
  for (const declarations of sourceFile.getExportedDeclarations().values()) {
    for (const declaration of declarations) {
      if (declaration.getSourceFile() !== sourceFile) continue
      ids.add(declarationKey(declaration))
    }
  }
  return ids
}

export const collectGenericTrackedDeclarations = (
  sourceFile: SourceFile,
): ReadonlyArray<GenericTrackedDeclaration> => {
  const results: Array<GenericTrackedDeclaration> = []
  sourceFile.forEachDescendant((node) => {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isTypeAliasDeclaration(node) ||
      Node.isInterfaceDeclaration(node) ||
      Node.isClassDeclaration(node)
    ) {
      results.push(node)
    }
  })
  return results
}

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

export const typeSyntaxDepth = (node: TypeNode | undefined): number => {
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

export const typeParameterIsUsedInNodes = (
  typeParameter: TypeParameterDeclaration,
  nodes: ReadonlyArray<Node | undefined>,
): boolean => {
  const targetKey = declarationKey(typeParameter)

  for (const root of nodes) {
    if (root === undefined) continue
    if (nodeRefersToDeclaration(root, targetKey)) return true

    let found = false
    root.forEachDescendant((child, traversal) => {
      if (nodeRefersToDeclaration(child, targetKey)) {
        found = true
        traversal.stop()
      }
    })

    if (found) return true
  }

  return false
}

const nodeRefersToDeclaration = (node: Node, targetKey: string): boolean => {
  const symbol = node.getSymbol()
  const resolved = symbol?.getAliasedSymbol() ?? symbol
  if (resolved === undefined) return false
  return resolved.getDeclarations().some((declaration) => declarationKey(declaration) === targetKey)
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
