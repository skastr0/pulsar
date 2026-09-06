import { hasModifier } from "../ast.js"
import {
  SyntaxKind,
  isAsExpression,
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isFunctionDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isNamedExports,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isReturnStatement,
  isVariableDeclaration,
  isTypeAliasDeclaration,
  isVariableStatement,
  isArrowFunction,
  isBlock,
  isCallSignatureDeclaration,
  isConstructSignatureDeclaration,
  isFunctionExpression,
  isFunctionTypeNode,
  isMethodDeclaration,
  isMethodSignature,
  isParameter,
  isPropertyDeclaration,
  isSourceFile,
  type ArrowFunction,
  type CallSignatureDeclaration,
  type ClassDeclaration,
  type ConstructSignatureDeclaration,
  type EnumDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type FunctionTypeNode,
  type InterfaceDeclaration,
  type MethodDeclaration,
  type MethodSignature,
  type Node,
  type SourceFile,
  type TypeAliasDeclaration,
} from "../tsgo-api.js"

type BoundaryDeclaration =
  | FunctionDeclaration
  | ClassDeclaration
  | InterfaceDeclaration
  | TypeAliasDeclaration
  | EnumDeclaration

type ReturnTypeOwner =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | FunctionTypeNode
  | MethodSignature
  | CallSignatureDeclaration
  | ConstructSignatureDeclaration

export type FunctionBoundaryOwner = ReturnTypeOwner

export const collectLocalExportedNames = (sourceFile: SourceFile): ReadonlySet<string> => {
  const names = new Set<string>()

  for (const statement of sourceFile.statements) {
    const name = topLevelDeclarationName(statement)
    if (
      name !== undefined &&
      (hasModifier(statement, SyntaxKind.ExportKeyword) ||
        hasModifier(statement, SyntaxKind.DefaultKeyword))
    ) {
      names.add(name)
      continue
    }

    if (isVariableStatement(statement) && hasModifier(statement, SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
      continue
    }

    if (
      isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text)
      }
    }

    if (isExportAssignment(statement) && isIdentifier(statement.expression)) {
      names.add(statement.expression.text)
    }
  }

  return names
}

export const isReturnTypeOwner = (node: Node): node is ReturnTypeOwner =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node) ||
  isFunctionTypeNode(node) ||
  isMethodSignature(node) ||
  isCallSignatureDeclaration(node) ||
  isConstructSignatureDeclaration(node)

export const isBoundaryParameter = (
  parameter: ParameterDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const owner = parameter.parent
  if (isFunctionBoundaryOwner(owner)) return isBoundaryFunctionOwner(owner, exportedNames)
  return isWithinExportedTypeSurface(parameter, exportedNames)
}

export const isBoundaryFunctionOwner = (
  owner: FunctionBoundaryOwner,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (isFunctionDeclaration(owner)) {
    return isBoundaryDeclaration(owner, exportedNames)
  }

  if (isMethodDeclaration(owner)) {
    if (isObjectLiteralExpression(owner.parent)) {
      return isWithinExportedObjectLiteralSurface(owner, exportedNames)
    }
    return (
      isPublicClassMember(owner) &&
      isClassDeclaration(owner.parent) &&
      isBoundaryClass(owner.parent, exportedNames)
    )
  }

  if (isArrowFunction(owner) || isFunctionExpression(owner)) {
    const parent = owner.parent
    if (isVariableDeclaration(parent)) return isBoundaryVariable(parent, exportedNames)
    if (isPropertyAssignment(parent)) {
      return (
        isWithinExportedTypeSurface(parent, exportedNames) ||
        isWithinExportedObjectLiteralSurface(parent, exportedNames)
      )
    }
    return isExportAssignment(parent)
  }

  return (
    isWithinExportedTypeSurface(owner, exportedNames) ||
    isWithinExportedValueTypeSurface(owner, exportedNames) ||
    isWithinBoundaryFunctionTypeSurface(owner, exportedNames)
  )
}

