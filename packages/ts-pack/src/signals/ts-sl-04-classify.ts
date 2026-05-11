import { Node, SyntaxKind } from "ts-morph"
import {
  getFunctionName,
  type TsFunctionLike as FnLike,
} from "./shared-function-index.js"
import { isEmptyBodyText, propertyNameOf } from "./ts-sl-04-intentional-noops.js"
import type { StubKind } from "./ts-sl-04-factors.js"

export const classifyStub = (
  fn: FnLike,
  bodyText: string,
): { kind: StubKind; message: string } | undefined => {
  if (isEmptyBodyText(bodyText)) {
    return { kind: "empty-body", message: "Empty implementation" }
  }

  if (MAYBE_THROW_STUB_PATTERN.test(bodyText)) {
    const throwStubMessage = directStubThrowMessage(fn)
    if (throwStubMessage !== undefined) {
      if (isExplicitUnsupportedCapabilityMessage(throwStubMessage)) return undefined
      if (isFixtureEntrypointPlaceholder(fn, throwStubMessage)) return undefined
      const message = throwStubMessage.toLowerCase()
      if (/not\s*implemented|todo|fixme|stub/i.test(message)) {
        return { kind: "throw-not-implemented", message: throwStubMessage }
      }
    }
  }

  if (MAYBE_TODO_COMMENT_PATTERN.test(bodyText)) {
    const commentText = commentOnlyBodyText(bodyText)
    if (commentText !== undefined && /todo|fixme|xxx/i.test(commentText)) {
      return { kind: "todo-comment", message: commentText }
    }
  }

  if (!MAYBE_PLACEHOLDER_RETURN_PATTERN.test(bodyText)) return undefined

  const normalized = bodyText.replace(/\s+/g, " ").trim()
  const returnLiteralMatch = /^\{\s*return\s+(?:"([^"]*)"|'([^']*)'|`([^`]*)`|\d+|true|false|null|undefined|\[\s*\]|\{\s*\})\s*;?\s*\}$/.exec(
    normalized,
  )
  if (returnLiteralMatch) {
    const returnedText = (returnLiteralMatch[1] ?? returnLiteralMatch[2] ?? returnLiteralMatch[3] ?? "").toLowerCase()
    if (/placeholder|mock|todo|fixme|not\s*implemented|stub/.test(returnedText)) {
      return { kind: "mock-return", message: "Returns placeholder literal" }
    }
  }

  return undefined
}

const MAYBE_THROW_STUB_PATTERN = /\bthrow\b[\s\S]*(?:not\s*implemented|todo|fixme|stub)/i
const MAYBE_TODO_COMMENT_PATTERN = /(?:\/\/|\/\*)[\s\S]*(?:todo|fixme|xxx)/i
const MAYBE_PLACEHOLDER_RETURN_PATTERN = /\breturn\b[\s\S]*(?:placeholder|mock|todo|fixme|not\s*implemented|stub)/i

const isExplicitUnsupportedCapabilityMessage = (message: string): boolean =>
  /`[^`]+`\s+on\s+.+\s+is\s+not\s+implemented\s+by\s+[^.]+\./i.test(message) ||
  /^not\s+implemented\s+on\s+.+/i.test(message)

const isFixtureEntrypointPlaceholder = (fn: FnLike, message: string): boolean => {
  if (!/^fixture\s+not\s+implemented!?$/i.test(message.trim())) return false
  if (/placeholder/i.test(getFunctionName(fn))) return true

  let current: Node | undefined = fn.getParent()
  while (current !== undefined && !Node.isSourceFile(current)) {
    if (Node.isBinaryExpression(current) && /placeholder/i.test(current.getLeft().getText())) {
      return true
    }
    if (Node.isVariableDeclaration(current) && /placeholder/i.test(current.getName())) {
      return true
    }
    if (Node.isPropertyAssignment(current) && /placeholder/i.test(propertyNameOf(current))) {
      return true
    }
    current = current.getParent()
  }
  return false
}

const directStubThrowMessage = (fn: FnLike): string | undefined => {
  const body = functionBodyNode(fn)
  if (body === undefined) return undefined

  const throwStatement = body
    .getDescendantsOfKind(SyntaxKind.ThrowStatement)
    .find((statement) => nearestFunctionLikeAncestor(statement) === fn)
  if (throwStatement === undefined) return undefined

  const expression = throwStatement.getExpression()
  if (!Node.isNewExpression(expression)) return undefined
  const thrownType = expression.getExpression().getText()
  if (!["Error", "TypeError", "RangeError"].includes(thrownType)) return undefined

  const [messageArg] = expression.getArguments()
  if (
    !Node.isStringLiteral(messageArg) &&
    !Node.isNoSubstitutionTemplateLiteral(messageArg)
  ) {
    return undefined
  }

  return messageArg.getLiteralText()
}

const functionBodyNode = (fn: FnLike): Node | undefined => {
  if (Node.isArrowFunction(fn)) return fn.getBody()
  if ("getBody" in fn && typeof fn.getBody === "function") return fn.getBody()
  return undefined
}

const nearestFunctionLikeAncestor = (node: Node): FnLike | undefined =>
  node.getFirstAncestor((ancestor): ancestor is FnLike =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isArrowFunction(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isConstructorDeclaration(ancestor) ||
    Node.isGetAccessorDeclaration(ancestor) ||
    Node.isSetAccessorDeclaration(ancestor),
  )

const commentOnlyBodyText = (bodyText: string): string | undefined => {
  const trimmed = bodyText.trim()
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return undefined

  const body = trimmed.slice(1, -1)
  const comments: Array<string> = []
  const withoutBlockComments = body.replace(/\/\*[\s\S]*?\*\//g, (comment) => {
    comments.push(comment.replace(/^\/\*+/, "").replace(/\*+\/$/, "").trim())
    return ""
  })
  const withoutLineComments = withoutBlockComments.replace(/(^|\n)\s*\/\/([^\n]*)/g, (_match, prefix, comment) => {
    comments.push(String(comment).trim())
    return prefix
  })

  if (withoutLineComments.trim().length > 0 || comments.length === 0) {
    return undefined
  }

  return comments.join(" ").replace(/\s+/g, " ").trim()
}
