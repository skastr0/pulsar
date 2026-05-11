import {
  type TypeScriptCallExpressionFact,
  type TypeScriptExportDeclarationFact,
  type TypeScriptExportSpecifierFact,
  type TypeScriptImportBindingFact,
  type TypeScriptLocalBindingFact,
} from "@skastr0/pulsar-core"
import { Node, type SourceFile } from "ts-morph"

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
    declarationKind: declaration.getKindName(),
    exportName,
  }

  if (Node.isVariableDeclaration(declaration)) {
    const localName = identifierName(declaration.getNameNode())
    const initializerCall = callFact(declaration.getInitializer())
    return {
      ...base,
      ...(localName === undefined ? {} : { localName }),
      ...(initializerCall === undefined ? {} : { initializerCall }),
    }
  }

  if (Node.isExportAssignment(declaration)) {
    const expression = declaration.getExpression()
    const expressionIdentifier = identifierName(expression)
    const expressionCall = callFact(expression)
    return {
      ...base,
      ...(expressionIdentifier === undefined ? {} : { expressionIdentifier }),
      ...(expressionCall === undefined ? {} : { expressionCall }),
    }
  }

  const named = declaration as { getNameNode?: () => Node; getName?: () => string | undefined }
  const localName = named.getNameNode !== undefined
    ? identifierName(named.getNameNode())
    : named.getName?.()
  return {
    ...base,
    ...(localName === undefined ? {} : { localName }),
  }
}

const importBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptImportBindingFact> =>
  sourceFile.getImportDeclarations().flatMap((declaration) => {
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    const bindings: Array<TypeScriptImportBindingFact> = []
    const defaultImport = declaration.getDefaultImport()
    if (defaultImport !== undefined) {
      bindings.push({
        moduleSpecifier,
        importKind: "default",
        importedName: "default",
        localName: defaultImport.getText(),
      })
    }

    const namespaceImport = declaration.getNamespaceImport()
    if (namespaceImport !== undefined) {
      bindings.push({
        moduleSpecifier,
        importKind: "namespace",
        importedName: "*",
        localName: namespaceImport.getText(),
      })
    }

    for (const namedImport of declaration.getNamedImports()) {
      bindings.push({
        moduleSpecifier,
        importKind: "named",
        importedName: namedImport.getNameNode().getText(),
        localName: namedImport.getAliasNode()?.getText() ?? namedImport.getNameNode().getText(),
      })
    }
    return bindings
  })

const localBindingFacts = (sourceFile: SourceFile): ReadonlyArray<TypeScriptLocalBindingFact> =>
  sourceFile.getVariableStatements()
    .flatMap((statement) => statement.getDeclarations())
    .map((declaration): TypeScriptLocalBindingFact | undefined => {
      const localName = identifierName(declaration.getNameNode())
      if (localName === undefined) return undefined
      const initializerCall = callFact(declaration.getInitializer())
      return {
        localName,
        ...(initializerCall === undefined ? {} : { initializerCall }),
      }
    })
    .filter((fact): fact is TypeScriptLocalBindingFact => fact !== undefined)

const exportSpecifierFacts = (
  sourceFile: SourceFile,
): ReadonlyArray<TypeScriptExportSpecifierFact> =>
  sourceFile.getExportDeclarations().flatMap((declaration) => {
    if (!declaration.hasNamedExports()) return []
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    return declaration.getNamedExports().map((specifier) => ({
      exportedName: specifier.getAliasNode()?.getText() ?? specifier.getNameNode().getText(),
      localName: specifier.getNameNode().getText(),
      ...(moduleSpecifier === undefined ? {} : { moduleSpecifier }),
    }))
  })

const callFact = (node: Node | undefined): TypeScriptCallExpressionFact | undefined => {
  if (node === undefined || !Node.isCallExpression(node)) return undefined
  const callee = node.getExpression()
  const calleeName = callCalleeName(callee)
  return {
    calleeText: callee.getText(),
    ...(calleeName === undefined ? {} : { calleeName }),
  }
}

const callCalleeName = (node: Node): string | undefined => {
  if (Node.isIdentifier(node)) return node.getText()
  if (Node.isPropertyAccessExpression(node)) return node.getNameNode().getText()
  return undefined
}

const identifierName = (node: Node): string | undefined =>
  Node.isIdentifier(node) ? node.getText() : undefined