export const isBoundaryProperty = (
  property: PropertyDeclaration | PropertySignature,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (isPropertyDeclaration(property)) {
    return (
      isPublicClassMember(property) &&
      isClassDeclaration(property.parent) &&
      isBoundaryClass(property.parent, exportedNames)
    )
  }
  return (
    isWithinExportedTypeSurface(property, exportedNames) ||
    isWithinExportedValueTypeSurface(property, exportedNames) ||
    isWithinBoundaryFunctionTypeSurface(property, exportedNames)
  )
}

export const isBoundaryAssertion = (
  assertion: Node,
  exportedNames: ReadonlySet<string>,
): boolean =>
  isBoundaryVariableInitializerAssertion(assertion, exportedNames) ||
  isBoundaryReturnAssertion(assertion, exportedNames) ||
  isBoundaryObjectPropertyAssertion(assertion, exportedNames) ||
  isExportAssignment(assertion.parent)

export const isBoundaryVariable = (
  declaration: VariableDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (!isIdentifier(declaration.name)) return false
  const statement = declaration.parent.parent
  return (
    isVariableStatement(statement) &&
    (hasModifier(statement, SyntaxKind.ExportKeyword) ||
      (exportedNames.has(declaration.name.text) && isTopLevelVariableDeclaration(declaration)))
  )
}

export const isBoundaryDeclaration = (
  node: BoundaryDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (
    hasModifier(node, SyntaxKind.ExportKeyword) ||
    hasModifier(node, SyntaxKind.DefaultKeyword)
  ) {
    return true
  }
  return isSourceFile(node.parent) && node.name !== undefined && exportedNames.has(node.name.text)
}

export const isWithinExportedTypeSurface = (
  node: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: Node | undefined = node
  while (current !== undefined) {
    if (
      isTypeAliasDeclaration(current) ||
      isInterfaceDeclaration(current) ||
      isClassDeclaration(current)
    ) {
      return isBoundaryDeclaration(current, exportedNames)
    }
    current = current.parent
  }
  return false
}

const topLevelDeclarationName = (node: Node): string | undefined => {
  if (
    isFunctionDeclaration(node) ||
    isClassDeclaration(node) ||
    isInterfaceDeclaration(node) ||
    isTypeAliasDeclaration(node) ||
    isEnumDeclaration(node)
  ) {
    return node.name?.text
  }
  return undefined
}

const isFunctionBoundaryOwner = (node: Node): node is FunctionBoundaryOwner =>
  isReturnTypeOwner(node)

