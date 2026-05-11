import { Node, ts, type ExportDeclaration, type ImportDeclaration, type SourceFile } from "ts-morph"

type IdentifierUsage = "type-only" | "value"

export const isTypeOnlyModuleDeclaration = (
  declaration: ImportDeclaration | ExportDeclaration,
  getIdentifierUsage: () => ReadonlyMap<string, IdentifierUsage>,
): boolean => {
  if (declaration.isTypeOnly()) return true
  if (Node.isImportDeclaration(declaration)) {
    return isTypeOnlyImportDeclaration(declaration, getIdentifierUsage)
  }

  if (declaration.getNamespaceExport() !== undefined) return false
  const namedExports = declaration.getNamedExports()
  return namedExports.length > 0 && namedExports.every((specifier) => specifier.isTypeOnly())
}

export const localIdentifierUsageByName = (
  sourceFile: SourceFile,
  bindingNames: ReadonlySet<string>,
): ReadonlyMap<string, IdentifierUsage> => {
  const usage = new Map<string, IdentifierUsage>()
  const valueNames = new Set<string>()
  const compilerSourceFile = sourceFile.compilerNode

  const visit = (node: ts.Node, inTypePosition: boolean): void => {
    if (valueNames.size === bindingNames.size) return
    if (ts.isImportDeclaration(node)) return

    const nextInTypePosition = inTypePosition || ts.isTypeNode(node)
    if (ts.isIdentifier(node)) {
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

    ts.forEachChild(node, (child) => visit(child, nextInTypePosition))
  }

  visit(compilerSourceFile, false)

  return usage
}

export const valueImportBindingNames = (
  declarations: ReadonlyArray<ImportDeclaration>,
): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const declaration of declarations) {
    const clause = declaration.getImportClause()
    if (clause === undefined || clause.isTypeOnly()) continue

    const defaultImport = clause.getDefaultImport()
    if (defaultImport !== undefined) {
      names.add(defaultImport.getText())
    }

    const namespaceImport = clause.getNamespaceImport()
    if (namespaceImport !== undefined) {
      names.add(namespaceImport.getText())
    }

    for (const specifier of clause.getNamedImports()) {
      if (!specifier.isTypeOnly()) {
        names.add(specifier.getAliasNode()?.getText() ?? specifier.getName())
      }
    }
  }
  return names
}

const isTypeOnlyImportDeclaration = (
  declaration: ImportDeclaration,
  getIdentifierUsage: () => ReadonlyMap<string, IdentifierUsage>,
): boolean => {
  const clause = declaration.getImportClause()
  if (clause === undefined) return false
  if (clause.isTypeOnly()) return true

  const typeOnlyBindings = new Set<string>()
  const valueBindings = new Set<string>()

  const defaultImport = clause.getDefaultImport()
  if (defaultImport !== undefined) {
    valueBindings.add(defaultImport.getText())
  }

  const namespaceImport = clause.getNamespaceImport()
  if (namespaceImport !== undefined) {
    valueBindings.add(namespaceImport.getText())
  }

  for (const specifier of clause.getNamedImports()) {
    const localName = specifier.getAliasNode()?.getText() ?? specifier.getName()
    if (specifier.isTypeOnly()) {
      typeOnlyBindings.add(localName)
    } else {
      valueBindings.add(localName)
    }
  }

  if (valueBindings.size === 0) return typeOnlyBindings.size > 0

  const identifierUsage = getIdentifierUsage()
  for (const bindingName of valueBindings) {
    if (identifierUsage.get(bindingName) !== "type-only") return false
  }
  return true
}
