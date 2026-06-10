import { ts } from "ts-morph"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import { expressionName, isFunctionLikeNode } from "./ts-ld-09-ast.js"

type CallbackTarget = ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression

interface ParameterBearer {
  readonly parameters: ts.NodeArray<ts.ParameterDeclaration>
}

const FALLBACK_NAME_PATTERN = /(?:fallback|default|empty|nullResult|noop)/iu

export const blockReturnsFallback = (
  block: ts.Block,
  sourceFile: ts.SourceFile,
  errorBinding?: string,
): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (isFunctionLikeNode(node) && node !== block.parent) return
    if (
      ts.isReturnStatement(node) &&
      returnExpressionIsFallback(node.expression, sourceFile, errorBinding)
    ) {
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
    return returnExpressionIsFallback(callback.body, sourceFile, firstParameterBinding(callback))
  }
  if (isFunctionWithBlockBody(callback)) {
    return blockReturnsFallback(callback.body, sourceFile, firstParameterBinding(callback))
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
    if (ts.isReturnStatement(node) || ts.isThrowStatement(node) || isProcessTerminalCall(node)) {
      exits = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(block)
  return !exits
}

export const firstParameterBinding = (node: ParameterBearer): string | undefined => {
  const parameter = node.parameters[0]
  return parameter !== undefined && ts.isIdentifier(parameter.name)
    ? parameter.name.text
    : undefined
}

export const catchClauseErrorBinding = (clause: ts.CatchClause): string | undefined => {
  const name = clause.variableDeclaration?.name
  return name !== undefined && ts.isIdentifier(name) ? name.text : undefined
}

const isProcessTerminalCall = (node: ts.Node): boolean =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "process" &&
  (node.expression.name.text === "exit" || node.expression.name.text === "abort")

const returnExpressionIsFallback = (
  expression: ts.Expression | undefined,
  sourceFile: ts.SourceFile,
  errorBinding?: string,
): boolean => {
  if (expression === undefined) return true
  const value = unwrapValueExpression(expression)
  if (isErrorLikeValue(value, sourceFile)) return false
  if (errorBinding !== undefined && referencesErrorBinding(value, errorBinding)) return false
  if (isLiteralFallback(value)) return true
  return expressionHasFallbackShape(value)
}

const isLiteralFallback = (expression: ts.Expression): boolean =>
  ts.isStringLiteralLike(expression) ||
  ts.isNumericLiteral(expression) ||
  expression.kind === ts.SyntaxKind.TrueKeyword ||
  expression.kind === ts.SyntaxKind.FalseKeyword ||
  expression.kind === ts.SyntaxKind.NullKeyword ||
  expression.kind === ts.SyntaxKind.UndefinedKeyword ||
  ts.isVoidExpression(expression) ||
  (ts.isIdentifier(expression) && expression.text === "undefined") ||
  ts.isObjectLiteralExpression(expression) ||
  ts.isArrayLiteralExpression(expression)

const isErrorLikeValue = (expression: ts.Expression, sourceFile: ts.SourceFile): boolean => {
  if (ts.isNewExpression(expression)) {
    const name = expressionName(expression.expression)
    if (name === undefined) return false
    return /Error$/u.test(name) || classHeritageIsErrorLike(name, sourceFile)
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some(isTagProperty)
  }
  return false
}

const isTagProperty = (property: ts.ObjectLiteralElementLike): boolean =>
  (ts.isPropertyAssignment(property) ||
    ts.isShorthandPropertyAssignment(property) ||
    ts.isMethodDeclaration(property)) &&
  propertyNameText(property.name) === "_tag"

const classHeritageIsErrorLike = (className: string, sourceFile: ts.SourceFile): boolean => {
  let errorLike = false
  const visit = (node: ts.Node): void => {
    if (errorLike) return
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      errorLike = (node.heritageClauses ?? []).some((clause) =>
        clause.types.some((type) => /Error\b/u.test(type.expression.getText(sourceFile))),
      )
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return errorLike
}

const referencesErrorBinding = (expression: ts.Expression, binding: string): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === binding && isValueReferencePosition(node)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(expression)
  return found
}

const isValueReferencePosition = (identifier: ts.Identifier): boolean => {
  const parent = identifier.parent
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false
  if (ts.isPropertyAssignment(parent) && parent.name === identifier) return false
  if (ts.isMethodDeclaration(parent) && parent.name === identifier) return false
  return true
}

const expressionHasFallbackShape = (expression: ts.Expression): boolean => {
  const value = unwrapValueExpression(expression)
  if (ts.isIdentifier(value)) return FALLBACK_NAME_PATTERN.test(value.text)
  if (ts.isPropertyAccessExpression(value)) {
    return (
      FALLBACK_NAME_PATTERN.test(value.name.text) || expressionHasFallbackShape(value.expression)
    )
  }
  if (ts.isElementAccessExpression(value)) return expressionHasFallbackShape(value.expression)
  if (ts.isCallExpression(value) || ts.isNewExpression(value)) {
    return expressionHasFallbackShape(value.expression)
  }
  if (ts.isAwaitExpression(value)) return expressionHasFallbackShape(value.expression)
  if (ts.isConditionalExpression(value)) {
    return expressionHasFallbackShape(value.whenTrue) || expressionHasFallbackShape(value.whenFalse)
  }
  if (ts.isBinaryExpression(value)) {
    return expressionHasFallbackShape(value.left) || expressionHasFallbackShape(value.right)
  }
  return false
}

const unwrapValueExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
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