const isBoundaryClass = (
  node: ClassDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => isBoundaryDeclaration(node, exportedNames)

const isWithinExportedObjectLiteralSurface = (
  node: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: Node | undefined = node
  while (current !== undefined) {
    if (
      isObjectLiteralExpression(current) &&
      objectLiteralHasBoundaryVariableRoot(current, exportedNames)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

const isWithinExportedValueTypeSurface = (
  node: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: Node | undefined = node
  while (current !== undefined) {
    const parent: Node | undefined = current.parent
    if (
      parent !== undefined &&
      isVariableDeclaration(parent) &&
      parent.type !== undefined &&
      isAncestorOf(parent.type, node)
    ) {
      return isBoundaryVariable(parent, exportedNames)
    }
    current = parent
  }
  return false
}

const isWithinBoundaryFunctionTypeSurface = (
  node: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: Node | undefined = node
  while (current !== undefined) {
    const parent: Node | undefined = current.parent
    if (
      parent !== undefined &&
      isParameter(parent) &&
      parent.type !== undefined &&
      isAncestorOf(parent.type, node)
    ) {
      return isBoundaryParameter(parent, exportedNames)
    }
    if (
      parent !== undefined &&
      isRuntimeFunctionWithReturnType(parent) &&
      parent.type !== undefined &&
      isAncestorOf(parent.type, node)
    ) {
      return isBoundaryFunctionOwner(parent, exportedNames)
    }
    current = parent
  }
  return false
}

const objectLiteralHasBoundaryVariableRoot = (
  node: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: Node = node
  while (current.parent !== undefined) {
    const parent = current.parent
    if (isVariableDeclaration(parent)) {
      return parent.initializer === current && isBoundaryVariable(parent, exportedNames)
    }
    if (isPropertyAssignment(parent) && isObjectLiteralExpression(parent.parent)) {
      current = parent.parent
      continue
    }
    return false
  }
  return false
}

const isBoundaryVariableInitializerAssertion = (
  assertion: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const variable = nearestAncestor(assertion, isVariableDeclaration)
  return (
    variable !== undefined &&
    variable.type === undefined &&
    variable.initializer !== undefined &&
    isAncestorOf(variable.initializer, assertion) &&
    isBoundaryVariable(variable, exportedNames)
  )
}

const isBoundaryReturnAssertion = (
  assertion: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const returnStatement = nearestAncestor(assertion, isReturnStatement)
  if (
    returnStatement === undefined ||
    returnStatement.expression === undefined ||
    !isAncestorOf(returnStatement.expression, assertion)
  ) {
    return isBoundaryConciseArrowReturnAssertion(assertion, exportedNames)
  }
  const owner = nearestFunctionBodyOwner(returnStatement)
  return (
    owner !== undefined &&
    functionReturnIsInferred(owner) &&
    isBoundaryFunctionOwner(owner, exportedNames)
  )
}

const isBoundaryConciseArrowReturnAssertion = (
  assertion: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const arrow = nearestAncestor(assertion, isArrowFunction)
  return (
    arrow !== undefined &&
    !isBlock(arrow.body) &&
    isAncestorOf(arrow.body, assertion) &&
    functionReturnIsInferred(arrow) &&
    isBoundaryFunctionOwner(arrow, exportedNames)
  )
}

const isBoundaryObjectPropertyAssertion = (
  assertion: Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const property = nearestAncestor(assertion, isPropertyAssignment)
  return (
    property !== undefined &&
    property.initializer !== undefined &&
    isAncestorOf(property.initializer, assertion) &&
    !objectLiteralHasEnclosingVariableType(property.parent) &&
    isWithinExportedObjectLiteralSurface(property, exportedNames)
  )
}

const isPublicClassMember = (node: Node): boolean =>
  !hasModifier(node, SyntaxKind.PrivateKeyword) &&
  !hasModifier(node, SyntaxKind.ProtectedKeyword)

const isTopLevelVariableDeclaration = (node: VariableDeclaration): boolean => {
  const statement = node.parent.parent
  return isVariableStatement(statement) && isSourceFile(statement.parent)
}

const isRuntimeFunctionWithReturnType = (
  node: Node,
): node is FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node)

const nearestFunctionBodyOwner = (
  node: Node,
): FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression | undefined =>
  nearestAncestor(node, isRuntimeFunctionWithReturnType)

const functionReturnIsInferred = (
  node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression,
): boolean =>
  node.type === undefined &&
  !hasVariableFunctionTypeAnnotation(node) &&
  !hasContextuallyTypedObjectLiteralAncestor(node)

const hasVariableFunctionTypeAnnotation = (
  node: FunctionDeclaration | MethodDeclaration | ArrowFunction | FunctionExpression,
): boolean => {
  const parent = node.parent
  return isVariableDeclaration(parent) && parent.type !== undefined
}

const hasContextuallyTypedObjectLiteralAncestor = (node: Node): boolean => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (
      isObjectLiteralExpression(current) &&
      objectLiteralHasEnclosingVariableType(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

const objectLiteralHasEnclosingVariableType = (node: Node): boolean => {
  let current: Node = node
  while (current.parent !== undefined) {
    if (isVariableDeclaration(current.parent)) {
      return current.parent.initializer === current && current.parent.type !== undefined
    }
    current = current.parent
  }
  return false
}

const nearestAncestor = <T extends Node>(
  node: Node,
  predicate: (candidate: Node) => candidate is T,
): T | undefined => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (predicate(current)) return current
    current = current.parent
  }
  return undefined
}

const isAncestorOf = (ancestor: Node, node: Node): boolean => {
  let current: Node | undefined = node
  while (current !== undefined) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}
