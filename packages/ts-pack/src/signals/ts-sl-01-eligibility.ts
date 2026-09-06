import { textOf } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isBinaryExpression,
  isBlock,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isJsxExpression,
  isParenthesizedExpression,
  isPropertyAssignment,
  isReturnStatement,
  isSourceFile,
  type ArrowFunction,
  type FunctionExpression,
  type Node,
} from "../tsgo-api.js"
import { functionBodyNode, getFunctionName, type TsFunctionLike as FnLike } from "./shared-function-index.js"

export const isStructuralCloneEligible = (fn: FnLike): boolean => {
  if (isAstPredicateUnionGuard(fn)) {
    return false
  }

  if (isJsxComponentAdapter(fn)) {
    return false
  }

  if (isSvgIconComponent(fn)) {
    return false
  }

  if (isArrowFunction(fn) || isFunctionExpression(fn)) {
    const parent = fn.parent
    if ((isCallExpression(parent) || isPropertyAssignment(parent)) && hasSingleOperationalStatement(fn)) {
      return false
    }
    if (isSmallEffectGenCallback(fn)) {
      return false
    }
  }

  return true
}

const isAstPredicateUnionGuard = (fn: FnLike): boolean => {
  const name = getFunctionName(fn)
  if (!/^is[A-Z]/.test(name)) return false
  const body = functionBodyNode(fn)
  if (body === undefined) return false
  if (body === undefined) return false

  if (isBlock(body)) {
    const statements = body.statements
    if (statements.length !== 1) return false
    const statement = statements[0]
    if (statement === undefined || !isReturnStatement(statement)) return false
    const expression = statement.expression
    return expression !== undefined && isAstPredicateUnionExpression(expression)
  }

  return isAstPredicateUnionExpression(body)
}

const isAstPredicateUnionExpression = (node: Node): boolean => {
  if (isParenthesizedExpression(node)) {
    return isAstPredicateUnionExpression(node.expression)
  }
  if (isBinaryExpression(node) && node.operatorToken.kind === SyntaxKind.BarBarToken) {
    return (
      isAstPredicateUnionExpression(node.left) &&
      isAstPredicateUnionExpression(node.right)
    )
  }
  if (!isCallExpression(node)) return false
  const callee = textOf(node.expression)
  return /^ts\.is[A-Z]/.test(callee) || /^Node\.is[A-Z]/.test(callee)
}

const isJsxComponentAdapter = (fn: FnLike): boolean => {
  const body = functionBodyNode(fn)
  if (body === undefined) return false
  if (!isBlock(body)) return false
  const statements = body.statements
  if (statements.length !== 2) return false

  const setup = textOf(statements[0])
  const returned = textOf(statements[1])
  return (
    /\bsplitProps\s*\(/.test(setup) &&
    /^return\s*\(?\s*</s.test(returned) &&
    returned.includes("{...") &&
    returned.includes("classList")
  )
}

const isSvgIconComponent = (fn: FnLike): boolean => {
  if (!isFunctionDeclaration(fn)) return false
  if (!/^Icon[A-Z]/.test(getFunctionName(fn))) return false
  const parameters = fn.parameters
  if (parameters.length > 1) return false
  const body = functionBodyNode(fn)
  if (body === undefined || !isBlock(body)) return false
  const statements = body.statements
  if (statements.length !== 1) return false
  const statement = statements[0]
  if (statement === undefined || !isReturnStatement(statement)) return false
  const returned = statement.expression === undefined ? "" : textOf(statement.expression)
  return /^(\(\s*)?<svg\b/s.test(returned) && /\{\s*\.\.\.\s*props\s*\}/.test(returned)
}

export const isExactCloneEligible = (fn: FnLike, tokenCount: number): boolean => {
  if (tokenCount <= 40 && (isJsxRenderCallback(fn) || isSmallJsxReturnFunction(fn))) {
    return false
  }

  if (isArrowFunction(fn) || isFunctionExpression(fn)) {
    const parent = fn.parent
    if (isCallExpression(parent) && hasSingleOperationalStatement(fn)) {
      return false
    }
  }

  return true
}

const isJsxRenderCallback = (fn: FnLike): boolean => {
  if (!isArrowFunction(fn) && !isFunctionExpression(fn)) return false

  let current: Node | undefined = fn.parent
  while (current !== undefined && !isSourceFile(current)) {
    if (isJsxExpression(current)) return true
    current = current.parent
  }
  return false
}

const isSmallJsxReturnFunction = (fn: FnLike): boolean => {
  const body = functionBodyNode(fn)
  if (body === undefined) return false
  if (!isBlock(body)) return false
  const statements = body.statements
  if (statements.length !== 1) return false
  return /^return\s*\(?\s*</s.test(textOf(statements[0]))
}

const hasSingleOperationalStatement = (fn: ArrowFunction | FunctionExpression): boolean => {
  const body = functionBodyNode(fn)
  if (body === undefined || !isBlock(body)) return true
  return body.statements.length === 1
}

const isSmallEffectGenCallback = (fn: ArrowFunction | FunctionExpression): boolean => {
  const parent = fn.parent
  if (!isCallExpression(parent)) return false
  if (textOf(parent.expression) !== "Effect.gen") return false

  const body = functionBodyNode(fn)
  if (body === undefined || !isBlock(body)) return true
  return body.statements.length <= 3
}
