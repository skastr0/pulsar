import { textOf } from "../ast.js"
import {
  SyntaxKind,
  isArrayLiteralExpression,
  isAsExpression,
  isAwaitExpression,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isCatchClause,
  isClassDeclaration,
  isConditionalExpression,
  isElementAccessExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isArrowFunction,
  isIdentifier,
  isIfStatement,
  isMethodDeclaration,
  isNewExpression,
  isNonNullExpression,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isObjectLiteralExpression,
  isParenthesizedExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSatisfiesExpression,
  isShorthandPropertyAssignment,
  isStringLiteral,
  isThrowStatement,
  isTypeOfExpression,
  isVariableDeclaration,
  isVoidExpression,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import { expressionName, isFunctionLikeNode } from "./ts-ld-09-ast.js"

type CallbackTarget = import("../tsgo-api.js").ArrowFunction | import("../tsgo-api.js").FunctionDeclaration | import("../tsgo-api.js").FunctionExpression

interface ParameterBearer {
  readonly parameters: ReadonlyArray<import("../tsgo-api.js").ParameterDeclaration>
}

const FALLBACK_NAME_PATTERN = /(?:fallback|default|empty|nullResult|noop)/iu

export const blockReturnsFallback = (
  block: import("../tsgo-api.js").Block,
  sourceFile: import("../tsgo-api.js").SourceFile,
  errorBinding?: string,
): boolean => {
  let found = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (found) return
    if (isFunctionLikeNode(node) && node !== block.parent) return
    if (
      isReturnStatement(node) &&
      returnExpressionIsFallback(node.expression, sourceFile, errorBinding)
    ) {
      found = true
      return
    }
    node.forEachChild(visit)
  }
  visit(block)
  return found
}

export const callbackReturnsFallback = (
  callback: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  typeChecker?: unknown,
): boolean => {
  const target = callbackTarget(callback, sourceFile, typeChecker)
  if (target !== undefined) return callbackReturnsFallback(target, sourceFile, typeChecker)
  if (isArrowFunction(callback) && callback.body !== undefined && !isBlock(callback.body)) {
    return returnExpressionIsFallback(callback.body, sourceFile, firstParameterBinding(callback))
  }
  if (isFunctionWithBlockBody(callback)) {
    return blockReturnsFallback(callback.body, sourceFile, firstParameterBinding(callback))
  }
  return false
}

export const callbackCollapsesError = (
  callback: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  typeChecker?: unknown,
): boolean => {
  if (callbackReturnsFallback(callback, sourceFile, typeChecker)) return true
  const target = callbackTarget(callback, sourceFile, typeChecker)
  if (target !== undefined) return callbackCollapsesError(target, sourceFile, typeChecker)
  return isFunctionWithBlockBody(callback) ? blockSwallowsError(callback.body) : false
}

export const blockSwallowsError = (block: import("../tsgo-api.js").Block): boolean => {
  if (block.statements.length === 0) return true
  let exits = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (exits) return
    if (isFunctionLikeNode(node) && node !== block.parent) return
    if (isReturnStatement(node) || isThrowStatement(node) || isProcessTerminalCall(node)) {
      exits = true
      return
    }
    node.forEachChild(visit)
  }
  visit(block)
  return !exits
}

export const firstParameterBinding = (node: ParameterBearer): string | undefined => {
  const parameter = node.parameters[0]
  return parameter !== undefined && isIdentifier(parameter.name)
    ? parameter.name.text
    : undefined
}

export const catchClauseErrorBinding = (clause: import("../tsgo-api.js").CatchClause): string | undefined => {
  const name = clause.variableDeclaration?.name
  return name !== undefined && isIdentifier(name) ? name.text : undefined
}

const isProcessTerminalCall = (node: import("../tsgo-api.js").Node): boolean =>
  isCallExpression(node) &&
  isPropertyAccessExpression(node.expression) &&
  isIdentifier(node.expression.expression) &&
  node.expression.expression.text === "process" &&
  (node.expression.name.text === "exit" || node.expression.name.text === "abort")

const returnExpressionIsFallback = (
  expression: import("../tsgo-api.js").Node | undefined,
  sourceFile: import("../tsgo-api.js").SourceFile,
  errorBinding?: string,
): boolean => {
  if (expression === undefined) return true
  const value = unwrapValueExpression(expression)
  if (isErrorLikeValue(value, sourceFile)) return false
  if (errorBinding !== undefined && referencesErrorBinding(value, errorBinding)) return false
  if (isLiteralFallback(value)) return true
  return expressionHasFallbackShape(value)
}

const isLiteralFallback = (expression: import("../tsgo-api.js").Node): boolean =>
  (isStringLiteral(expression) || isNoSubstitutionTemplateLiteral(expression)) ||
  isNumericLiteral(expression) ||
  expression.kind === SyntaxKind.TrueKeyword ||
  expression.kind === SyntaxKind.FalseKeyword ||
  expression.kind === SyntaxKind.NullKeyword ||
  expression.kind === SyntaxKind.UndefinedKeyword ||
  isVoidExpression(expression) ||
  (isIdentifier(expression) && expression.text === "undefined") ||
  isObjectLiteralExpression(expression) ||
  isArrayLiteralExpression(expression)

const isErrorLikeValue = (expression: import("../tsgo-api.js").Node, sourceFile: import("../tsgo-api.js").SourceFile): boolean => {
  if (isNewExpression(expression)) {
    const name = expressionName(expression.expression)
    if (name === undefined) return false
    return /Error$/u.test(name) || classHeritageIsErrorLike(name, sourceFile)
  }
  if (isObjectLiteralExpression(expression)) {
    return expression.properties.some(isTagProperty)
  }
  return false
}

