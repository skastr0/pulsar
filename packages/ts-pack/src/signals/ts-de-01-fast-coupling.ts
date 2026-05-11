import { ts, type SourceFile } from "ts-morph"
import { createModuleResolver } from "../graph/module-graph.js"
import {
  buildOutputFromTables,
  createCouplingTables,
  ensureNestedSet,
  type TsDe01Output,
} from "./ts-de-01-coupling-output.js"

export const computeFastImportTypeCoupling = (
  sourceFiles: ReadonlyArray<SourceFile>,
  diagnosticLimit: number,
): TsDe01Output => {
  const fileSet = new Set<string>(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
  const resolver = createModuleResolver(sourceFiles, [])
  const { outgoing, incoming } = createCouplingTables(fileSet)

  for (const sourceFile of sourceFiles) {
    const src = sourceFile.getFilePath()
    const importedTypeTargets = importedTypeTargetsForFile(sourceFile, resolver)
    if (importedTypeTargets.size === 0) continue

    for (const reference of collectFastTypeReferenceNames(sourceFile)) {
      const referenceName = rootTypeReferenceName(reference.name)
      if (referenceName === undefined) continue
      const targetFile = importedTypeTargets.get(referenceName)
      if (targetFile === undefined || targetFile === src || !fileSet.has(targetFile)) continue

      const key = `${referenceName}:${reference.pos}`
      ensureNestedSet(outgoing, src, targetFile).add(key)
      ensureNestedSet(incoming, targetFile, src).add(key)
    }
  }

  return buildOutputFromTables(fileSet, outgoing, incoming, diagnosticLimit)
}

const importedTypeTargetsForFile = (
  sourceFile: SourceFile,
  resolver: ReturnType<typeof createModuleResolver>,
): ReadonlyMap<string, string> => {
  const targets = new Map<string, string>()
  const sourcePath = sourceFile.getFilePath()

  for (const declaration of sourceFile.getImportDeclarations()) {
    const targetPath = resolver.resolve(sourcePath, declaration)
    if (targetPath === undefined) continue

    const defaultImport = declaration.getDefaultImport()
    if (defaultImport !== undefined) {
      targets.set(defaultImport.getText(), targetPath)
    }

    const namespaceImport = declaration.getNamespaceImport()
    if (namespaceImport !== undefined) {
      targets.set(namespaceImport.getText(), targetPath)
    }

    for (const namedImport of declaration.getNamedImports()) {
      targets.set(namedImport.getAliasNode()?.getText() ?? namedImport.getName(), targetPath)
    }
  }

  return targets
}

const collectFastTypeReferenceNames = (
  sourceFile: SourceFile,
): ReadonlyArray<{ readonly name: string; readonly pos: number }> => {
  const compilerSourceFile = sourceFile.compilerNode
  const references: Array<{ name: string; pos: number }> = []

  const visit = (node: ts.Node): void => {
    const name = fastTypeReferenceName(node, compilerSourceFile)
    if (name !== undefined) {
      references.push({ name, pos: node.pos })
    }
    ts.forEachChild(node, visit)
  }

  visit(compilerSourceFile)
  return references
}

const fastTypeReferenceName = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined => {
  if (ts.isTypeReferenceNode(node)) {
    return entityNameText(node.typeName, sourceFile)
  }
  if (ts.isExpressionWithTypeArguments(node)) {
    return node.expression.getText(sourceFile)
  }
  if (ts.isTypeQueryNode(node)) {
    return entityNameText(node.exprName, sourceFile)
  }
  return undefined
}

const entityNameText = (name: ts.EntityName, sourceFile: ts.SourceFile): string => {
  if (ts.isIdentifier(name)) return name.text
  return name.left.getText(sourceFile)
}

const rootTypeReferenceName = (name: string): string | undefined => {
  const trimmed = name.trim()
  if (trimmed.length === 0) return undefined
  const match = /^[$A-Z_a-z][$\w]*/.exec(trimmed)
  return match?.[0]
}
