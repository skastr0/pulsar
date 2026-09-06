import { textOf } from "../ast.js"
import {
  isClassDeclaration,
  isConditionalTypeNode,
  isEnumDeclaration,
  isExpressionWithTypeArguments,
  isIdentifier,
  isImportTypeNode,
  isIndexedAccessTypeNode,
  isInterfaceDeclaration,
  isMappedTypeNode,
  isParenthesizedTypeNode,
  isTypeAliasDeclaration,
  isTypeNode,
  isTypeQueryNode,
  isTypeReferenceNode,
  type ClassDeclaration,
  type EnumDeclaration,
  type ExpressionWithTypeArguments,
  type ImportTypeNode,
  type InterfaceDeclaration,
  type Node,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeNode,
} from "../tsgo-api.js"
import {
  STANDARD_UTILITY_TYPE_ALIASES,
  declarationKey,
  resolveReferenceLikeDeclarations,
  resolveReferenceLikeName,
} from "./shared-type-analysis.js"
import { createModuleResolver } from "../graph/module-graph.js"
import {
  isImportDeclaration,
  isNamedImports,
  isNoSubstitutionTemplateLiteral,
  isStringLiteral,
  isLiteralTypeNode,
} from "../tsgo-api.js"

const declarationName = (declaration: { readonly name?: Node }): string => {
  if (declaration.name === undefined) return "<anonymous>"
  return isIdentifier(declaration.name) ? declaration.name.text : textOf(declaration.name)
}

export type TrackedDeclaration =
  | TypeAliasDeclaration
  | InterfaceDeclaration
  | ClassDeclaration
  | EnumDeclaration

export type DepthResult = {
  depth: number
  chain: ReadonlyArray<string>
  cycle: boolean
  truncated: boolean
}

type WalkContext = {
  readonly remainingSteps: number
  readonly aliasStack: ReadonlySet<string>
  readonly localAliases: ReadonlyMap<string, TypeAliasDeclaration>
  readonly aliasDepthCache: Map<string, DepthResult>
  readonly typeIndex: TypeIndex
}

export interface TypeIndex {
  readonly aliasesByFile: ReadonlyMap<string, ReadonlyMap<string, TypeAliasDeclaration>>
  readonly interfacesByFile: ReadonlyMap<string, ReadonlyMap<string, InterfaceDeclaration>>
  readonly classesByFile: ReadonlyMap<string, ReadonlyMap<string, ClassDeclaration>>
  readonly sourceFileByPath: ReadonlyMap<string, SourceFile>
}

export const buildLocalAliasMap = (
  sourceFile: SourceFile,
): ReadonlyMap<string, TypeAliasDeclaration> => {
  const aliases = new Map<string, TypeAliasDeclaration>()
  for (const declaration of sourceFile.statements.filter(isTypeAliasDeclaration)) {
    aliases.set(declarationName(declaration), declaration)
  }
  return aliases
}

export const createWalkContext = (
  remainingSteps: number,
  localAliases: ReadonlyMap<string, TypeAliasDeclaration>,
  aliasDepthCache = new Map<string, DepthResult>(),
  typeIndex: TypeIndex = emptyTypeIndex(),
): WalkContext => ({
  remainingSteps,
  aliasStack: new Set<string>(),
  localAliases,
  aliasDepthCache,
  typeIndex,
})

export const measureDeclaration = (
  declaration: TrackedDeclaration,
  context: WalkContext,
): DepthResult => {
  if (isTypeAliasDeclaration(declaration)) {
    return measureAliasDeclaration(declaration, context)
  }

  if (isInterfaceDeclaration(declaration) || isClassDeclaration(declaration)) {
    if (context.remainingSteps <= 0) return truncatedDepth()
    const declarationId = declarationKey(declaration)
    if (context.aliasStack.has(declarationId)) {
      return {
        depth: 1,
        chain: [`${declarationName(declaration) ?? "<anonymous>"} (cycle)`],
        cycle: true,
        truncated: false,
      }
    }
    const nextStack = new Set(context.aliasStack)
    nextStack.add(declarationId)
    const nextContext = {
      remainingSteps: context.remainingSteps - 1,
      aliasStack: nextStack,
      localAliases: context.localAliases,
      aliasDepthCache: context.aliasDepthCache,
      typeIndex: context.typeIndex,
    }
    const heritageResults = (declaration.heritageClauses ?? [])
      .flatMap((clause) => [...clause.types])
      .map((typeNode) => measureHeritageType(typeNode, nextContext))
    return deepestResult(heritageResults)
  }

  return zeroDepth()
}

