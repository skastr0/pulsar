import {
  Node,
  type ClassDeclaration,
  type EnumDeclaration,
  type ExpressionWithTypeArguments,
  type ImportTypeNode,
  type InterfaceDeclaration,
  type SourceFile,
  type TypeAliasDeclaration,
  type TypeNode,
} from "ts-morph"
import {
  STANDARD_UTILITY_TYPE_ALIASES,
  declarationKey,
  resolveReferenceLikeDeclarations,
  resolveReferenceLikeName,
} from "./shared-type-analysis.js"

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
}

export const buildLocalAliasMap = (
  sourceFile: SourceFile,
): ReadonlyMap<string, TypeAliasDeclaration> => {
  const aliases = new Map<string, TypeAliasDeclaration>()
  for (const declaration of sourceFile.getTypeAliases()) {
    aliases.set(declaration.getName(), declaration)
  }
  return aliases
}

export const createWalkContext = (
  remainingSteps: number,
  localAliases: ReadonlyMap<string, TypeAliasDeclaration>,
  aliasDepthCache = new Map<string, DepthResult>(),
): WalkContext => ({
  remainingSteps,
  aliasStack: new Set<string>(),
  localAliases,
  aliasDepthCache,
})

export const measureDeclaration = (
  declaration: TrackedDeclaration,
  context: WalkContext,
): DepthResult => {
  if (Node.isTypeAliasDeclaration(declaration)) {
    return measureAliasDeclaration(declaration, context)
  }

  if (Node.isInterfaceDeclaration(declaration) || Node.isClassDeclaration(declaration)) {
    if (context.remainingSteps <= 0) return truncatedDepth()
    const declarationId = declarationKey(declaration)
    if (context.aliasStack.has(declarationId)) {
      return {
        depth: 1,
        chain: [`${declaration.getName() ?? "<anonymous>"} (cycle)`],
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
    }
    const heritageResults = declaration
      .getHeritageClauses()
      .flatMap((clause) => clause.getTypeNodes())
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
      chain: [`${declaration.getName()} (cycle)`],
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
  const inner = measureTypeNode(declaration.getTypeNodeOrThrow(), {
    remainingSteps: context.remainingSteps - 1,
    aliasStack: nextStack,
    localAliases,
    aliasDepthCache: context.aliasDepthCache,
  })
  const result = {
    depth: 1 + inner.depth,
    chain: [declaration.getName(), ...inner.chain],
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

  const heritageDeclaration = resolveHeritageDeclaration(typeNode)
  const typeArgumentResults = typeNode
    .getTypeArguments()
    .map((typeArg: TypeNode) => measureTypeNode(typeArg, stepContext(context)))
  if (heritageDeclaration !== undefined) {
    return layerResult(
      heritageDeclaration.getName() ?? typeNode.getExpression().getText(),
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

  if (Node.isParenthesizedTypeNode(node)) {
    return measureTypeNode(node.getTypeNode(), stepContext(context))
  }
  if (Node.isTypeReference(node)) {
    return measureTypeReference(node, context)
  }
  if (Node.isMappedTypeNode(node)) {
    return layerResult(
      "<mapped>",
      [
        node.getTypeParameter().getConstraint(),
        node.getNameTypeNode(),
        node.getTypeNode(),
      ]
        .filter((child): child is TypeNode => child !== undefined)
        .map((child) => measureTypeNode(child, stepContext(context))),
    )
  }
  if (Node.isConditionalTypeNode(node)) {
    return layerResult(
      "<conditional>",
      [node.getCheckType(), node.getExtendsType(), node.getTrueType(), node.getFalseType()].map(
        (child) => measureTypeNode(child, stepContext(context)),
      ),
    )
  }
  if (Node.isIndexedAccessTypeNode(node)) {
    return layerResult(
      "<indexed-access>",
      [node.getObjectTypeNode(), node.getIndexTypeNode()].map((child) =>
        measureTypeNode(child, stepContext(context)),
      ),
    )
  }
  if (Node.isImportTypeNode(node)) {
    const aliasDeclaration = resolveAliasDeclaration(node, context)
    return layerResult(
      "<import-type>",
      [
        ...(aliasDeclaration === undefined
          ? []
          : [measureAliasDeclaration(aliasDeclaration, stepContext(context))]),
        ...node.getTypeArguments().map((typeArg) => measureTypeNode(typeArg, stepContext(context))),
      ],
    )
  }
  if (Node.isTypeQuery(node)) {
    return layerResult(
      `<typeof ${node.getExprName().getText()}>`,
      node.getTypeArguments().map((typeArg) => measureTypeNode(typeArg, stepContext(context))),
    )
  }

  return deepestResult(collectNestedTypeResults(node, stepContext(context)))
}

const measureTypeReference = (
  node: import("ts-morph").TypeReferenceNode,
  context: WalkContext,
): DepthResult => {
  const name = resolveReferenceLikeName(node)
  const aliasDeclaration = resolveAliasDeclaration(node, context)
  const typeArgumentResults = node
    .getTypeArguments()
    .map((typeArg) => measureTypeNode(typeArg, stepContext(context)))

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
  node: import("ts-morph").TypeReferenceNode | ImportTypeNode | ExpressionWithTypeArguments,
  context: WalkContext,
): TypeAliasDeclaration | undefined => {
  const localAlias = context.localAliases.get(resolveReferenceLikeName(node))
  if (localAlias !== undefined) return localAlias
  return resolveReferenceLikeDeclarations(node).find(Node.isTypeAliasDeclaration)
}

const resolveHeritageDeclaration = (
  node: ExpressionWithTypeArguments,
): InterfaceDeclaration | ClassDeclaration | undefined =>
  resolveReferenceLikeDeclarations(node).find(
    (declaration): declaration is InterfaceDeclaration | ClassDeclaration =>
      Node.isInterfaceDeclaration(declaration) || Node.isClassDeclaration(declaration),
  )

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
    if (Node.isTypeNode(child)) {
      results.push(measureTypeNode(child, context))
      return
    }
    if (Node.isExpressionWithTypeArguments(child)) {
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
})
