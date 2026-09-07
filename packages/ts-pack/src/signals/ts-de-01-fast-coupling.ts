import { dirname, normalize, resolve } from "node:path"
import { existsSync } from "node:fs"
import { readPathAliases } from "./ts-de-04-path-aliases.js"
import type { TsconfigPathAlias } from "./ts-de-04-path-aliases.js"
import { textOf, walkDescendants } from "../ast.js"
import {
  isExportDeclaration,
  isExpressionWithTypeArguments,
  isIdentifier,
  isImportClause,
  isImportDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isNamedExports,
  isNamedImports,
  isNamespaceImport,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isTypeQueryNode,
  isTypeReferenceNode,
  type ExportDeclaration,
  type ImportDeclaration,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import { createModuleResolver } from "../graph/module-graph.js"
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

export const computeFastImportTypeCoupling = async (
  sourceFiles: ReadonlyArray<SourceFile>,
  diagnosticLimit: number,
): Promise<TsDe01Output> => {
  const fileSet = new Set<string>(sourceFiles.map((sourceFile) => sourceFile.fileName))
  const resolution = await createFastResolutionContext(sourceFiles)
  const { outgoing, incoming } = createCouplingTables(fileSet)

  for (const sourceFile of sourceFiles) {
    const src = sourceFile.fileName
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
  readonly aliasesByConfigDir: ReadonlyMap<string, ReadonlyArray<TsconfigPathAlias>>
}

const importedTypeTargetsForFile = (
  sourceFile: SourceFile,
  resolution: FastResolutionContext,
): ReadonlyMap<string, FastTypeTarget> => {
  const targets = new Map<string, FastTypeTarget>()
  const sourcePath = sourceFile.fileName

  for (const declaration of importDeclarationsOf(sourceFile)) {
    const targetPath = resolveImportDeclarationTarget(sourcePath, declaration, resolution)
    if (targetPath === undefined) continue

    const clause = declaration.importClause
    if (clause?.name !== undefined) {
      targets.set(clause.name.text, {
        file: targetPath,
        symbolName: "default",
      })
    }

    if (clause?.namedBindings !== undefined && isNamespaceImport(clause.namedBindings)) {
      targets.set(clause.namedBindings.name.text, {
        file: targetPath,
        symbolName: clause.namedBindings.name.text,
      })
    }

    if (clause?.namedBindings !== undefined && isNamedImports(clause.namedBindings)) {
      for (const namedImport of clause.namedBindings.elements) {
        const symbolName = namedImport.propertyName === undefined
          ? (isIdentifier(namedImport.name) ? namedImport.name.text : textOf(namedImport.name))
          : (isIdentifier(namedImport.propertyName) ? namedImport.propertyName.text : textOf(namedImport.propertyName))
        const localName = isIdentifier(namedImport.name) ? namedImport.name.text : textOf(namedImport.name)
        targets.set(localName, {
          file: resolveReExportedTypeTarget(targetPath, symbolName, resolution),
          symbolName,
        })
      }
    }
  }

  return targets
}

const collectFastTypeReferenceNames = (
  sourceFile: SourceFile,
): ReadonlyArray<{ readonly name: string; readonly pos: number }> => {
  const references: Array<{ name: string; pos: number }> = []
  walkDescendants(sourceFile, (node) => {
    const name = fastTypeReferenceName(node)
    if (name !== undefined) {
      references.push({ name, pos: node.pos })
    }
  })
  return references
}

const collectFastImportTypeReferences = (
  sourceFile: SourceFile,
): ReadonlyArray<{
  readonly moduleSpecifier: string
  readonly name: string
  readonly pos: number
}> => {
  const references: Array<{
    moduleSpecifier: string
    name: string
    pos: number
  }> = []
  walkDescendants(sourceFile, (node) => {
    if (isImportTypeNode(node)) {
      const reference = fastImportTypeReference(node)
      if (reference !== undefined) references.push(reference)
    }
  })
  return references
}

const fastImportTypeReference = (
  node: import("../tsgo-api.js").ImportTypeNode,
): {
  readonly moduleSpecifier: string
  readonly name: string
  readonly pos: number
} | undefined => {
  if (
    !isLiteralTypeNode(node.argument) ||
    !isStringLiteral(node.argument.literal) ||
    node.qualifier === undefined
  ) {
    return undefined
  }

  return {
    moduleSpecifier: node.argument.literal.text,
    name: entityNameText(node.qualifier),
    pos: node.pos,
  }
}

const fastTypeReferenceName = (
  node: Node,
): string | undefined => {
  if (isTypeReferenceNode(node)) {
    return entityNameText(node.typeName)
  }
  if (isExpressionWithTypeArguments(node)) {
    return textOf(node.expression)
  }
  if (isTypeQueryNode(node)) {
    return entityNameText(node.exprName)
  }
  return undefined
}

const entityNameText = (name: Node): string => {
  if (isIdentifier(name)) return name.text
  return textOf(name).split(".")[0] ?? textOf(name)
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
  const specifier = moduleSpecifierText(declaration)
  if (specifier === undefined) return undefined
  return resolveModuleSpecifier(sourcePath, specifier, resolution)
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

  const configDir = nearestTsconfigDir(sourcePath)
  const aliases = resolution.aliasesByConfigDir.get(configDir) ?? []
  for (const alias of aliases) {
    const wildcard = pathPatternWildcard(alias.pattern, moduleSpecifier)
    if (wildcard === undefined) continue
    for (const replacement of alias.replacements) {
      const candidate = normalizePath(
        resolve(alias.baseDir, replacement.replace("*", wildcard)),
      )
      const resolved = lookupResolvedPath(candidate, resolution.pathLookup)
      if (resolved !== undefined) return resolved
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

  for (const declaration of exportDeclarationsOf(sourceFile)) {
    const moduleSpecifier = moduleSpecifierText(declaration)
    if (moduleSpecifier === undefined) continue
    if (declaration.exportClause === undefined || !isNamedExports(declaration.exportClause)) continue

    for (const namedExport of declaration.exportClause.elements) {
      const exportedName = isIdentifier(namedExport.name) ? namedExport.name.text : textOf(namedExport.name)
      if (exportedName !== symbolName) continue
      const importedName = namedExport.propertyName === undefined
        ? exportedName
        : (isIdentifier(namedExport.propertyName) ? namedExport.propertyName.text : textOf(namedExport.propertyName))

      const targetPath = resolveModuleSpecifier(filePath, moduleSpecifier, resolution)
      if (targetPath === undefined) return filePath
      return resolveReExportedTypeTarget(
        targetPath,
        importedName,
        resolution,
        new Set([...seen, key]),
      )
    }
  }

  return filePath
}

const createFastResolutionContext = async (
  sourceFiles: ReadonlyArray<SourceFile>,
): Promise<FastResolutionContext> => {
  const sourceFileByPath = new Map<string, SourceFile>()
  for (const sourceFile of sourceFiles) {
    sourceFileByPath.set(sourceFile.fileName, sourceFile)
  }

  const aliasesByConfigDir = new Map<string, ReadonlyArray<TsconfigPathAlias>>()
  for (const sourceFile of sourceFiles) {
    const configDir = nearestTsconfigDir(sourceFile.fileName)
    if (aliasesByConfigDir.has(configDir)) continue
    aliasesByConfigDir.set(configDir, await readPathAliases(resolve(configDir, "tsconfig.json")))
  }
  return {
    sourceFileByPath,
    pathLookup: buildPathLookup(sourceFiles),
    aliasesByConfigDir,
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
    const filePath = normalizePath(sourceFile.fileName)
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

const nearestTsconfigDir = (filePath: string): string => {
  let current = dirname(normalizePath(filePath))
  while (true) {
    if (existsSync(resolve(current, "tsconfig.json"))) return current
    const parent = dirname(current)
    if (parent === current) return dirname(normalizePath(filePath))
    current = parent
  }
}

const importDeclarationsOf = (sourceFile: SourceFile): ReadonlyArray<ImportDeclaration> =>
  sourceFile.statements.filter(isImportDeclaration)

const exportDeclarationsOf = (sourceFile: SourceFile): ReadonlyArray<ExportDeclaration> =>
  sourceFile.statements.filter(isExportDeclaration)

const moduleSpecifierText = (
  declaration: ImportDeclaration | ExportDeclaration,
): string | undefined => {
  const specifier = declaration.moduleSpecifier
  if (specifier === undefined) return undefined
  if (isStringLiteral(specifier) || isNoSubstitutionTemplateLiteral(specifier)) return specifier.text
  return undefined
}
