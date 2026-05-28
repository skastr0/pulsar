import {
  expressionName,
  isEffectFailCall,
  isFunctionLikeNode,
  nearestBoundaryOwner,
  nearestFunctionName,
  ts,
} from "./ts-ld-09-ast.js"
import {
  blockReturnsFallback,
  blockSwallowsError,
} from "./ts-ld-09-collapse.js"
import { localErrorChannelFinding } from "./ts-ld-09-finding.js"
import { catchHasGuardedFallbackAndPropagation } from "./ts-ld-09-guarded-catch.js"
import {
  BUILT_IN_ERROR_NAMES,
  type ErrorChannelCollapseMode,
  type LocalErrorChannelFinding,
} from "./ts-ld-09-types.js"

export const collectBroadThrow = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): LocalErrorChannelFinding | undefined => {
  if (!ts.isThrowStatement(node) || node.expression === undefined) return undefined
  const collapse = broadThrowCollapseMode(node.expression)
  if (collapse === undefined) return undefined

  const boundary = nearestBoundaryOwner(node, exportedNames)
  const symbol = nearestFunctionName(node, sourceFile) ?? "<top-level>"
  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol,
    kind: "broad-throw",
    expressionText: node.expression.getText(sourceFile).slice(0, 200),
    boundary,
    expectedFailureEvidence: broadThrowEvidence(node.expression, sourceFile),
    collapseMode: collapse,
  })
}

export const collectCatchCollapse = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): LocalErrorChannelFinding | undefined => {
  if (!ts.isCatchClause(node)) return undefined
  if (!catchCollapsesErrorChannel(node, sourceFile)) return undefined

  const boundary = nearestBoundaryOwner(node, exportedNames)
  const symbol = nearestFunctionName(node, sourceFile) ?? "<catch>"
  const collapseMode = blockReturnsFallback(node.block, sourceFile) ? "fallback" : "swallowed"
  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol,
    kind: "catch-without-narrowing",
    expressionText: node.block.getText(sourceFile).slice(0, 200),
    boundary,
    expectedFailureEvidence: catchEvidence(node, sourceFile),
    collapseMode,
  })
}

export const broadThrowCollapseMode = (
  expression: ts.Expression,
): ErrorChannelCollapseMode | undefined => {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
    return "generic-error"
  }
  if (ts.isObjectLiteralExpression(expression) || ts.isArrayLiteralExpression(expression)) {
    return "generic-error"
  }
  if (ts.isCallExpression(expression) && expressionName(expression.expression) === "Error") {
    return "generic-error"
  }
  if (ts.isNewExpression(expression)) {
    const name = expressionName(expression.expression)
    return name !== undefined && BUILT_IN_ERROR_NAMES.has(name) ? "generic-error" : undefined
  }
  return undefined
}

export const catchCollapsesErrorChannel = (
  clause: ts.CatchClause,
  sourceFile: ts.SourceFile,
): boolean => {
  const block = clause.block
  if (blockContainsCatchVariableNarrowing(clause, sourceFile) && blockRethrows(block)) return false
  if (catchHasGuardedFallbackAndPropagation(clause, sourceFile)) return false
  const collapses = blockReturnsFallback(block, sourceFile) || blockSwallowsError(block)
  if (!collapses && blockContainsDomainErrorMapping(block)) return false
  return collapses
}

const broadThrowEvidence = (
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): ReadonlyArray<string> => {
  if (ts.isNewExpression(expression)) {
    const name = expressionName(expression.expression)
    return [`throws ${name ?? expression.expression.getText(sourceFile)}`]
  }
  if (ts.isCallExpression(expression)) {
    return [`throws ${expression.expression.getText(sourceFile)}(...)`]
  }
  return [`throws ${expression.getText(sourceFile).slice(0, 80)}`]
}

const catchEvidence = (
  clause: ts.CatchClause,
  sourceFile: ts.SourceFile,
): ReadonlyArray<string> => {
  const variable = clause.variableDeclaration?.name.getText(sourceFile)
  return [
    blockSwallowsError(clause.block)
      ? "catch block swallows error without typed mapping"
      : variable === undefined
      ? "catch block returns fallback without error binding"
      : `catch(${variable}) returns fallback without typed mapping`,
  ]
}

const blockContainsDomainErrorMapping = (block: ts.Block): boolean => {
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (isFunctionLikeNode(node) && node !== block.parent) return
    if (ts.isNewExpression(node)) {
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
    ts.forEachChild(node, visit)
  }
  visit(block)
  return found
}

const blockContainsCatchVariableNarrowing = (
  clause: ts.CatchClause,
  sourceFile: ts.SourceFile,
): boolean => {
  const variable = clause.variableDeclaration?.name.getText(sourceFile)
  if (variable === undefined) return false
  let found = false
  const visit = (node: ts.Node): void => {
    if (found) return
    if (isFunctionLikeNode(node) && node !== clause.parent) return
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword &&
      node.left.getText(sourceFile) === variable
    ) {
      found = true
      return
    }
    if (
      ts.isTypeOfExpression(node) &&
      node.expression.getText(sourceFile) === variable
    ) {
      found = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(clause.block)
  return found
}

const blockRethrows = (block: ts.Block): boolean =>
  block.statements.some((statement) => ts.isThrowStatement(statement))
