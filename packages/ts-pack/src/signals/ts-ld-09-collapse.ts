import { ts } from "ts-morph"
import { isFunctionLikeNode } from "./ts-ld-09-ast.js"

type CallbackTarget = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression

export const blockReturnsFallback = (
  block: ts.Block,
  sourceFile: ts.SourceFile,
): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (isFunctionLikeNode(node) && node !== block.parent) return
    if (ts.isReturnStatement(node) && returnExpressionIsFallback(node.expression, sourceFile)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(block)
  return found
}

export const callbackReturnsFallback = (
  callback: ts.Node,
  sourceFile: ts.SourceFile,
  typeChecker?: ts.TypeChecker,
): boolean => {
  const target = callbackTarget(callback, sourceFile, typeChecker)
  if (target !== undefined) return callbackReturnsFallback(target, sourceFile, typeChecker)
  if (ts.isArrowFunction(callback) && callback.body !== undefined && !ts.isBlock(callback.body)) {
    return returnExpressionIsFallback(callback.body, sourceFile)
  }
  if (isFunctionWithBlockBody(callback)) {
    return blockReturnsFallback(callback.body, sourceFile)
  }
  return false
}

export const callbackCollapsesError = (
  callback: ts.Node,
  sourceFile: ts.SourceFile,
  typeChecker?: ts.TypeChecker,
): boolean => {
  if (callbackReturnsFallback(callback, sourceFile, typeChecker)) return true
  const target = callbackTarget(callback, sourceFile, typeChecker)
  if (target !== undefined) return callbackCollapsesError(target, sourceFile, typeChecker)
  return isFunctionWithBlockBody(callback) ? blockSwallowsError(callback.body) : false
}

export const blockSwallowsError = (block: ts.Block): boolean => {
  if (block.statements.length === 0) return true
  let exits = false
  const visit = (node: ts.Node): void => {
    if (exits) return
    if (isFunctionLikeNode(node) && node !== block.parent) return
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node)) {
      exits = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(block)
  return !exits
}

const returnExpressionIsFallback = (
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
): boolean => {
  if (expression === undefined) return true
  if (
    ts.isStringLiteral(expression) ||
    ts.isNumericLiteral(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    expression.kind === ts.SyntaxKind.UndefinedKeyword ||
    ts.isVoidExpression(expression) ||
    (ts.isIdentifier(expression) && expression.text === "undefined") ||
    ts.isObjectLiteralExpression(expression) ||
    ts.isArrayLiteralExpression(expression)
  ) {
    return true
  }
  const text = expression.getText(sourceFile)
  return /(?:fallback|default|empty|nullResult|noop)/iu.test(text)
}

const callbackTarget = (
  callback: ts.Node,
  sourceFile: ts.SourceFile,
  typeChecker?: ts.TypeChecker,
): CallbackTarget | undefined => {
  if (!ts.isIdentifier(callback)) return undefined
  const symbolTarget = callbackSymbolTarget(callback, typeChecker)
  if (symbolTarget !== undefined) return symbolTarget
  return lexicalCallbackTarget(callback.text, sourceFile)
}

const callbackSymbolTarget = (
  callback: ts.Identifier,
  typeChecker?: ts.TypeChecker,
): CallbackTarget | undefined => {
  const declaration = typeChecker?.getSymbolAtLocation(callback)?.valueDeclaration
  if (declaration === undefined) return undefined
  if (ts.isFunctionDeclaration(declaration)) return declaration
  if (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer !== undefined &&
    (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
  ) {
    return declaration.initializer
  }
  return undefined
}

const lexicalCallbackTarget = (
  targetName: string,
  sourceFile: ts.SourceFile,
): CallbackTarget | undefined => {
  let target: CallbackTarget | undefined
  const visit = (node: ts.Node): void => {
    if (target !== undefined) return
    if (ts.isFunctionDeclaration(node) && node.name?.text === targetName) {
      target = node
      return
    }
    if (isNamedFunctionVariable(node, targetName)) {
      target = node.initializer
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return target
}

const isNamedFunctionVariable = (
  node: ts.Node,
  targetName: string,
): node is ts.VariableDeclaration & { readonly initializer: ts.ArrowFunction | ts.FunctionExpression } =>
  ts.isVariableDeclaration(node) &&
  ts.isIdentifier(node.name) &&
  node.name.text === targetName &&
  node.initializer !== undefined &&
  (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))

const isFunctionWithBlockBody = (
  node: ts.Node,
): node is (ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration) & { readonly body: ts.Block } =>
  (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) &&
  node.body !== undefined &&
  ts.isBlock(node.body)
