import { ts } from "ts-morph"

type BoundaryDeclaration =
  | ts.FunctionDeclaration
  | ts.ClassDeclaration
  | ts.InterfaceDeclaration
  | ts.TypeAliasDeclaration
  | ts.EnumDeclaration

export type ReturnTypeOwner =
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
    return (
      isPublicClassMember(owner) &&
      ts.isClassDeclaration(owner.parent) &&
      isBoundaryClass(owner.parent, exportedNames)
    )
  }

  if (ts.isArrowFunction(owner) || ts.isFunctionExpression(owner)) {
    const parent = owner.parent
    if (ts.isVariableDeclaration(parent)) return isBoundaryVariable(parent, exportedNames)
    if (ts.isPropertyAssignment(parent)) return isWithinExportedTypeSurface(parent, exportedNames)
    return ts.isExportAssignment(parent)
  }

  return isWithinExportedTypeSurface(owner, exportedNames)
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
  return isWithinExportedTypeSurface(property, exportedNames)
}

export const isBoundaryVariable = (
  declaration: ts.VariableDeclaration,
  exportedNames: ReadonlySet<string>,
): boolean => {
  if (!ts.isIdentifier(declaration.name)) return false
  const statement = declaration.parent.parent
  return (
    ts.isVariableStatement(statement) &&
    (hasModifier(statement, ts.SyntaxKind.ExportKeyword) ||
      exportedNames.has(declaration.name.text))
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

const isPublicClassMember = (node: ts.Node): boolean =>
  !hasModifier(node, ts.SyntaxKind.PrivateKeyword) &&
  !hasModifier(node, ts.SyntaxKind.ProtectedKeyword)

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
