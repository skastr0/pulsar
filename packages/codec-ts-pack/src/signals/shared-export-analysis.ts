import { Node, type SourceFile } from "ts-morph"
import type { PackageInfo } from "../discovery.js"
import { matchesAnyGlob } from "./shared-globs.js"
import {
  type BoundaryRule,
  packageDisplayName,
  packageForFile,
} from "./shared-workspace.js"
import { declarationKey } from "./shared-type-analysis.js"

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
}

export interface SameFileReference {
  readonly file: string
  readonly line: number
  readonly column: number
}

type ReferenceEntry = {
  readonly isDefinition: () => boolean
  readonly getNode: () => Node
  readonly getTextSpan: () => { readonly getStart: () => number; readonly getLength: () => number }
}

type ReferencedSymbolLike = {
  readonly getReferences: () => ReadonlyArray<ReferenceEntry>
}

type ReferenceFindableNode = Node & {
  readonly findReferences: () => ReadonlyArray<ReferencedSymbolLike>
}

export const collectExportBindings = (sourceFile: SourceFile): ReadonlyArray<ExportBinding> => {
  const bindings: Array<ExportBinding> = []
  for (const [exportName, declarations] of sourceFile.getExportedDeclarations()) {
    const localDeclarations = declarations.filter(
      (declaration) => declaration.getSourceFile() === sourceFile && !Node.isSourceFile(declaration),
    )
    bindings.push({
      exportFile: sourceFile.getFilePath(),
      exportName,
      declarationFiles: declarations
        .map((declaration) => declaration.getSourceFile().getFilePath())
        .filter((value, index, values) => values.indexOf(value) === index)
        .sort((left, right) => left.localeCompare(right)),
      localDeclarations,
      viaReExport: declarations.some((declaration) => declaration.getSourceFile() !== sourceFile),
    })
  }

  return bindings.sort((left, right) => {
    const fileCompare = left.exportFile.localeCompare(right.exportFile)
    if (fileCompare !== 0) return fileCompare
    return left.exportName.localeCompare(right.exportName)
  })
}

export const buildExportConsumerIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
  packages: ReadonlyArray<PackageInfo>,
): ReadonlyMap<string, ReadonlyArray<ExportConsumer>> => {
  const fileSet = new Set(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
  const index = new Map<string, Array<ExportConsumer>>()

  const addConsumer = (
    targetFile: string,
    exportName: string | "*",
    consumerFile: string,
  ): void => {
    const bucket = index.get(targetFile) ?? []
    bucket.push({
      consumerFile,
      consumerPackage: packageDisplayName(packageForFile(consumerFile, packages)),
      exportName,
    })
    index.set(targetFile, bucket)
  }

  for (const sourceFile of sourceFiles) {
    const consumerFile = sourceFile.getFilePath()

    for (const declaration of sourceFile.getImportDeclarations()) {
      const targetFile = declaration.getModuleSpecifierSourceFile()?.getFilePath()
      if (targetFile === undefined || !fileSet.has(targetFile)) continue

      const defaultImport = declaration.getDefaultImport()
      if (defaultImport !== undefined) {
        addConsumer(targetFile, "default", consumerFile)
      }

      if (declaration.getNamespaceImport() !== undefined) {
        addConsumer(targetFile, "*", consumerFile)
      }

      for (const specifier of declaration.getNamedImports()) {
        addConsumer(targetFile, specifier.getNameNode().getText(), consumerFile)
      }
    }

    for (const declaration of sourceFile.getExportDeclarations()) {
      const targetFile = declaration.getModuleSpecifierSourceFile()?.getFilePath()
      if (targetFile === undefined || !fileSet.has(targetFile)) continue

      if (declaration.isNamespaceExport() || !declaration.hasNamedExports()) {
        addConsumer(targetFile, "*", consumerFile)
        continue
      }

      for (const specifier of declaration.getNamedExports()) {
        addConsumer(targetFile, specifier.getNameNode().getText(), consumerFile)
      }
    }
  }

  return index
}

export const collectSameFileReferences = (
  binding: ExportBinding,
): ReadonlyArray<SameFileReference> => {
  const seen = new Set<string>()
  const references: Array<SameFileReference> = []

  for (const declaration of binding.localDeclarations) {
    if (!isReferenceFindableNode(declaration)) continue
    for (const referencedSymbol of declaration.findReferences()) {
      for (const reference of referencedSymbol.getReferences()) {
        if (reference.isDefinition()) continue
        const node = reference.getNode()
        if (node.getSourceFile().getFilePath() !== binding.exportFile) continue
        if (isInsideExportSyntax(node)) continue
        const span = reference.getTextSpan()
        const key = `${binding.exportFile}:${span.getStart()}:${span.getLength()}`
        if (seen.has(key)) continue
        seen.add(key)
        references.push({
          file: binding.exportFile,
          line: node.getStartLineNumber(),
          column: node.getNonWhitespaceStart() - node.getStartLinePos() + 1,
        })
      }
    }
  }

  return references.sort((left, right) => {
    if (left.line !== right.line) return left.line - right.line
    return left.column - right.column
  })
}

export const buildPublicExportedDeclarationSet = (
  sourceFiles: ReadonlyArray<SourceFile>,
  publicEntryGlobs: ReadonlyArray<string>,
): ReadonlySet<string> => {
  const declarations = new Set<string>()
  for (const sourceFile of sourceFiles) {
    if (!matchesAnyGlob(sourceFile.getFilePath(), publicEntryGlobs)) continue
    for (const exportedDeclarations of sourceFile.getExportedDeclarations().values()) {
      for (const declaration of exportedDeclarations) {
        if (Node.isSourceFile(declaration)) continue
        declarations.add(declarationKey(declaration))
      }
    }
  }
  return declarations
}

export const boundaryRule = (
  filePath: string,
  rules: ReadonlyArray<BoundaryRule>,
): string | undefined => rules.find((rule) => matchesAnyGlob(filePath, rule.globs))?.name

const isInsideExportSyntax = (node: Node): boolean =>
  node.getAncestors().some(
    (ancestor) =>
      Node.isExportDeclaration(ancestor) ||
      Node.isExportSpecifier(ancestor) ||
      Node.isExportAssignment(ancestor),
  )

const isReferenceFindableNode = (node: Node): node is ReferenceFindableNode => {
  const candidate = node as { readonly findReferences?: unknown }
  return typeof candidate.findReferences === "function"
}
