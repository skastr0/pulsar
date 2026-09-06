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
import { isCompilerFunctionLike } from "./shared-compiler-functions.js"

export const catchHasGuardedFallbackAndPropagation = (
  clause: import("../tsgo-api.js").CatchClause,
  sourceFile: import("../tsgo-api.js").SourceFile,
): boolean => {
  const variable = clause.variableDeclaration?.name
  if (variable === undefined || !isIdentifier(variable)) return false
  const variableName = variable.text

  let guardedFallback = false
  let propagatesError = false

  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (isCompilerFunctionLike(node)) return
    if (isIfStatement(node) && conditionMentions(node.expression, variableName, sourceFile)) {
      guardedFallback =
        guardedFallback ||
        statementReturnsFallback(node.thenStatement) ||
        (node.elseStatement !== undefined && statementReturnsFallback(node.elseStatement))
    }
    if (isThrowStatement(node) || textStartsWithEffectFail(node, sourceFile)) {
      propagatesError = true
      return
    }
    node.forEachChild(visit)
  }

  visit(clause.block)
  return guardedFallback && propagatesError
}

const statementReturnsFallback = (statement: import("../tsgo-api.js").Node): boolean => {
  let found = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (found) return
    if (isCompilerFunctionLike(node)) return
    if (isReturnStatement(node) && isFallbackExpression(node.expression)) {
      found = true
      return
    }
    node.forEachChild(visit)
  }
  visit(statement)
  return found
}

const conditionMentions = (
  condition: import("../tsgo-api.js").Node,
  variable: string,
  sourceFile: import("../tsgo-api.js").SourceFile,
): boolean => {
  let found = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (found) return
    if (isIdentifier(node) && node.text === variable) {
      found = true
      return
    }
    node.forEachChild(visit)
  }
  visit(condition)
  return found || textOf(condition, sourceFile).includes(variable)
}

const isFallbackExpression = (expression: import("../tsgo-api.js").Node | undefined): boolean =>
  expression === undefined ||
  isStringLiteral(expression) ||
  isNumericLiteral(expression) ||
  expression.kind === SyntaxKind.TrueKeyword ||
  expression.kind === SyntaxKind.FalseKeyword ||
  expression.kind === SyntaxKind.NullKeyword ||
  expression.kind === SyntaxKind.UndefinedKeyword ||
  isVoidExpression(expression) ||
  isObjectLiteralExpression(expression) ||
  isArrayLiteralExpression(expression) ||
  (isIdentifier(expression) && expression.text === "undefined")

const textStartsWithEffectFail = (node: import("../tsgo-api.js").Node, sourceFile: import("../tsgo-api.js").SourceFile): boolean =>
  isCallExpression(node) && textOf(node.expression, sourceFile) === "Effect.fail"