const measureAliasDeclaration = (
  declaration: TypeAliasDeclaration,
  context: WalkContext,
): DepthResult => {
  if (context.remainingSteps <= 0) {
    return truncatedDepth()
  }

  const aliasId = declarationKey(declaration)
  if (context.aliasStack.has(aliasId)) {
    return {
      depth: 1,
      chain: [`${declarationName(declaration)} (cycle)`],
      cycle: true,
      truncated: false,
    }
  }
  const cacheKey = aliasCacheKey(aliasId, context)
  const cached = context.aliasDepthCache.get(cacheKey)
  if (cached !== undefined) return cached

  const nextStack = new Set(context.aliasStack)
  nextStack.add(aliasId)
  const localAliases = buildLocalAliasMap(declaration.getSourceFile())
  if (declaration.type === undefined) return truncatedDepth()
  const inner = measureTypeNode(declaration.type, {
    remainingSteps: context.remainingSteps - 1,
    aliasStack: nextStack,
    localAliases,
    aliasDepthCache: context.aliasDepthCache,
    typeIndex: context.typeIndex,
  })
  const result = {
    depth: 1 + inner.depth,
    chain: [declarationName(declaration), ...inner.chain],
    cycle: inner.cycle,
    truncated: inner.truncated,
  }
  context.aliasDepthCache.set(cacheKey, result)
  return result
}

const aliasCacheKey = (aliasId: string, context: WalkContext): string =>
  [
    aliasId,
    `steps:${context.remainingSteps}`,
    `stack:${[...context.aliasStack].sort().join(",")}`,
  ].join("|")

const measureHeritageType = (
  typeNode: ExpressionWithTypeArguments,
  context: WalkContext,
): DepthResult => {
  const aliasDeclaration = resolveAliasDeclaration(typeNode, context)
  if (aliasDeclaration !== undefined) {
    return measureAliasDeclaration(aliasDeclaration, context)
  }

  const heritageDeclaration = resolveHeritageDeclaration(typeNode, context)
  const typeArgumentResults = (typeNode.typeArguments ?? []).map((typeArg: TypeNode) =>
    measureTypeNode(typeArg, stepContext(context)),
  )
  if (heritageDeclaration !== undefined) {
    return layerResult(
      declarationName(heritageDeclaration) ?? textOf(typeNode.expression),
      [
        measureDeclaration(heritageDeclaration, stepContext(context)),
        ...typeArgumentResults,
      ],
    )
  }
  return deepestResult(typeArgumentResults)
}

const measureTypeNode = (node: TypeNode, context: WalkContext): DepthResult => {
  if (context.remainingSteps <= 0) return truncatedDepth()

  if (isParenthesizedTypeNode(node)) {
    return measureTypeNode(node.type, stepContext(context))
  }
  if (isTypeReferenceNode(node)) {
    return measureTypeReference(node, context)
  }
  if (isMappedTypeNode(node)) {
    return layerResult(
      "<mapped>",
      [
        node.typeParameter.constraint,
        node.nameType,
        node.type,
      ]
        .filter((child): child is TypeNode => child !== undefined)
        .map((child) => measureTypeNode(child, stepContext(context))),
    )
  }
  if (isConditionalTypeNode(node)) {
    return layerResult(
      "<conditional>",
      [node.checkType, node.extendsType, node.trueType, node.falseType].map(
        (child) => measureTypeNode(child, stepContext(context)),
      ),
    )
  }
  if (isIndexedAccessTypeNode(node)) {
    return layerResult(
      "<indexed-access>",
      [node.objectType, node.indexType].map((child) =>
        measureTypeNode(child, stepContext(context)),
      ),
    )
  }
  if (isImportTypeNode(node)) {
    const aliasDeclaration = resolveAliasDeclaration(node, context)
    return layerResult(
      "<import-type>",
      [
        ...(aliasDeclaration === undefined
          ? []
          : [measureAliasDeclaration(aliasDeclaration, stepContext(context))]),
        ...node.typeArguments ?? [].map((typeArg) => measureTypeNode(typeArg, stepContext(context))),
      ],
    )
  }
  if (isTypeQueryNode(node)) {
    return layerResult(
      `<typeof ${textOf(node.exprName)}>`,
      node.typeArguments ?? [].map((typeArg) => measureTypeNode(typeArg, stepContext(context))),
    )
  }

  return deepestResult(collectNestedTypeResults(node, stepContext(context)))
}

