import { ts } from "ts-morph"

type BoundaryDeclaration =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration

type ReturnTypeOwner =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionTypeNode
  | ts.MethodSignature
  | ts.CallSignatureDeclaration
  | ts.ConstructSignatureDeclaration

export type FunctionBoundaryOwner = ReturnTypeOwner

export const collectLocalExportedNames = (sourceFile: ts.SourceFile): ReadonlySet<string> => {
  const names = new Set<string>()

  for (const statement of sourceFile.statements) {
    const name = topLevelDeclarationName(statement)
    if (
      name !== undefined &&
      (hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
        hasModifier(statement, ts.SyntaxKind.DefaultKeyword))
    ) {
      names.add(name)
      continue
    }

    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
      }
      continue
    }

    if (
      ts.isExportDeclaration(statement) &&
      statement.moduleSpecifier === undefined &&
      statement.exportClause !== undefined &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (const element of statement.exportClause.elements) {
        names.add((element.propertyName ?? element.name).text)
      }
    }

    if (ts.isExportAssignment(statement) && ts.isIdentifier(statement.expression)) {
      names.add(statement.expression.text)
    }
  }

  return names
}

export const isReturnTypeOwner = (node: ts.Node): node is ReturnTypeOwner =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node) ||
  ts.isFunctionTypeNode(node) ||
  ts.isMethodSignature(node) ||
  ts.isCallSignatureDeclaration(node) ||
  ts.isConstructSignatureDeclaration(node)

export const isBoundaryParameter = (
  parameter: ts.ParameterDeclaration,
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
  if (ts.isFunctionDeclaration(owner)) {
    return isBoundaryDeclaration(owner, exportedNames)
  }

  if (ts.isMethodDeclaration(owner)) {
    if (ts.isObjectLiteralExpression(owner.parent)) {
      return isWithinExportedObjectLiteralSurface(owner, exportedNames)
    }
    return (
      isPublicClassMember(owner) &&
      ts.isClassDeclaration(owner.parent) &&
      isBoundaryClass(owner.parent, exportedNames)
    )
  }

  if (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) {
    const parent = owner.parent
    if (ts.isVariableDeclaration(parent)) return isBoundaryVariable(parent, exportedNames)
    if (ts.isPropertyAssignment(parent)) {
      return (
        isWithinExportedTypeSurface(parent, exportedNames) ||
        isWithinExportedObjectLiteralSurface(parent, exportedNames)
      )
    }
    return ts.isExportAssignment(parent)
  }

  return (
    isWithinExportedTypeSurface(owner, exportedNames) ||
    isWithinExportedValueTypeSurface(owner, exportedNames) ||
    isWithinBoundaryFunctionTypeSurface(owner, exportedNames)
  )
}

export const isBoundaryProperty = (
  property: ts.PropertyDeclaration | ts.PropertySignature,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (ts.isPropertyDeclaration(property)) {
    return (
      isPublicClassMember(property) &&
      ts.isClassDeclaration(property.parent) &&
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
  assertion: ts.AsExpression | ts.TypeAssertion,
  exportedNames: ReadonlySet<string>,
): boolean =>
  isBoundaryVariableInitializerAssertion(assertion, exportedNames) ||
  isBoundaryReturnAssertion(assertion, exportedNames) ||
  isBoundaryObjectPropertyAssertion(assertion, exportedNames) ||
  ts.isExportAssignment(assertion.parent)

export const isBoundaryVariable = (
  declaration: ts.VariableDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (!ts.isIdentifier(declaration.name)) return false
  const statement = declaration.parent.parent
  return (
    ts.isVariableStatement(statement) &&
    (hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      (exportedNames.has(declaration.name.text) && isTopLevelVariableDeclaration(declaration)))
  )
}

export const isBoundaryDeclaration = (
  node: BoundaryDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (
    hasModifier(node, ts.SyntaxKind.ExportKeyword) ||
    hasModifier(node, ts.SyntaxKind.DefaultKeyword)
  ) {
    return true
  }
  return ts.isSourceFile(node.parent) && node.name !== undefined && exportedNames.has(node.name.text)
}

export const isWithinExportedTypeSurface = (
  node: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (
      ts.isTypeAliasDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isClassDeclaration(current)
    ) {
      return isBoundaryDeclaration(current, exportedNames)
    }
    current = current.parent
  }
  return false
}

const topLevelDeclarationName = (node: ts.Node): string | undefined => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  ) {
    return node.name?.text
  }
  return undefined
}

const isFunctionBoundaryOwner = (node: ts.Node): node is FunctionBoundaryOwner =>
  isReturnTypeOwner(node)