const isTagProperty = (property: import("../tsgo-api.js").Node): boolean =>
  (isPropertyAssignment(property) ||
    isShorthandPropertyAssignment(property) ||
    isMethodDeclaration(property)) &&
  propertyNameText(property.name) === "_tag"

const classHeritageIsErrorLike = (className: string, sourceFile: import("../tsgo-api.js").SourceFile): boolean => {
  let errorLike = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (errorLike) return
    if (isClassDeclaration(node) && node.name?.text === className) {
      errorLike = (node.heritageClauses ?? []).some((clause) =>
        clause.types.some((type) => /Error\b/u.test(textOf(type.expression, sourceFile))),
      )
      return
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return errorLike
}

const referencesErrorBinding = (expression: import("../tsgo-api.js").Node, binding: string): boolean => {
  let found = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (found) return
    if (isIdentifier(node) && node.text === binding && isValueReferencePosition(node)) {
      found = true
      return
    }
    node.forEachChild(visit)
  }
  visit(expression)
  return found
}

const isValueReferencePosition = (identifier: import("../tsgo-api.js").Identifier): boolean => {
  const parent = identifier.parent
  if (isPropertyAccessExpression(parent) && parent.name === identifier) return false
  if (isPropertyAssignment(parent) && parent.name === identifier) return false
  if (isMethodDeclaration(parent) && parent.name === identifier) return false
  return true
}

const expressionHasFallbackShape = (expression: import("../tsgo-api.js").Node): boolean => {
  const value = unwrapValueExpression(expression)
  if (isIdentifier(value)) return FALLBACK_NAME_PATTERN.test(value.text)
  if (isPropertyAccessExpression(value)) {
    return (
      FALLBACK_NAME_PATTERN.test(isIdentifier(value.name) ? value.name.text : textOf(value.name)) || expressionHasFallbackShape(value.expression)
    )
  }
  if (isElementAccessExpression(value)) return expressionHasFallbackShape(value.expression)
  if (isCallExpression(value) || isNewExpression(value)) {
    return expressionHasFallbackShape(value.expression)
  }
  if (isAwaitExpression(value)) return expressionHasFallbackShape(value.expression)
  if (isConditionalExpression(value)) {
    return expressionHasFallbackShape(value.whenTrue) || expressionHasFallbackShape(value.whenFalse)
  }
  if (isBinaryExpression(value)) {
    return expressionHasFallbackShape(value.left) || expressionHasFallbackShape(value.right)
  }
  return false
}

const unwrapValueExpression = (expression: import("../tsgo-api.js").Node): import("../tsgo-api.js").Node => {
  let current = expression
  while (
    isParenthesizedExpression(current) ||
    isAsExpression(current) ||
    isSatisfiesExpression(current) ||
    isNonNullExpression(current)
  ) {
    current = current.expression
  }
  return current
}

const callbackTarget = (
  callback: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  typeChecker?: unknown,
): CallbackTarget | undefined => {
  if (!isIdentifier(callback)) return undefined
  const symbolTarget = callbackSymbolTarget(callback, typeChecker)
  if (symbolTarget !== undefined) return symbolTarget
  return lexicalCallbackTarget(callback)
}

const callbackSymbolTarget = (
  _callback: import("../tsgo-api.js").Identifier,
  _typeChecker?: unknown,
): CallbackTarget | undefined => undefined

const lexicalCallbackTarget = (
  callback: import("../tsgo-api.js").Identifier,
): CallbackTarget | undefined => {
  const targetName = callback.text
  let current: import("../tsgo-api.js").Node | undefined = callback.parent
  while (current !== undefined) {
    const binding = nearestBindingInScope(current, targetName)
    if (binding !== undefined) return binding
    current = current.parent
  }
  return undefined
}

const nearestBindingInScope = (
  scope: import("../tsgo-api.js").Node,
  targetName: string,
): CallbackTarget | undefined => {
  if (isFunctionDeclaration(scope) && scope.name?.text === targetName) {
    return scope
  }
  if (isNamedFunctionVariable(scope, targetName)) {
    return scope.initializer
  }
  if (isBlock(scope) || scope.kind === SyntaxKind.SourceFile) {
    let found: CallbackTarget | undefined
    const visit = (node: import("../tsgo-api.js").Node): void => {
      if (found !== undefined) return
      if (isFunctionDeclaration(node) && node.name?.text === targetName) {
        found = node
        return
      }
      if (isNamedFunctionVariable(node, targetName)) {
        found = node.initializer
        return
      }
      if (!isFunctionLikeNode(node)) node.forEachChild(visit)
    }
    scope.forEachChild(visit)
    return found
  }
  return undefined
}

const isNamedFunctionVariable = (
  node: import("../tsgo-api.js").Node,
  targetName: string,
): node is import("../tsgo-api.js").VariableDeclaration & { readonly initializer: import("../tsgo-api.js").ArrowFunction | import("../tsgo-api.js").FunctionExpression } =>
  isVariableDeclaration(node) &&
  isIdentifier(node.name) &&
  node.name.text === targetName &&
  node.initializer !== undefined &&
  (isArrowFunction(node.initializer) || isFunctionExpression(node.initializer))

const isFunctionWithBlockBody = (
  node: import("../tsgo-api.js").Node,
): node is (import("../tsgo-api.js").ArrowFunction | import("../tsgo-api.js").FunctionExpression | import("../tsgo-api.js").FunctionDeclaration) & { readonly body: import("../tsgo-api.js").Block } =>
  (isArrowFunction(node) || isFunctionExpression(node) || isFunctionDeclaration(node)) &&
  node.body !== undefined &&
  isBlock(node.body)
