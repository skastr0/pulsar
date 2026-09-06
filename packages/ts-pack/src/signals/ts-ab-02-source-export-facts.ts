import type { TypeScriptCallExpressionFact, TypeScriptExportDeclarationFact, TypeScriptExportSpecifierFact, TypeScriptImportBindingFact, TypeScriptLocalBindingFact } from "@skastr0/pulsar-core/calibration"
import { textOf } from "../ast.js"
import {
  SyntaxKind,
  isCallExpression,
  isExportAssignment,
  isExportDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isPropertyAccessExpression,
  isStringLiteral,
  isVariableDeclaration,
  isVariableStatement,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"

export interface TypeScriptSourceExportFacts {
  readonly imports: ReadonlyArray<TypeScriptImportBindingFact>
  readonly localBindings: ReadonlyArray<TypeScriptLocalBindingFact>
  readonly exportSpecifiers: ReadonlyArray<TypeScriptExportSpecifierFact>
}

const SOURCE_EXPORT_FACT_CACHE = new WeakMap<SourceFile, TypeScriptSourceExportFacts>()

export const collectSourceExportFacts = (
  sourceFile: SourceFile,
): TypeScriptSourceExportFacts => {
  const cached = SOURCE_EXPORT_FACT_CACHE.get(sourceFile)
  if (cached !== undefined) return cached

  const facts: TypeScriptSourceExportFacts = {
    imports: importBindingFacts(sourceFile),
    localBindings: localBindingFacts(sourceFile),
    exportSpecifiers: exportSpecifierFacts(sourceFile),
  }
  SOURCE_EXPORT_FACT_CACHE.set(sourceFile, facts)
  return facts
}

export const declarationFactForExport = (
  exportName: string,
  declaration: Node,
): TypeScriptExportDeclarationFact => {
  const base = {
    declarationKind: SyntaxKind[declaration.kind] ?? String(declaration.kind),
    exportName,
  }

  if (isVariableDeclaration(declaration)) {
    const localName = identifierName(declaration.name)
    const initializerCall = callFact(declaration.initializer)
    return {
      ...base,
      ...(localName === undefined ? {} : { localName }),
      ...(initializerCall === undefined ? {} : { initializerCall }),
    }
  }

  if (isExportAssignment(declaration)) {
    const expression = declaration.expression
    const expressionIdentifier = identifierName(expression)
    const expressionCall = callFact(expression)
    return {
      ...base,
      ...(expressionIdentifier === undefined ? {} : { expressionIdentifier }),
      ...(expressionCall === undefined ? {} : { expressionCall }),
    }
  }

  const named = declaration as { readonly name?: Node }
  const localName = named.name === undefined ? undefined : identifierName(named.name)
  return {
    ...base,
    ...(localName === undefined ? {} : { localName }),
  }
}

const importBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptImportBindingFact> =>
  sourceFile.statements.filter(isImportDeclaration).flatMap((declaration) => {
    const moduleSpecifier = moduleSpecifierText(declaration.moduleSpecifier)
    if (moduleSpecifier === undefined) return []
    const bindings: Array<TypeScriptImportBindingFact> = []
    const clause = declaration.importClause
    if (clause?.name !== undefined) {
      bindings.push({
        moduleSpecifier,
        importKind: "default",
        importedName: "default",
        localName: clause.name.text,
      })
    }

    if (clause?.namedBindings !== undefined && isNamespaceImport(clause.namedBindings)) {
      bindings.push({
        moduleSpecifier,
        importKind: "namespace",
        importedName: "*",
        localName: clause.namedBindings.name.text,
      })
    }

    if (clause?.namedBindings !== undefined && isNamedImports(clause.namedBindings)) {
      for (const namedImport of clause.namedBindings.elements) {
        const importedName = namedImport.propertyName === undefined
          ? (isIdentifier(namedImport.name) ? namedImport.name.text : textOf(namedImport.name))
          : (isIdentifier(namedImport.propertyName) ? namedImport.propertyName.text : textOf(namedImport.propertyName))
        const localName = isIdentifier(namedImport.name) ? namedImport.name.text : textOf(namedImport.name)
        bindings.push({
          moduleSpecifier,
          importKind: "named",
          importedName,
          localName,
        })
      }
    }
    return bindings
  })

const localBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptLocalBindingFact> =>
  sourceFile.statements
    .filter(isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .map((declaration): TypeScriptLocalBindingFact | undefined => {
      const localName = identifierName(declaration.name)
      if (localName === undefined) return undefined
      const initializerCall = callFact(declaration.initializer)
      return {
        localName,
        ...(initializerCall === undefined ? {} : { initializerCall }),
      }
    })
    .filter((fact): fact is TypeScriptLocalBindingFact => fact !== undefined)

const exportSpecifierFacts = (
  sourceFile: SourceFile,
): ReadonlyArray<TypeScriptExportSpecifierFact> =>
  sourceFile.statements.filter(isExportDeclaration).flatMap((declaration) => {
    if (declaration.exportClause === undefined || !isNamedExports(declaration.exportClause)) return []
    const moduleSpecifier = moduleSpecifierText(declaration.moduleSpecifier)
    return declaration.exportClause.elements.map((specifier) => {
      const exportedName = isIdentifier(specifier.name) ? specifier.name.text : textOf(specifier.name)
      const localName = specifier.propertyName === undefined
        ? exportedName
        : (isIdentifier(specifier.propertyName) ? specifier.propertyName.text : textOf(specifier.propertyName))
      return {
        exportedName,
        localName,
        ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
      }
    })
  })

const callFact = (node: Node | undefined): TypeScriptCallExpressionFact | undefined => {
  if (node === undefined || !isCallExpression(node)) return undefined
  const callee = node.expression
  const calleeName = callCalleeName(callee)
  return {
    calleeText: textOf(callee),
    ...(calleeName === undefined ? {} : { calleeName }),
  }
}

const callCalleeName = (node: Node): string | undefined => {
  if (isIdentifier(node)) return node.text
  if (isPropertyAccessExpression(node)) return isIdentifier(node.name) ? node.name.text : textOf(node.name)
  return undefined
}

const identifierName = (node: Node | undefined): string | undefined =>
  node !== undefined && isIdentifier(node) ? node.text : undefined

const moduleSpecifierText = (node: Node | undefined): string | undefined => {
  if (node === undefined) return undefined
  if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) return node.text
  return undefined
}
