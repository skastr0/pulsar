import { ts } from "ts-morph"
import { isCompilerFunctionLike } from "./shared-compiler-functions.js"

export const catchHasGuardedFallbackAndPropagation = (
  clause: ts.CatchClause,
  sourceFile: ts.SourceFile,
): boolean => {
  const variable = clause.variableDeclaration?.name.getText(sourceFile)
  if (variable === undefined) return false

  let guardedFallback = false
  let propagatesError = false

  const visit = (node: ts.Node): void => {
    if (isCompilerFunctionLike(node)) return
    if (ts.isIfStatement(node) && conditionMentions(node.expression, variable, sourceFile)) {
      guardedFallback =
        guardedFallback ||
        statementReturnsFallback(node.thenStatement) ||
        (node.elseStatement !== undefined && statementReturnsFallback(node.elseStatement))
    }
    if (ts.isThrowStatement(node) || textStartsWithEffectFail(node, sourceFile)) {
      propagatesError = true
      return
    }
    ts.forEachChild(node, visit)
  }

  visit(clause.block)
  return guardedFallback && propagatesError
}

const statementReturnsFallback = (statement: ts.Statement): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (isCompilerFunctionLike(node)) return
    if (ts.isReturnStatement(node) && isFallbackExpression(node.expression)) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(statement)
  return found
}

const conditionMentions = (
  condition: ts.Expression,
  variable: string,
  sourceFile: ts.SourceFile,
): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node) && node.text === variable) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(condition)
  return found || condition.getText(sourceFile).includes(variable)
}

const isFallbackExpression = (expression: ts.Expression | undefined): boolean =>
  expression === undefined ||
  ts.isStringLiteral(expression) ||
  ts.isNumericLiteral(expression) ||
  expression.kind === ts.SyntaxKind.TrueKeyword ||
  expression.kind === ts.SyntaxKind.FalseKeyword ||
  expression.kind === ts.SyntaxKind.NullKeyword ||
  expression.kind === ts.SyntaxKind.UndefinedKeyword ||
  ts.isVoidExpression(expression) ||
  ts.isObjectLiteralExpression(expression) ||
  ts.isArrayLiteralExpression(expression) ||
  (ts.isIdentifier(expression) && expression.text === "undefined")

const textStartsWithEffectFail = (node: ts.Node, sourceFile: ts.SourceFile): boolean =>
  ts.isCallExpression(node) && node.expression.getText(sourceFile) === "Effect.fail"
