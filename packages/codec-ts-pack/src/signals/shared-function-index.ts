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
} from "ts-morph"

export type TsFunctionLike =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | ConstructorDeclaration
  | GetAccessorDeclaration
  | SetAccessorDeclaration

export interface TsFunctionIndexEntry {
  readonly sourceFile: SourceFile
  readonly path: string
  readonly fn: TsFunctionLike
}

const indexByProject = new WeakMap<Project, ReadonlyArray<TsFunctionIndexEntry>>()
const indexBySourceFile = new WeakMap<SourceFile, ReadonlyArray<TsFunctionIndexEntry>>()
const bodyByFunction = new WeakMap<TsFunctionLike, string | undefined>()

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
  sourceFile.forEachDescendant((node) => {
    if (
      Node.isFunctionDeclaration(node) ||
      Node.isMethodDeclaration(node) ||
      Node.isArrowFunction(node) ||
      Node.isFunctionExpression(node) ||
      Node.isConstructorDeclaration(node) ||
      Node.isGetAccessorDeclaration(node) ||
      Node.isSetAccessorDeclaration(node)
    ) {
      entries.push({ sourceFile, path, fn: node as TsFunctionLike })
    }
  })

  indexBySourceFile.set(sourceFile, entries)
  return entries
}

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
    if (Node.isVariableDeclaration(parent) || Node.isPropertyAssignment(parent)) {
      return parent.getName()
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

const callExpressionName = (call: import("ts-morph").CallExpression): string | undefined => {
  const expression = call.getExpression()
  if (Node.isIdentifier(expression)) return expression.getText()
  if (Node.isPropertyAccessExpression(expression)) return expression.getText()
  return undefined
}