const measureTypeReference = (
  node: import("../tsgo-api.js").TypeReferenceNode,
  context: WalkContext,
): DepthResult => {
  const name = resolveReferenceLikeName(node)
  const aliasDeclaration = resolveAliasDeclaration(node, context)
  const typeArgumentResults = (node.typeArguments ?? []).map((typeArg) =>
    measureTypeNode(typeArg, stepContext(context)),
  )

  if (aliasDeclaration !== undefined) {
    const aliasResult = measureAliasDeclaration(aliasDeclaration, stepContext(context))
    const typeArguments = deepestResult(typeArgumentResults)
    if (typeArguments.depth === 0 && !typeArguments.truncated) return aliasResult
    return combineDepthResults(aliasResult, typeArguments)
  }

  if (STANDARD_UTILITY_TYPE_ALIASES.has(name)) {
    return layerResult(name, typeArgumentResults)
  }

  return deepestResult(typeArgumentResults)
}

const combineDepthResults = (
  first: DepthResult,
  second: DepthResult,
): DepthResult => ({
  depth: first.depth + second.depth,
  chain: [...first.chain, ...second.chain],
  cycle: first.cycle || second.cycle,
  truncated: first.truncated || second.truncated,
})

const resolveAliasDeclaration = (
  node: import("../tsgo-api.js").TypeReferenceNode | ImportTypeNode | ExpressionWithTypeArguments,
  context: WalkContext,
): TypeAliasDeclaration | undefined => {
  const name = resolveReferenceLikeName(node)
  const sourceFile = node.getSourceFile()
  const localAlias = context.localAliases.get(name) ?? lookupAliasInFile(context, sourceFile.fileName, name)
  if (localAlias !== undefined) return localAlias
  if (isImportTypeNode(node)) {
    const argument = node.argument
    if (isLiteralTypeNode(argument) && (isStringLiteral(argument.literal) || isNoSubstitutionTemplateLiteral(argument.literal)) && node.qualifier !== undefined) {
      const resolver = createModuleResolver([...context.typeIndex.sourceFileByPath.values()], [])
      const target = resolver.resolveSpecifier(sourceFile.fileName, argument.literal.text)
      const importedName = isIdentifier(node.qualifier) ? node.qualifier.text : textOf(node.qualifier)
      if (target !== undefined) return lookupAliasInFile(context, target, importedName)
    }
  }
  const imported = importedBinding(context, sourceFile, name)
  if (imported !== undefined) return lookupAliasInFile(context, imported.targetFile, imported.importedName)
  return undefined
}

const resolveHeritageDeclaration = (
  node: ExpressionWithTypeArguments,
  context: WalkContext,
): InterfaceDeclaration | ClassDeclaration | undefined => {
  const name = resolveReferenceLikeName(node)
  const sourceFile = node.getSourceFile()
  const local = lookupHeritageInFile(context, sourceFile.fileName, name)
  if (local !== undefined) return local
  const imported = importedBinding(context, sourceFile, name)
  if (imported !== undefined) return lookupHeritageInFile(context, imported.targetFile, imported.importedName)
  return undefined
}

const layerResult = (label: string, results: ReadonlyArray<DepthResult>): DepthResult => {
  const deepest = deepestResult(results)
  return {
    depth: 1 + deepest.depth,
    chain: [label, ...deepest.chain],
    cycle: deepest.cycle,
    truncated: deepest.truncated,
  }
}

const collectNestedTypeResults = (node: Node, context: WalkContext): ReadonlyArray<DepthResult> => {
  const results: Array<DepthResult> = []
  node.forEachChild((child) => {
    if (isTypeNode(child)) {
      results.push(measureTypeNode(child, context))
      return
    }
    if (isExpressionWithTypeArguments(child)) {
      results.push(measureHeritageType(child, context))
      return
    }
    results.push(...collectNestedTypeResults(child, context))
  })
  return results
}

