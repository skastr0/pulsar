import { textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isBlock,
  isCallExpression,
  isConstructorDeclaration,
  isExportAssignment,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isMethodDeclaration,
  isPropertyAssignment,
  isPropertyAccessExpression,
  isSetAccessorDeclaration,
  isStringLiteral,
  isVariableDeclaration,
  type ArrowFunction,
  type ConstructorDeclaration,
  type FunctionDeclaration,
  type FunctionExpression,
  type GetAccessorDeclaration,
  type MethodDeclaration,
  type Node,
  type SetAccessorDeclaration,
  type SourceFile,
} from "../tsgo-api.js"

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

const indexBySourceFile = new WeakMap<SourceFile, ReadonlyArray<TsFunctionIndexEntry>>()
const bodyByFunction = new WeakMap<TsFunctionLike, string | undefined>()
const nameByFunction = new WeakMap<TsFunctionLike, string>()

export const getFunctionLikeIndex = (
  sourceFiles: ReadonlyArray<SourceFile>,
): ReadonlyArray<TsFunctionIndexEntry> =>
  sourceFiles.flatMap((sourceFile) => getFunctionLikeEntriesForSourceFile(sourceFile))

export const getFunctionLikeEntriesForSourceFile = (
  sourceFile: SourceFile,
): ReadonlyArray<TsFunctionIndexEntry> => {
  const cached = indexBySourceFile.get(sourceFile)
  if (cached !== undefined) return cached

  const path = sourceFile.fileName
  const entries: Array<TsFunctionIndexEntry> = []
  walkDescendants(sourceFile, (node) => {
    if (isFunctionLike(node)) entries.push({ sourceFile, path, fn: node })
  })
  indexBySourceFile.set(sourceFile, entries)
  return entries
}

const isFunctionLike = (node: Node): node is TsFunctionLike =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node) ||
  isConstructorDeclaration(node) ||
  isGetAccessorDeclaration(node) ||
  isSetAccessorDeclaration(node)

export const getFunctionBody = (fn: TsFunctionLike): string | undefined => {
  if (bodyByFunction.has(fn)) return bodyByFunction.get(fn)
  const body = "body" in fn ? fn.body : undefined
  const bodyText = body === undefined ? undefined : textOf(body)
  bodyByFunction.set(fn, bodyText)
  return bodyText
}

export const getFunctionName = (fn: TsFunctionLike): string => {
  const cached = nameByFunction.get(fn)
  if (cached !== undefined) return cached
  const name = computeFunctionName(fn)
  nameByFunction.set(fn, name)
  return name
}

const computeFunctionName = (fn: TsFunctionLike): string => {
  if (isFunctionDeclaration(fn) || isMethodDeclaration(fn) || isFunctionExpression(fn)) {
    if (fn.name !== undefined) return textOf(fn.name)
  }
  if (isArrowFunction(fn) || isFunctionExpression(fn)) {
    const parent = fn.parent
    if (isVariableDeclaration(parent) && isIdentifier(parent.name)) return parent.name.text
    if (isPropertyAssignment(parent)) {
      const contextualName = contextualObjectPropertyCallbackName(parent)
      return contextualName ?? textOf(parent.name)
    }
    if (isExportAssignment(parent)) return "<default export>"
    const callbackName = contextualCallbackName(fn)
    if (callbackName !== undefined) return callbackName
  }
  if (isConstructorDeclaration(fn)) return "constructor"
  if (isGetAccessorDeclaration(fn)) return `get ${textOf(fn.name)}`
  if (isSetAccessorDeclaration(fn)) return `set ${textOf(fn.name)}`
  return "<anonymous>"
}

const contextualCallbackName = (fn: ArrowFunction | FunctionExpression): string | undefined => {
  const parent = fn.parent
  if (!isCallExpression(parent)) return undefined
  const labelledEffectName = effectFnLabel(parent)
  if (labelledEffectName !== undefined) return labelledEffectName
  const callee = callExpressionName(parent)
  const owner = nearestCallbackOwnerName(parent)
  if (owner !== undefined && callee !== undefined) return `${owner}/${callee}`
  if (owner !== undefined) return `${owner} callback`
  if (callee !== undefined) return `${callee} callback`
  return undefined
}

const effectFnLabel = (call: import("../tsgo-api.js").CallExpression): string | undefined => {
  const expression = call.expression
  if (!isCallExpression(expression)) return undefined
  if (textOf(expression.expression) !== "Effect.fn") return undefined
  const labelArg = expression.arguments[0]
  return isStringLiteral(labelArg) ? labelArg.text : undefined
}

const nearestCallbackOwnerName = (node: Node): string | undefined => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (isVariableDeclaration(current) && isIdentifier(current.name)) return current.name.text
    if (isPropertyAssignment(current)) return textOf(current.name)
    current = current.parent
  }
  return undefined
}

const contextualObjectPropertyCallbackName = (
  property: import("../tsgo-api.js").PropertyAssignment,
): string | undefined => {
  const objectLiteral = property.parent
  if (objectLiteral.kind !== SyntaxKind.ObjectLiteralExpression) return undefined
  const call = objectLiteral.parent
  if (!isCallExpression(call)) return undefined
  const propertyName = textOf(property.name)
  const callee = callExpressionName(call)
  const owner = nearestCallbackOwnerName(call)
  if (owner !== undefined && callee !== undefined) return `${owner}/${callee}/${propertyName}`
  if (owner !== undefined) return `${owner}/${propertyName}`
  if (callee !== undefined) return `${callee}/${propertyName}`
  return undefined
}

const callExpressionName = (call: import("../tsgo-api.js").CallExpression): string | undefined => {
  const expression = call.expression
  if (isIdentifier(expression) || isPropertyAccessExpression(expression)) return textOf(expression)
  return undefined
}

export const functionStartLine = (fn: TsFunctionLike): number => {
  const sourceFile = fn.getSourceFile()
  return sourceFile.getLineAndCharacterOfPosition(fn.getStart(sourceFile)).line + 1
}

export const functionEndLine = (fn: TsFunctionLike): number => {
  const sourceFile = fn.getSourceFile()
  return sourceFile.getLineAndCharacterOfPosition(fn.end).line + 1
}

export const functionHasBlockBody = (fn: TsFunctionLike): boolean =>
  "body" in fn && fn.body !== undefined && isBlock(fn.body)

export const functionBodyNode = (fn: TsFunctionLike): Node | undefined =>
  "body" in fn ? fn.body : undefined
