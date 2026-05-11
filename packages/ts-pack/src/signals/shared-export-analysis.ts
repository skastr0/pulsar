import { Node, SyntaxKind, type Node as TsMorphNode, type SourceFile, ts } from "ts-morph"
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

  for (const statement of sourceFile.getVariableStatements()) {
    if (!hasExportModifier(statement)) continue
    for (const declaration of statement.getDeclarations()) {
      for (const exportName of bindingNames(declaration.getNameNode())) {
        bindings.push(localBinding(sourceFile, exportName, declaration))
      }
    }
  }

  for (const declaration of [
    ...sourceFile.getFunctions(),
    ...sourceFile.getClasses(),
    ...sourceFile.getInterfaces(),
    ...sourceFile.getTypeAliases(),
    ...sourceFile.getEnums(),
  ]) {
    if (!hasExportModifier(declaration)) continue
    const name = declaration.getName()
    bindings.push(localBinding(sourceFile, hasDefaultModifier(declaration) ? "default" : name ?? "default", declaration))
  }

  for (const assignment of sourceFile.getExportAssignments()) {
    bindings.push(localBinding(sourceFile, "default", assignment))
  }

  for (const declaration of sourceFile.getExportDeclarations()) {
    if (declaration.isNamespaceExport() || !declaration.hasNamedExports()) {
      bindings.push(reExportBinding(sourceFile, "*"))
      continue
    }

    for (const specifier of declaration.getNamedExports()) {
      bindings.push(
        reExportBinding(
          sourceFile,
          specifier.getAliasNode()?.getText() ?? specifier.getNameNode().getText(),
        ),
      )
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
  declaration: TsMorphNode,
): ExportBinding => ({
  exportFile: sourceFile.getFilePath(),
  exportName,
  declarationFiles: [sourceFile.getFilePath()],
  localDeclarations: [declaration],
  viaReExport: false,
})

const reExportBinding = (
  sourceFile: SourceFile,
  exportName: string,
): ExportBinding => ({
  exportFile: sourceFile.getFilePath(),
  exportName,
  declarationFiles: [sourceFile.getFilePath()],
  localDeclarations: [],
  viaReExport: true,
})

const hasExportModifier = (node: TsMorphNode): boolean => {
  const candidate = node as { getModifiers?: () => ReadonlyArray<{ getKind: () => SyntaxKind }> }
  return candidate.getModifiers?.().some((modifier) => modifier.getKind() === SyntaxKind.ExportKeyword) ?? false
}

const hasDefaultModifier = (node: TsMorphNode): boolean => {
  const candidate = node as { getModifiers?: () => ReadonlyArray<{ getKind: () => SyntaxKind }> }
  return candidate.getModifiers?.().some((modifier) => modifier.getKind() === SyntaxKind.DefaultKeyword) ?? false
}

const bindingNames = (node: Node): ReadonlyArray<string> => {
  if (Node.isIdentifier(node)) return [node.getText()]
  if (Node.isObjectBindingPattern(node) || Node.isArrayBindingPattern(node)) {
    return node.getElements().flatMap((element) =>
      Node.isBindingElement(element) ? bindingNames(element.getNameNode()) : [],
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
  forEachCompilerNode(sourceFile.compilerNode, (node) => {
    if (!ts.isIdentifier(node)) return
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

const isCompilerIdentifierInsideExportSyntax = (node: ts.Identifier): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (
      ts.isExportDeclaration(current) ||
      ts.isExportSpecifier(current) ||
      ts.isExportAssignment(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

const isCompilerDeclarationName = (node: ts.Identifier): boolean => {
  const parent = node.parent
  if (parent === undefined) return false

  if (
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isBindingElement(parent)
  ) {
    return parent.name === node
  }

  if (ts.isShorthandPropertyAssignment(parent)) {
    return parent.name === node
  }

  return false
}
