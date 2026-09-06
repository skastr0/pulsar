import { hasDefaultModifier, hasExportModifier, textOf } from "../ast.js"
import {
  isArrayBindingPattern,
  isBindingElement,
  isClassDeclaration,
  isEnumDeclaration,
  isExportAssignment,
  isExportDeclaration,
  isExportSpecifier,
  isFunctionDeclaration,
  isIdentifier,
  isImportSpecifier,
  isInterfaceDeclaration,
  isMethodDeclaration,
  isNamedExports,
  isNamespaceExport,
  isObjectBindingPattern,
  isParameter,
  isPropertyAssignment,
  isPropertySignature,
  isShorthandPropertyAssignment,
  isTypeAliasDeclaration,
  isVariableDeclaration,
  isVariableStatement,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import { forEachCompilerNode } from "./shared-compiler-node-traversal.js"
export {
  buildExportConsumerIndex,
  type ExportConsumer,
} from "./shared-export-consumers.js"

interface ExportBinding {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly localDeclarations: ReadonlyArray<Node>
  readonly viaReExport: boolean
}

export const collectExportBindings = (sourceFile: SourceFile): ReadonlyArray<ExportBinding> => {
  const bindings: Array<ExportBinding> = []

  for (const statement of sourceFile.statements) {
    if (isVariableStatement(statement)) {
      if (!hasExportModifier(statement)) continue
      for (const declaration of statement.declarationList.declarations) {
        for (const exportName of bindingNames(declaration.name)) {
          bindings.push(localBinding(sourceFile, exportName, declaration))
        }
      }
      continue
    }

    if (
      isFunctionDeclaration(statement) ||
      isClassDeclaration(statement) ||
      isInterfaceDeclaration(statement) ||
      isTypeAliasDeclaration(statement) ||
      isEnumDeclaration(statement)
    ) {
      if (!hasExportModifier(statement)) continue
      const name = statement.name === undefined
        ? undefined
        : (isIdentifier(statement.name) ? statement.name.text : textOf(statement.name))
      bindings.push(localBinding(
        sourceFile,
        hasDefaultModifier(statement) ? "default" : name ?? "default",
        statement,
      ))
      continue
    }

    if (isExportAssignment(statement)) {
      bindings.push(localBinding(sourceFile, "default", statement))
      continue
    }

    if (isExportDeclaration(statement)) {
      if (
        statement.exportClause === undefined ||
        isNamespaceExport(statement.exportClause) ||
        !isNamedExports(statement.exportClause)
      ) {
        bindings.push(reExportBinding(sourceFile, "*"))
        continue
      }

      for (const specifier of statement.exportClause.elements) {
        const exportedName = isIdentifier(specifier.name) ? specifier.name.text : textOf(specifier.name)
        bindings.push(reExportBinding(sourceFile, exportedName))
      }
    }
  }

  return bindings.sort((left, right) => {
    const fileCompare = left.exportFile.localeCompare(right.exportFile)
    if (fileCompare !== 0) return fileCompare
    return left.exportName.localeCompare(right.exportName)
  })
}

const localBinding = (
  sourceFile: SourceFile,
  exportName: string,
  declaration: Node,
): ExportBinding => ({
  exportFile: sourceFile.fileName,
  exportName,
  declarationFiles: [sourceFile.fileName],
  localDeclarations: [declaration],
  viaReExport: false,
})

const reExportBinding = (
  sourceFile: SourceFile,
  exportName: string,
): ExportBinding => ({
  exportFile: sourceFile.fileName,
  exportName,
  declarationFiles: [sourceFile.fileName],
  localDeclarations: [],
  viaReExport: true,
})

const bindingNames = (node: Node): ReadonlyArray<string> => {
  if (isIdentifier(node)) return [node.text]
  if (isObjectBindingPattern(node) || isArrayBindingPattern(node)) {
    return node.elements.flatMap((element) =>
      isBindingElement(element) && element.name !== undefined ? bindingNames(element.name) : [],
    )
  }
  return []
}

export const countSameFileReferences = (binding: ExportBinding): number => {
  if (binding.exportName === "default") return 0

  const sourceFile = binding.localDeclarations[0]?.getSourceFile()
  if (sourceFile === undefined) return 0

  return countIdentifierReferences(sourceFile, binding.exportName)
}

const COUNT_REFERENCE_INDEX = new WeakMap<SourceFile, Map<string, number>>()

const countIdentifierReferences = (sourceFile: SourceFile, name: string): number => {
  const cached = COUNT_REFERENCE_INDEX.get(sourceFile)?.get(name)
  if (cached !== undefined) return cached

  let count = 0
  forEachCompilerNode(sourceFile, (node) => {
    if (!isIdentifier(node)) return
    if (node.text !== name) return
    if (isCompilerIdentifierInsideExportSyntax(node)) return
    if (isCompilerDeclarationName(node)) return
    count += 1
  })

  const fileCache = COUNT_REFERENCE_INDEX.get(sourceFile) ?? new Map<string, number>()
  fileCache.set(name, count)
  COUNT_REFERENCE_INDEX.set(sourceFile, fileCache)
  return count
}

const isCompilerIdentifierInsideExportSyntax = (node: Node): boolean => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (
      isExportDeclaration(current) ||
      isExportSpecifier(current) ||
      isExportAssignment(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

const isCompilerDeclarationName = (node: Node): boolean => {
  const parent = node.parent
  if (parent === undefined) return false

  if (
    isVariableDeclaration(parent) ||
    isParameter(parent) ||
    isFunctionDeclaration(parent) ||
    isClassDeclaration(parent) ||
    isInterfaceDeclaration(parent) ||
    isTypeAliasDeclaration(parent) ||
    isEnumDeclaration(parent) ||
    isImportSpecifier(parent) ||
    isExportSpecifier(parent) ||
    isPropertyAssignment(parent) ||
    isPropertySignature(parent) ||
    isMethodDeclaration(parent) ||
    isBindingElement(parent)
  ) {
    return parent.name === node
  }

  if (isShorthandPropertyAssignment(parent)) {
    return parent.name === node
  }

  return false
}

