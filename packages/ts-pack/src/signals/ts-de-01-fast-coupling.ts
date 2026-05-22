import { dirname, normalize, resolve } from "node:path"
import type { ImportDeclaration, SourceFile } from "ts-morph"
import { ts } from "ts-morph"
import {
  stripKnownExtension,
  stripRuntimeExtension,
} from "./shared-path-extensions.js"
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
  const resolution = createFastResolutionContext(sourceFiles)
  const { outgoing, incoming } = createCouplingTables(fileSet)

  for (const sourceFile of sourceFiles) {
    const src = sourceFile.getFilePath()
    const importedTypeTargets = importedTypeTargetsForFile(sourceFile, resolution)

    if (importedTypeTargets.size > 0) {
      for (const reference of collectFastTypeReferenceNames(sourceFile)) {
        const referenceName = rootTypeReferenceName(reference.name)
        if (referenceName === undefined) continue
        const target = importedTypeTargets.get(referenceName)
        if (target === undefined || target.file === src || !fileSet.has(target.file)) continue

        const key = fastTypeSymbolKey(target)
        ensureNestedSet(outgoing, src, target.file).add(key)
        ensureNestedSet(incoming, target.file, src).add(key)
      }
    }

    for (const reference of collectFastImportTypeReferences(sourceFile)) {
      const symbolName = rootTypeReferenceName(reference.name) ?? reference.name
      const targetFile = resolveModuleSpecifier(src, reference.moduleSpecifier, resolution)
      if (targetFile === undefined || targetFile === src || !fileSet.has(targetFile)) continue
      const resolvedTarget = resolveReExportedTypeTarget(targetFile, symbolName, resolution)

      const key = fastTypeSymbolKey({ file: resolvedTarget, symbolName })
      ensureNestedSet(outgoing, src, resolvedTarget).add(key)
      ensureNestedSet(incoming, resolvedTarget, src).add(key)
    }
  }

  return buildOutputFromTables(fileSet, outgoing, incoming, diagnosticLimit)
}

interface FastTypeTarget {
  readonly file: string
  readonly symbolName: string
}

interface FastResolutionContext {
  readonly sourceFileByPath: ReadonlyMap<string, SourceFile>
  readonly pathLookup: ReadonlyMap<string, string>
  readonly baseUrl?: string
  readonly paths: ReadonlyArray<{
    readonly pattern: string
    readonly replacements: ReadonlyArray<string>
  }>
}

