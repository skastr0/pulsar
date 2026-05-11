import { type ArrowFunction, type FunctionExpression, Node, SyntaxKind } from "ts-morph"
import { getFunctionName, type TsFunctionLike as FnLike } from "./shared-function-index.js"

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

  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if ((Node.isCallExpression(parent) || Node.isPropertyAssignment(parent)) && hasSingleOperationalStatement(fn)) {
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
  if (!("getBody" in fn) || typeof fn.getBody !== "function") return false
  const body = fn.getBody()
  if (body === undefined) return false

  if (Node.isBlock(body)) {
    const statements = body.getStatements()
    if (statements.length !== 1) return false
    const statement = statements[0]
    if (!Node.isReturnStatement(statement)) return false
    const expression = statement.getExpression()
    return expression !== undefined && isAstPredicateUnionExpression(expression)
  }

  return isAstPredicateUnionExpression(body)
}

const isAstPredicateUnionExpression = (node: Node): boolean => {
  if (Node.isParenthesizedExpression(node)) {
    return isAstPredicateUnionExpression(node.getExpression())
  }
  if (Node.isBinaryExpression(node) && node.getOperatorToken().getKind() === SyntaxKind.BarBarToken) {
    return (
      isAstPredicateUnionExpression(node.getLeft()) &&
      isAstPredicateUnionExpression(node.getRight())
    )
  }
  if (!Node.isCallExpression(node)) return false
  const callee = node.getExpression().getText()
  return /^ts\.is[A-Z]/.test(callee) || /^Node\.is[A-Z]/.test(callee)
}

const isJsxComponentAdapter = (fn: FnLike): boolean => {
  if (!("getBody" in fn) || typeof fn.getBody !== "function") return false
  const body = fn.getBody()
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  if (statements.length !== 2) return false

  const setup = statements[0]?.getText() ?? ""
  const returned = statements[1]?.getText() ?? ""
  return (
    /\bsplitProps\s*\(/.test(setup) &&
    /^return\s*\(?\s*</s.test(returned) &&
    returned.includes("{...") &&
    returned.includes("classList")
  )
}

const isSvgIconComponent = (fn: FnLike): boolean => {
  if (!Node.isFunctionDeclaration(fn)) return false
  if (!/^Icon[A-Z]/.test(getFunctionName(fn))) return false
  const parameters = fn.getParameters()
  if (parameters.length > 1) return false
  const body = fn.getBody()
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  if (statements.length !== 1) return false
  const statement = statements[0]
  if (!Node.isReturnStatement(statement)) return false
  const returned = statement.getExpression()?.getText() ?? ""
  return /^(\(\s*)?<svg\b/s.test(returned) && /\{\s*\.\.\.\s*props\s*\}/.test(returned)
}

export const isExactCloneEligible = (fn: FnLike, tokenCount: number): boolean => {
  if (tokenCount <= 40 && (isJsxRenderCallback(fn) || isSmallJsxReturnFunction(fn))) {
    return false
  }

  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent()
    if (Node.isCallExpression(parent) && hasSingleOperationalStatement(fn)) {
      return false
    }
  }

  return true
}

const isJsxRenderCallback = (fn: FnLike): boolean => {
  if (!Node.isArrowFunction(fn) && !Node.isFunctionExpression(fn)) return false

  let current: Node | undefined = fn.getParent()
  while (current !== undefined && !Node.isSourceFile(current)) {
    if (Node.isJsxExpression(current)) return true
    current = current.getParent()
  }
  return false
}

const isSmallJsxReturnFunction = (fn: FnLike): boolean => {
  if (!("getBody" in fn) || typeof fn.getBody !== "function") return false
  const body = fn.getBody()
  if (!Node.isBlock(body)) return false
  const statements = body.getStatements()
  if (statements.length !== 1) return false
  return /^return\s*\(?\s*</s.test(statements[0]?.getText() ?? "")
}

const hasSingleOperationalStatement = (fn: ArrowFunction | FunctionExpression): boolean => {
  const body = fn.getBody()
  if (!Node.isBlock(body)) return true
  return body.getStatements().length === 1
}

const isSmallEffectGenCallback = (fn: ArrowFunction | FunctionExpression): boolean => {
  const parent = fn.getParent()
  if (!Node.isCallExpression(parent)) return false
  if (parent.getExpression().getText() !== "Effect.gen") return false

  const body = fn.getBody()
  if (!Node.isBlock(body)) return true
  return body.getStatements().length <= 3
}