const isBoundaryClass = (
  node: ts.ClassDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => isBoundaryDeclaration(node, exportedNames)

const isWithinExportedObjectLiteralSurface = (
  node: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (
      ts.isObjectLiteralExpression(current) &&
      objectLiteralHasBoundaryVariableRoot(current, exportedNames)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

const isWithinExportedValueTypeSurface = (
  node: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    const parent: ts.Node | undefined = current.parent
    if (
      parent !== undefined &&
      ts.isVariableDeclaration(parent) &&
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
  node: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    const parent: ts.Node | undefined = current.parent
    if (
      parent !== undefined &&
      ts.isParameter(parent) &&
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
  node: ts.ObjectLiteralExpression,
  exportedNames: ReadonlySet<string>,
): boolean => {
  let current: ts.Node = node
  while (current.parent !== undefined) {
    const parent = current.parent
    if (ts.isVariableDeclaration(parent)) {
      return parent.initializer === current && isBoundaryVariable(parent, exportedNames)
    }
    if (ts.isPropertyAssignment(parent) && ts.isObjectLiteralExpression(parent.parent)) {
      current = parent.parent
      continue
    }
    return false
  }
  return false
}

const isBoundaryVariableInitializerAssertion = (
  assertion: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const variable = nearestAncestor(assertion, ts.isVariableDeclaration)
  return (
    variable !== undefined &&
    variable.type === undefined &&
    variable.initializer !== undefined &&
    isAncestorOf(variable.initializer, assertion) &&
    isBoundaryVariable(variable, exportedNames)
  )
}

const isBoundaryReturnAssertion = (
  assertion: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const returnStatement = nearestAncestor(assertion, ts.isReturnStatement)
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
  assertion: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const arrow = nearestAncestor(assertion, ts.isArrowFunction)
  return (
    arrow !== undefined &&
    !ts.isBlock(arrow.body) &&
    isAncestorOf(arrow.body, assertion) &&
    functionReturnIsInferred(arrow) &&
    isBoundaryFunctionOwner(arrow, exportedNames)
  )
}

const isBoundaryObjectPropertyAssertion = (
  assertion: ts.Node,
  exportedNames: ReadonlySet<string>,
): boolean => {
  const property = nearestAncestor(assertion, ts.isPropertyAssignment)
  return (
    property !== undefined &&
    property.initializer !== undefined &&
    isAncestorOf(property.initializer, assertion) &&
    !objectLiteralHasEnclosingVariableType(property.parent) &&
    isWithinExportedObjectLiteralSurface(property, exportedNames)
  )
}

const isPublicClassMember = (node: ts.Node): boolean =>
  !hasModifier(node, ts.SyntaxKind.PrivateKeyword) &&
  !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)

const isTopLevelVariableDeclaration = (node: ts.VariableDeclaration): boolean => {
  const statement = node.parent.parent
  return ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent)
}

const isRuntimeFunctionWithReturnType = (
  node: ts.Node,
): node is ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node)

const nearestFunctionBodyOwner = (
  node: ts.Node,
): ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression | undefined =>
  nearestAncestor(node, isRuntimeFunctionWithReturnType)

const functionReturnIsInferred = (
  node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): boolean =>
  node.type === undefined &&
  !hasVariableFunctionTypeAnnotation(node) &&
  !hasContextuallyTypedObjectLiteralAncestor(node)

const hasVariableFunctionTypeAnnotation = (
  node: ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression,
): boolean => {
  const parent = node.parent
  return ts.isVariableDeclaration(parent) && parent.type !== undefined
}

const hasContextuallyTypedObjectLiteralAncestor = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (
      ts.isObjectLiteralExpression(current) &&
      objectLiteralHasEnclosingVariableType(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

const objectLiteralHasEnclosingVariableType = (node: ts.Node): boolean => {
  let current: ts.Node = node
  while (current.parent !== undefined) {
    if (ts.isVariableDeclaration(current.parent)) {
      return current.parent.initializer === current && current.parent.type !== undefined
    }
    current = current.parent
  }
  return false
}

const nearestAncestor = <T extends ts.Node>(
  node: ts.Node,
  predicate: (candidate: ts.Node) => candidate is T,
): T | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (predicate(current)) return current
    current = current.parent
  }
  return undefined
}

const isAncestorOf = (ancestor: ts.Node, node: ts.Node): boolean => {
  let current: ts.Node | undefined = node
  while (current !== undefined) {
    if (current === ancestor) return true
    current = current.parent
  }
  return false
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
