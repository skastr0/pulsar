import {
  type ArrowFunction,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type GetAccessorDeclaration,
  type MethodDeclaration,
  Node,
  type Project,
  type SetAccessorDeclaration,
  type SourceFile,
  SyntaxKind,
} from "ts-morph"

export type TsFunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

interface TsFunctionIndexEntry {
  readonly sourceFile: SourceFile
  readonly path: string
  readonly fn: TsFunctionLike
}

const indexByProject = new WeakMap<Project, ReadonlyArray<TsFunctionIndexEntry>>()
const indexBySourceFile = new WeakMap<SourceFile, ReadonlyArray<TsFunctionIndexEntry>>()
const bodyByFunction = new WeakMap<TsFunctionLike, string | undefined>()
const nameByFunction = new WeakMap<TsFunctionLike, string>()

type CompilerNodeLike = {
  readonly kind: SyntaxKind
  forEachChild: (cb: (node: CompilerNodeLike) => void) => void
}

export const getFunctionLikeIndex = (
  project: Project,
): ReadonlyArray<TsFunctionIndexEntry> => {
  const cached = indexByProject.get(project)
  if (cached !== undefined) return cached

  const entries: Array<TsFunctionIndexEntry> = []
  for (const sourceFile of project.getSourceFiles()) {
    entries.push(...getFunctionLikeEntriesForSourceFile(sourceFile))
  }

  indexByProject.set(project, entries)
  return entries
}

export const getFunctionLikeEntriesForSourceFile = (
  sourceFile: SourceFile,
): ReadonlyArray<TsFunctionIndexEntry> => {
  const cached = indexBySourceFile.get(sourceFile)
  if (cached !== undefined) return cached

  const path = sourceFile.getFilePath()
  const entries: Array<TsFunctionIndexEntry> = []
  const wrapCompilerNode = (
    sourceFile as unknown as {
      _getNodeFromCompilerNode: (compilerNode: unknown) => Node
    }
  )._getNodeFromCompilerNode.bind(sourceFile)
  const visit = (compilerNode: CompilerNodeLike): void => {
    if (isFunctionLikeSyntaxKind(compilerNode.kind)) {
      entries.push({ sourceFile, path, fn: wrapCompilerNode(compilerNode) as TsFunctionLike })
    }
    compilerNode.forEachChild(visit)
  }

  sourceFile.compilerNode.forEachChild((node) => visit(node as CompilerNodeLike))

  indexBySourceFile.set(sourceFile, entries)
  return entries
}

const isFunctionLikeSyntaxKind = (kind: SyntaxKind): boolean =>
  kind === SyntaxKind.FunctionDeclaration ||
  kind === SyntaxKind.MethodDeclaration ||
  kind === SyntaxKind.ArrowFunction ||
  kind === SyntaxKind.FunctionExpression ||
  kind === SyntaxKind.Constructor ||
  kind === SyntaxKind.GetAccessor ||
  kind === SyntaxKind.SetAccessor

export const getFunctionBody = (fn: TsFunctionLike): string | undefined => {
  if (bodyByFunction.has(fn)) return bodyByFunction.get(fn)

  let bodyText: string | undefined
  if (Node.isArrowFunction(fn)) {
    const body = fn.getBody()
    bodyText = body === undefined ? undefined : fastNodeText(fn, body)
  } else if ("getBody" in fn && typeof fn.getBody === "function") {
    const body = fn.getBody()
    bodyText = body === undefined ? undefined : fastNodeText(fn, body)
  }

  bodyByFunction.set(fn, bodyText)
  return bodyText
}

const fastNodeText = (owner: TsFunctionLike, node: Node): string => {
  const sourceFile = owner.getSourceFile().compilerNode
  const compilerNode = node.compilerNode
  return sourceFile.text.slice(compilerNode.getStart(sourceFile), compilerNode.end)
}

export const getFunctionName = (fn: TsFunctionLike): string => {
  const cached = nameByFunction.get(fn)
  if (cached !== undefined) return cached

  const name = computeFunctionName(fn)
  nameByFunction.set(fn, name)
  return name
}

const computeFunctionName = (fn: TsFunctionLike): string => {
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isFunctionExpression(fn)
  ) {
    const name = fn.getName?.()
    if (name) return name
  }
  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName()
    }
    if (Node.isPropertyAssignment(parent)) {
      const contextualName = contextualObjectPropertyCallbackName(parent)
      return contextualName ?? parent.getName()
    }
    if (Node.isExportAssignment(parent)) {
      return "<default export>"
    }
    const callbackName = contextualCallbackName(fn)
    if (callbackName !== undefined) return callbackName
  }
  if (Node.isConstructorDeclaration(fn)) return "constructor"
  if (Node.isGetAccessorDeclaration(fn)) return `get ${fn.getName()}`
  if (Node.isSetAccessorDeclaration(fn)) return `set ${fn.getName()}`
  return "<anonymous>"
}

const contextualCallbackName = (fn: ArrowFunction | FunctionExpression): string | undefined => {
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return undefined

  const labelledEffectName = effectFnLabel(parent)
  if (labelledEffectName !== undefined) return labelledEffectName

  const callee = callExpressionName(parent)
  const owner = nearestCallbackOwnerName(parent)
  if (owner !== undefined && callee !== undefined) return `${owner}/${callee}`
  if (owner !== undefined) return `${owner} callback`
  if (callee !== undefined) return `${callee} callback`
  return undefined
}

const effectFnLabel = (call: import("ts-morph").CallExpression): string | undefined => {
  const expression = call.getExpression()
  if (!Node.isCallExpression(expression)) return undefined
  if (expression.getExpression().getText() !== "Effect.fn") return undefined
  const labelArg = expression.getArguments()[0]
  return Node.isStringLiteral(labelArg) ? labelArg.getLiteralText() : undefined
}

const nearestCallbackOwnerName = (node: import("ts-morph").Node): string | undefined => {
  let current: import("ts-morph").Node | undefined = node.getParent()
  while (current !== undefined) {
    if (Node.isVariableDeclaration(current) || Node.isPropertyAssignment(current)) {
      return current.getName()
    }
    current = current.getParent()
  }
  return undefined
}

const contextualObjectPropertyCallbackName = (
  property: import("ts-morph").PropertyAssignment,
): string | undefined => {
  const objectLiteral = property.getParent()
  if (!Node.isObjectLiteralExpression(objectLiteral)) return undefined

  const call = objectLiteral.getParent()
  if (!Node.isCallExpression(call)) return undefined

  const propertyName = property.getName()
  const callee = callExpressionName(call)
  const owner = nearestCallbackOwnerName(call)

  if (owner !== undefined && callee !== undefined) return `${owner}/${callee}/${propertyName}`
  if (owner !== undefined) return `${owner}/${propertyName}`
  if (callee !== undefined) return `${callee}/${propertyName}`
  return undefined
}

const callExpressionName = (call: import("ts-morph").CallExpression): string | undefined => {
  const expression = call.getExpression()
  if (Node.isIdentifier(expression)) return expression.getText()
  if (Node.isPropertyAccessExpression(expression)) return expression.getText()
  return undefined
}
