import {
  SyntaxKind,
  isArrayLiteralExpression,
  isBinaryExpression,
  isCallExpression,
  isCatchClause,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isObjectLiteralExpression,
  isThrowStatement,
  isTypeOfExpression,
  isStringLiteral,
} from "../tsgo-api.js"
import {
  expressionName,
  isEffectFailCall,
  isFunctionLikeNode,
  nearestBoundaryOwner,
  nearestFunctionName
} from "./ts-ld-09-ast.js"
import { textOf } from "../ast.js"
import {
  blockReturnsFallback,
  blockSwallowsError,
  catchClauseErrorBinding,
} from "./ts-ld-09-collapse.js"
import { localErrorChannelFinding } from "./ts-ld-09-finding.js"
import { catchHasGuardedFallbackAndPropagation } from "./ts-ld-09-guarded-catch.js"
import {
  BUILT_IN_ERROR_NAMES,
  type ErrorChannelCollapseMode,
  type LocalErrorChannelFinding,
} from "./ts-ld-09-types.js"

export const collectBroadThrow = (
  node: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  exportedNames: ReadonlySet<string>,
): LocalErrorChannelFinding | undefined => {
  if (!isThrowStatement(node) || node.expression === undefined) return undefined
  const collapse = broadThrowCollapseMode(node.expression)
  if (collapse === undefined) return undefined

  const boundary = nearestBoundaryOwner(node, exportedNames)
  const symbol = nearestFunctionName(node, sourceFile) ?? "<top-level>"
  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol,
    kind: "broad-throw",
    expressionText: textOf(node.expression).slice(0, 200),
    boundary,
    expectedFailureEvidence: broadThrowEvidence(node.expression, sourceFile),
    collapseMode: collapse,
  })
}

export const collectCatchCollapse = (
  node: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  exportedNames: ReadonlySet<string>,
): LocalErrorChannelFinding | undefined => {
  if (!isCatchClause(node)) return undefined
  if (!catchCollapsesErrorChannel(node, sourceFile)) return undefined

  const boundary = nearestBoundaryOwner(node, exportedNames)
  const symbol = nearestFunctionName(node, sourceFile) ?? "<catch>"
  const collapseMode = blockReturnsFallback(node.block, sourceFile, catchClauseErrorBinding(node))
    ? "fallback"
    : "swallowed"
  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol,
    kind: "catch-without-narrowing",
    expressionText: textOf(node.block).slice(0, 200),
    boundary,
    expectedFailureEvidence: catchEvidence(node, sourceFile),
    collapseMode,
  })
}

export const broadThrowCollapseMode = (
  expression: import("../tsgo-api.js").Node,
): ErrorChannelCollapseMode | undefined => {
  if (isStringLiteral(expression) || isNoSubstitutionTemplateLiteral(expression)) {
    return "generic-error"
  }
  if (isObjectLiteralExpression(expression) || isArrayLiteralExpression(expression)) {
    return "generic-error"
  }
  if (isCallExpression(expression) && expressionName(expression.expression) === "Error") {
    return "generic-error"
  }
  if (isNewExpression(expression)) {
    const name = expressionName(expression.expression)
    return name !== undefined && BUILT_IN_ERROR_NAMES.has(name) ? "generic-error" : undefined
  }
  return undefined
}

export const catchCollapsesErrorChannel = (
  clause: import("../tsgo-api.js").CatchClause,
  sourceFile: import("../tsgo-api.js").SourceFile,
): boolean => {
  const block = clause.block
  if (blockContainsCatchVariableNarrowing(clause, sourceFile) && blockRethrows(block)) return false
  if (catchHasGuardedFallbackAndPropagation(clause, sourceFile)) return false
  const collapses =
    blockReturnsFallback(block, sourceFile, catchClauseErrorBinding(clause)) ||
    blockSwallowsError(block)
  if (!collapses && blockContainsDomainErrorMapping(block)) return false
  return collapses
}

const broadThrowEvidence = (
  expression: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
): ReadonlyArray<string> => {
  if (isNewExpression(expression)) {
    const name = expressionName(expression.expression)
    return [`throws ${name ?? textOf(expression.expression)}`]
  }
  if (isCallExpression(expression)) {
    return [`throws ${textOf(expression.expression)}(...)`]
  }
  return [`throws ${textOf(expression).slice(0, 80)}`]
}

const catchEvidence = (
  clause: import("../tsgo-api.js").CatchClause,
  sourceFile: import("../tsgo-api.js").SourceFile,
): ReadonlyArray<string> => {
  const variable = catchClauseErrorBinding(clause)
  return [
    blockSwallowsError(clause.block)
      ? "catch block swallows error without typed mapping"
      : variable === undefined
      ? "catch block returns fallback without error binding"
      : `catch(${variable}) returns fallback without typed mapping`,
  ]
}

const blockContainsDomainErrorMapping = (block: import("../tsgo-api.js").Block): boolean => {
  let found = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (found) return
    if (isFunctionLikeNode(node) && node !== block.parent) return
    if (isNewExpression(node)) {
      const name = expressionName(node.expression)
      if (name !== undefined && /[A-Z][A-Za-z0-9]*Error$/u.test(name) && !BUILT_IN_ERROR_NAMES.has(name)) {
        found = true
        return
      }
    }
    if (isEffectFailCall(node)) {
      found = true
      return
    }
    node.forEachChild(visit)
  }
  visit(block)
  return found
}

const blockContainsCatchVariableNarrowing = (
  clause: import("../tsgo-api.js").CatchClause,
  sourceFile: import("../tsgo-api.js").SourceFile,
): boolean => {
  const variable = catchClauseErrorBinding(clause)
  if (variable === undefined) return false
  let found = false
  const visit = (node: import("../tsgo-api.js").Node): void => {
    if (found) return
    if (isFunctionLikeNode(node) && node !== clause.parent) return
    if (
      isBinaryExpression(node) &&
      node.operatorToken.kind === SyntaxKind.InstanceOfKeyword &&
      textOf(node.left, sourceFile) === variable
    ) {
      found = true
      return
    }
    if (
      isTypeOfExpression(node) &&
      textOf(node.expression, sourceFile) === variable
    ) {
      found = true
      return
    }
    node.forEachChild(visit)
  }
  visit(clause.block)
  return found
}

const blockRethrows = (block: import("../tsgo-api.js").Block): boolean =>
  block.statements.some((statement) => isThrowStatement(statement))
