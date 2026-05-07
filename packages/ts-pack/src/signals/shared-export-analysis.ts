import { Node, SyntaxKind, type Node as TsMorphNode, type SourceFile, ts } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import { createModuleResolver } from "../graph/module-graph.js"
import {
  packageDisplayName,
  packageForFile,
} from "./shared-workspace.js"

export interface ExportBinding {
  readonly exportFile: string
  readonly exportName: string
  readonly declarationFiles: ReadonlyArray<string>
  readonly localDeclarations: ReadonlyArray<Node>
  readonly viaReExport: boolean
}

export interface ExportConsumer {
  readonly consumerFile: string
  readonly consumerPackage: string | undefined
  readonly exportName: string | "*"
  readonly kind: "import" | "dynamic-import" | "re-export"
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

export const buildExportConsumerIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
): ReadonlyMap<string, ReadonlyArray<ExportConsumer>> => {
  const fileSet = new Set<string>(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
  const index = new Map<string, Array<ExportConsumer>>()
  const resolver = createModuleResolver(sourceFiles, packages)

  const addConsumer = (
    targetFile: string,
    exportName: string | "*",
    consumerFile: string,
    consumerPackage: string | undefined,
    kind: ExportConsumer["kind"],
  ): void => {
    const bucket = index.get(targetFile) ?? []
    bucket.push({
      consumerFile,
      consumerPackage,
      exportName,
      kind,
    })
    index.set(targetFile, bucket)
  }

  for (const sourceFile of sourceFiles) {
    const consumerFile = sourceFile.getFilePath()
    const consumerPackage = packageDisplayName(packageForFile(consumerFile, packages))
    const compilerSourceFile = sourceFile.compilerNode

    for (const statement of compilerSourceFile.statements) {
      if (!ts.isImportDeclaration(statement)) continue
      const specifier = moduleSpecifierText(statement.moduleSpecifier)
      if (specifier === undefined) continue
      const targetFile = resolveModuleSpecifier(resolver, consumerFile, specifier)
      if (targetFile === undefined || !fileSet.has(targetFile)) continue

      const importClause = statement.importClause
      if (importClause?.name !== undefined) {
        addConsumer(targetFile, "default", consumerFile, consumerPackage, "import")
      }

      const namedBindings = importClause?.namedBindings
      if (namedBindings !== undefined) {
        if (ts.isNamespaceImport(namedBindings)) {
          addConsumer(targetFile, "*", consumerFile, consumerPackage, "import")
        } else {
          for (const element of namedBindings.elements) {
            addConsumer(targetFile, (element.propertyName ?? element.name).text, consumerFile, consumerPackage, "import")
          }
        }
      }
    }

    forEachCompilerNode(compilerSourceFile, (node) => {
      if (!ts.isCallExpression(node)) return
      if (node.expression.kind !== ts.SyntaxKind.ImportKeyword) return
      const specifier = node.arguments[0]
      if (specifier === undefined || !ts.isStringLiteral(specifier)) return

      const targetFile = resolveModuleSpecifier(resolver, consumerFile, specifier.text)
      if (targetFile === undefined || !fileSet.has(targetFile)) return
      addConsumer(targetFile, "*", consumerFile, consumerPackage, "dynamic-import")
    })

    for (const statement of compilerSourceFile.statements) {
      if (!ts.isExportDeclaration(statement)) continue
      const specifier = moduleSpecifierText(statement.moduleSpecifier)
      if (specifier === undefined) continue
      const targetFile = resolveModuleSpecifier(resolver, consumerFile, specifier)
      if (targetFile === undefined || !fileSet.has(targetFile)) continue

      const exportClause = statement.exportClause
      if (exportClause === undefined || ts.isNamespaceExport(exportClause)) {
        addConsumer(targetFile, "*", consumerFile, consumerPackage, "re-export")
        continue
      }

      for (const specifier of exportClause.elements) {
        addConsumer(targetFile, (specifier.propertyName ?? specifier.name).text, consumerFile, consumerPackage, "re-export")
      }
    }
  }

  return index
}

const moduleSpecifierText = (node: ts.Expression | undefined): string | undefined =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : undefined

const resolveModuleSpecifier = (
  resolver: ReturnType<typeof createModuleResolver>,
  sourcePath: string,
  specifier: string,
): string | undefined =>
  resolver.resolve(sourcePath, {
    getModuleSpecifierValue: () => specifier,
  } as Parameters<typeof resolver.resolve>[1])

const forEachCompilerNode = (root: ts.Node, visit: (node: ts.Node) => void): void => {
  const walk = (node: ts.Node): void => {
    visit(node)
    ts.forEachChild(node, walk)
  }
  walk(root)
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
