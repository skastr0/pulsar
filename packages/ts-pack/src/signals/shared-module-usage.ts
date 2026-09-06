import {
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamespaceExport,
  isNamespaceImport,
  isNamedExports,
  isNamedImports,
  isTypeAliasDeclaration,
  isTypeNode,
  SyntaxKind,
  type ExportDeclaration,
  type ExportSpecifier,
  type ImportClause,
  type ImportDeclaration,
  type ImportSpecifier,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"

type IdentifierUsage = "type-only" | "value"

export const isTypeOnlyModuleDeclaration = (
  declaration: ImportDeclaration | ExportDeclaration,
  getIdentifierUsage: () => ReadonlyMap<string, IdentifierUsage>,
  resolveExportSourceFile?: () => SourceFile | undefined,
): boolean => {
  if (isExplicitTypeOnlyDeclaration(declaration)) return true
  if (isImportDeclaration(declaration)) {
    return isTypeOnlyImportDeclaration(declaration, getIdentifierUsage)
  }

  if (declaration.exportClause !== undefined && isNamespaceExport(declaration.exportClause)) return false
  const namedExports = namedExportsOf(declaration)
  return namedExports.length > 0 &&
    namedExports.every((specifier) =>
      specifier.isTypeOnly ||
      isSemanticallyTypeOnlyExportSpecifier(specifier, resolveExportSourceFile)
    )
}

export const localIdentifierUsageByName = (
  sourceFile: SourceFile,
  bindingNames: ReadonlySet<string>,
): ReadonlyMap<string, IdentifierUsage> => {
  const usage = new Map<string, IdentifierUsage>()
  const valueNames = new Set<string>()
  const visit = (node: Node, inTypePosition: boolean): void => {
    if (valueNames.size === bindingNames.size) return
    if (isImportDeclaration(node)) return
    const nextInTypePosition = inTypePosition || isTypeNode(node)
    if (isIdentifier(node)) {
      const name = node.text
      if (!bindingNames.has(name)) return
      if (!nextInTypePosition) {
        usage.set(name, "value")
        valueNames.add(name)
        return
      }
      if (usage.get(name) !== "value") {
        usage.set(name, "type-only")
      }
      return
    }
    node.forEachChild((child) => visit(child, nextInTypePosition))
  }
  visit(sourceFile, false)

  return usage
}

export const valueImportBindingNames = (
  declarations: ReadonlyArray<ImportDeclaration>,
): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const declaration of declarations) {
    const clause = declaration.importClause
    if (clause === undefined || isTypeOnlyImportClause(clause)) continue
    if (clause.name !== undefined) names.add(clause.name.text)
    if (clause.namedBindings !== undefined && isNamespaceImport(clause.namedBindings)) {
      names.add(clause.namedBindings.name.text)
    }
    for (const specifier of namedImportsOf(clause)) {
      if (!specifier.isTypeOnly) {
        names.add(localImportName(specifier))
      }
    }
  }
  return names
}

const isTypeOnlyImportDeclaration = (
  declaration: ImportDeclaration,
  getIdentifierUsage: () => ReadonlyMap<string, IdentifierUsage>,
): boolean => {
  const clause = declaration.importClause
  if (clause === undefined) return false
  if (isTypeOnlyImportClause(clause)) return true

  const typeOnlyBindings = new Set<string>()
  const valueBindings = new Set<string>()

  if (clause.name !== undefined) valueBindings.add(clause.name.text)
  if (clause.namedBindings !== undefined && isNamespaceImport(clause.namedBindings)) {
    valueBindings.add(clause.namedBindings.name.text)
  }
  for (const specifier of namedImportsOf(clause)) {
    const localName = localImportName(specifier)
    if (specifier.isTypeOnly) typeOnlyBindings.add(localName)
    else valueBindings.add(localName)
  }

  if (valueBindings.size === 0) return typeOnlyBindings.size > 0

  const identifierUsage = getIdentifierUsage()
  for (const bindingName of valueBindings) {
    if (identifierUsage.get(bindingName) !== "type-only") return false
  }
  return true
}

const isSemanticallyTypeOnlyExportSpecifier = (
  specifier: ExportSpecifier,
  resolveExportSourceFile: (() => SourceFile | undefined) | undefined,
): boolean => {
  const sourceFile = resolveExportSourceFile?.()
  if (sourceFile === undefined) return false

  const exportedName = exportNameText(specifier)
  return exportedName.length > 0 && isExportedTypeOnlyName(sourceFile, exportedName)
}

const isExportedTypeOnlyName = (sourceFile: SourceFile, exportedName: string): boolean => {
  let foundValue = false
  let foundType = false
  const visit = (node: Node): void => {
    if (foundValue) return
    if (isInterfaceDeclaration(node) && node.name.text === exportedName) {
      foundType = true
      return
    }
    if (isTypeAliasDeclaration(node) && node.name.text === exportedName) {
      foundType = true
      return
    }
    if (isExportDeclaration(node) && node.moduleSpecifier === undefined) {
      for (const specifier of namedExportsOf(node)) {
        if (exportNameText(specifier) !== exportedName) continue
        if (specifier.isTypeOnly) foundType = true
        else foundValue = true
      }
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return foundType && !foundValue
}

const isExplicitTypeOnlyDeclaration = (declaration: ImportDeclaration | ExportDeclaration): boolean => {
  if (isImportDeclaration(declaration)) {
    return declaration.importClause !== undefined && isTypeOnlyImportClause(declaration.importClause)
  }
  return declaration.isTypeOnly
}

const isTypeOnlyImportClause = (clause: ImportClause): boolean =>
  clause.phaseModifier === SyntaxKind.TypeKeyword

const namedExportsOf = (declaration: ExportDeclaration): ReadonlyArray<ExportSpecifier> =>
  declaration.exportClause !== undefined && isNamedExports(declaration.exportClause)
    ? [...declaration.exportClause.elements]
    : []

const namedImportsOf = (clause: ImportClause): ReadonlyArray<ImportSpecifier> =>
  clause.namedBindings !== undefined && isNamedImports(clause.namedBindings)
    ? [...clause.namedBindings.elements]
    : []

const localImportName = (specifier: ImportSpecifier): string => specifier.name.text

const exportNameText = (specifier: ExportSpecifier): string =>
  (specifier.propertyName ?? specifier.name).text