const deepestResult = (results: ReadonlyArray<DepthResult>): DepthResult => {
  let best = zeroDepth()
  for (const result of results) {
    if (result.depth > best.depth) {
      best = result
      continue
    }
    if (result.depth === best.depth && !best.truncated && result.truncated) {
      best = result
      continue
    }
    if (result.depth === best.depth && !best.cycle && result.cycle) {
      best = result
      continue
    }
    if (result.depth === best.depth && result.chain.join("/") < best.chain.join("/")) {
      best = result
    }
  }
  return best
}

const zeroDepth = (): DepthResult => ({
  depth: 0,
  chain: [],
  cycle: false,
  truncated: false,
})

const truncatedDepth = (): DepthResult => ({
  depth: 0,
  chain: ["<truncated>"],
  cycle: false,
  truncated: true,
})

const stepContext = (context: WalkContext): WalkContext => ({
  remainingSteps: context.remainingSteps - 1,
  aliasStack: context.aliasStack,
  localAliases: context.localAliases,
  aliasDepthCache: context.aliasDepthCache,
  typeIndex: context.typeIndex,
})

export const buildTypeIndex = (sourceFiles: ReadonlyArray<SourceFile>): TypeIndex => {
  const aliasesByFile = new Map<string, Map<string, TypeAliasDeclaration>>()
  const interfacesByFile = new Map<string, Map<string, InterfaceDeclaration>>()
  const classesByFile = new Map<string, Map<string, ClassDeclaration>>()
  const sourceFileByPath = new Map<string, SourceFile>()
  for (const sourceFile of sourceFiles) {
    sourceFileByPath.set(sourceFile.fileName, sourceFile)
    const aliases = new Map<string, TypeAliasDeclaration>()
    const interfaces = new Map<string, InterfaceDeclaration>()
    const classes = new Map<string, ClassDeclaration>()
    for (const statement of sourceFile.statements) {
      if (isTypeAliasDeclaration(statement)) aliases.set(declarationName(statement), statement)
      if (isInterfaceDeclaration(statement)) interfaces.set(declarationName(statement), statement)
      if (isClassDeclaration(statement)) classes.set(declarationName(statement), statement)
    }
    aliasesByFile.set(sourceFile.fileName, aliases)
    interfacesByFile.set(sourceFile.fileName, interfaces)
    classesByFile.set(sourceFile.fileName, classes)
  }
  return { aliasesByFile, interfacesByFile, classesByFile, sourceFileByPath }
}

const emptyTypeIndex = (): TypeIndex => ({
  aliasesByFile: new Map(),
  interfacesByFile: new Map(),
  classesByFile: new Map(),
  sourceFileByPath: new Map(),
})

const importedBinding = (
  context: WalkContext,
  sourceFile: SourceFile,
  localName: string,
): { readonly targetFile: string; readonly importedName: string } | undefined => {
  const resolver = createModuleResolver([...context.typeIndex.sourceFileByPath.values()], [])
  for (const statement of sourceFile.statements) {
    if (!isImportDeclaration(statement)) continue
    const targetFile = resolver.resolve(sourceFile.fileName, statement)
    if (targetFile === undefined) continue
    const namedBindings = statement.importClause?.namedBindings
    if (namedBindings === undefined || !isNamedImports(namedBindings)) continue
    for (const element of namedBindings.elements) {
      const local = isIdentifier(element.name) ? element.name.text : textOf(element.name)
      if (local !== localName) continue
      const importedName = element.propertyName === undefined
        ? local
        : (isIdentifier(element.propertyName) ? element.propertyName.text : textOf(element.propertyName))
      return { targetFile, importedName }
    }
  }
  return undefined
}

const lookupAliasInFile = (
  context: WalkContext,
  filePath: string,
  name: string,
): TypeAliasDeclaration | undefined =>
  context.typeIndex.aliasesByFile.get(filePath)?.get(name)

const lookupHeritageInFile = (
  context: WalkContext,
  filePath: string,
  name: string,
): InterfaceDeclaration | ClassDeclaration | undefined =>
  context.typeIndex.interfacesByFile.get(filePath)?.get(name) ??
  context.typeIndex.classesByFile.get(filePath)?.get(name)