const importedTypeTargetsForFile = (
  sourceFile: SourceFile,
  resolution: FastResolutionContext,
): ReadonlyMap<string, FastTypeTarget> => {
  const targets = new Map<string, FastTypeTarget>()
  const sourcePath = sourceFile.getFilePath()

  for (const declaration of sourceFile.getImportDeclarations()) {
    const targetPath = resolveImportDeclarationTarget(sourcePath, declaration, resolution)
    if (targetPath === undefined) continue

    const defaultImport = declaration.getDefaultImport()
    if (defaultImport !== undefined) {
      targets.set(defaultImport.getText(), {
        file: targetPath,
        symbolName: "default",
      })
    }

    const namespaceImport = declaration.getNamespaceImport()
    if (namespaceImport !== undefined) {
      targets.set(namespaceImport.getText(), {
        file: targetPath,
        symbolName: namespaceImport.getText(),
      })
    }

    for (const namedImport of declaration.getNamedImports()) {
      const symbolName = namedImport.getName()
      targets.set(namedImport.getAliasNode()?.getText() ?? symbolName, {
        file: resolveReExportedTypeTarget(targetPath, symbolName, resolution),
        symbolName,
      })
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

const collectFastImportTypeReferences = (
  sourceFile: SourceFile,
): ReadonlyArray<{
  readonly moduleSpecifier: string
  readonly name: string
  readonly pos: number
}> => {
  const compilerSourceFile = sourceFile.compilerNode
  const references: Array<{
    moduleSpecifier: string
    name: string
    pos: number
  }> = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportTypeNode(node)) {
      const reference = fastImportTypeReference(node, compilerSourceFile)
      if (reference !== undefined) references.push(reference)
    }
    ts.forEachChild(node, visit)
  }

  visit(compilerSourceFile)
  return references
}

const fastImportTypeReference = (
  node: ts.ImportTypeNode,
  sourceFile: ts.SourceFile,
): {
  readonly moduleSpecifier: string
  readonly name: string
  readonly pos: number
} | undefined => {
  if (
    !ts.isLiteralTypeNode(node.argument) ||
    !ts.isStringLiteral(node.argument.literal) ||
    node.qualifier === undefined
  ) {
    return undefined
  }

  return {
    moduleSpecifier: node.argument.literal.text,
    name: entityNameText(node.qualifier, sourceFile),
    pos: node.pos,
  }
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

const fastTypeSymbolKey = (target: FastTypeTarget): string =>
  `type:${target.file}:${target.symbolName}`

const resolveImportDeclarationTarget = (
  sourcePath: string,
  declaration: ImportDeclaration,
  resolution: FastResolutionContext,
): string | undefined => {
  const sourceFilePath = declaration.getModuleSpecifierSourceFile()?.getFilePath()
  if (sourceFilePath !== undefined) return sourceFilePath
  return resolveModuleSpecifier(sourcePath, declaration.getModuleSpecifierValue(), resolution)
}

const resolveModuleSpecifier = (
  sourcePath: string,
  moduleSpecifier: string,
  resolution: FastResolutionContext,
): string | undefined => {
  if (moduleSpecifier.startsWith(".") || moduleSpecifier.startsWith("/")) {
    const resolved = normalizePath(resolve(dirname(sourcePath), moduleSpecifier))
    return lookupResolvedPath(resolved, resolution.pathLookup)
  }

  if (resolution.baseUrl !== undefined) {
    for (const { pattern, replacements } of resolution.paths) {
      const wildcard = pathPatternWildcard(pattern, moduleSpecifier)
      if (wildcard === undefined) continue
      for (const replacement of replacements) {
        const candidate = normalizePath(
          resolve(resolution.baseUrl, replacement.replace("*", wildcard)),
        )
        const resolved = lookupResolvedPath(candidate, resolution.pathLookup)
        if (resolved !== undefined) return resolved
      }
    }
  }

  return undefined
}

const resolveReExportedTypeTarget = (
  filePath: string,
  symbolName: string,
  resolution: FastResolutionContext,
  seen: ReadonlySet<string> = new Set(),
): string => {
  const key = `${filePath}:${symbolName}`
  if (seen.has(key)) return filePath
  const sourceFile = resolution.sourceFileByPath.get(filePath)
  if (sourceFile === undefined) return filePath

  for (const declaration of sourceFile.getExportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue()
    if (moduleSpecifier === undefined) continue

    for (const namedExport of declaration.getNamedExports()) {
      const exportedName = namedExport.getAliasNode()?.getText() ?? namedExport.getName()
      if (exportedName !== symbolName) continue

      const targetPath =
        declaration.getModuleSpecifierSourceFile()?.getFilePath() ??
        resolveModuleSpecifier(filePath, moduleSpecifier, resolution)
      if (targetPath === undefined) return filePath
      return resolveReExportedTypeTarget(
        targetPath,
        namedExport.getName(),
        resolution,
        new Set([...seen, key]),
      )
    }
  }

  return filePath
}

const createFastResolutionContext = (
  sourceFiles: ReadonlyArray<SourceFile>,
): FastResolutionContext => {
  const sourceFileByPath = new Map<string, SourceFile>()
  for (const sourceFile of sourceFiles) {
    sourceFileByPath.set(sourceFile.getFilePath(), sourceFile)
  }

  const compilerOptions = sourceFiles[0]?.getProject().getCompilerOptions() as {
    readonly baseUrl?: string
    readonly configFilePath?: string
    readonly paths?: Record<string, ReadonlyArray<string>>
  }
  const configDir =
    compilerOptions.configFilePath === undefined
      ? undefined
      : dirname(normalizePath(compilerOptions.configFilePath))
  const baseUrl = compilerOptions.baseUrl === undefined
    ? configDir
    : normalizePath(resolve(configDir ?? "", compilerOptions.baseUrl))

  return {
    sourceFileByPath,
    pathLookup: buildPathLookup(sourceFiles),
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    paths: Object.entries(compilerOptions.paths ?? {}).map(([pattern, replacements]) => ({
      pattern,
      replacements,
    })),
  }
}

const pathPatternWildcard = (pattern: string, specifier: string): string | undefined => {
  const wildcardIndex = pattern.indexOf("*")
  if (wildcardIndex === -1) return pattern === specifier ? "" : undefined
  const prefix = pattern.slice(0, wildcardIndex)
  const suffix = pattern.slice(wildcardIndex + 1)
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return undefined
  return specifier.slice(prefix.length, specifier.length - suffix.length)
}

const buildPathLookup = (
  sourceFiles: ReadonlyArray<SourceFile>,
): ReadonlyMap<string, string> => {
  const lookup = new Map<string, string>()

  for (const sourceFile of sourceFiles) {
    const filePath = normalizePath(sourceFile.getFilePath())
    const withoutExtension = stripKnownExtension(filePath)
    lookup.set(filePath, filePath)
    lookup.set(withoutExtension, filePath)

    if (withoutExtension.endsWith("/index")) {
      lookup.set(withoutExtension.slice(0, -"/index".length), filePath)
    }
  }

  return lookup
}

const lookupResolvedPath = (
  candidate: string,
  pathLookup: ReadonlyMap<string, string>,
): string | undefined =>
  pathLookup.get(candidate) ?? pathLookup.get(stripRuntimeExtension(candidate))

const normalizePath = (path: string): string => normalize(path).replace(/\\/g, "/")
