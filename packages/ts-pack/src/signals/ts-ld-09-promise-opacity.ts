import {
  type FunctionBoundaryOwner,
  isBoundaryFunctionOwner,
} from "./ts-ld-07-boundary.js"
import { textOf } from "../ast.js"
import {
  SyntaxKind,
  isArrowFunction,
  isCatchClause,
  isCallExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isMethodDeclaration,
  isPropertyAccessExpression,
  isThrowStatement,
  type Project,
} from "../tsgo-api.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import {
  calleeName,
  functionLikeName,
  isEffectStaticCall,
  isFunctionLikeNode,
  isPromiseRejectCall,
  nearestBoundaryOwner,
  nearestFunctionName
} from "./ts-ld-09-ast.js"
import {
  callbackCollapsesError,
  callbackReturnsFallback,
} from "./ts-ld-09-collapse.js"
import { callTextSuggestsExpectedFailure } from "./ts-ld-09-effect-opacity.js"
import { localErrorChannelFinding } from "./ts-ld-09-finding.js"
import {
  broadThrowCollapseMode,
  catchCollapsesErrorChannel,
} from "./ts-ld-09-throw-catch.js"
import type {
  LocalErrorChannelFinding,
  TsLd09Config,
} from "./ts-ld-09-types.js"

export const collectOpaquePromiseApi = async (
  node: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  exportedNames: ReadonlySet<string>,
  config: TsLd09Config,
  project: Project,
): Promise<LocalErrorChannelFinding | undefined> => {
  if (!isPromiseApiOwner(node)) return undefined
  if (!isBoundaryFunctionOwner(node, exportedNames)) return undefined
  const symbol = functionLikeName(node, sourceFile)
  const expectedFailureEvidence = expectedFailureEvidenceFor(symbol, config)
  if (expectedFailureEvidence.length === 0) return undefined

  const returnTypeText = functionReturnTypeText(node, sourceFile)
  if (!hasOpaquePromiseReturn(node, returnTypeText)) return undefined
  if (!await functionContainsExpectedFailureEvidence(node, sourceFile, config, project)) return undefined

  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol,
    kind: "opaque-promise-api",
    expressionText: textOf(node).slice(0, 200),
    ...(returnTypeText === undefined ? {} : { returnTypeText }),
    boundary: true,
    expectedFailureEvidence,
    collapseMode: "promise-rejection",
  })
}

export const collectPromiseCatchCollapse = async (
  node: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  exportedNames: ReadonlySet<string>,
  project: Project,
): Promise<LocalErrorChannelFinding | undefined> => {
  if (!isCallExpression(node)) return undefined
  if (calleeName(node.expression, sourceFile) !== "catch") return undefined
  if (!await isPromiseCatchCall(node, project)) return undefined
  const callback = node.arguments[0]
  if (callback === undefined || !callbackCollapsesError(callback, sourceFile)) return undefined
  const collapseMode = callbackReturnsFallback(callback, sourceFile)
    ? "fallback"
    : "swallowed"

  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol: nearestFunctionName(node, sourceFile) ?? "Promise.catch",
    kind: "promise-catch-collapse",
    expressionText: textOf(node.expression),
    boundary: nearestBoundaryOwner(node, exportedNames),
    expectedFailureEvidence: ["Promise.catch returns fallback value or swallows rejection"],
    collapseMode,
  })
}

const isPromiseApiOwner = (node: import("../tsgo-api.js").Node): node is FunctionBoundaryOwner =>
  isFunctionDeclaration(node) ||
  isMethodDeclaration(node) ||
  isArrowFunction(node) ||
  isFunctionExpression(node)

const hasOpaquePromiseReturn = (
  node: FunctionBoundaryOwner,
  returnTypeText: string | undefined,
): boolean => {
  if (returnTypeText !== undefined && promiseReturnTypeModelsExpectedFailure(returnTypeText)) {
    return false
  }
  if (returnTypeText?.includes("Promise<") === true) return true
  return true &&
    ((node as { readonly modifiers?: ReadonlyArray<{ kind: number }> }).modifiers?.some((modifier) => modifier.kind === SyntaxKind.AsyncKeyword) ?? false)
}

const promiseReturnTypeModelsExpectedFailure = (returnTypeText: string): boolean =>
  /\b(?:AsyncResult|Either|PromiseResult|Result|TaskEither)\s*</u.test(returnTypeText)

const functionContainsExpectedFailureEvidence = async (
  node: FunctionBoundaryOwner,
  sourceFile: import("../tsgo-api.js").SourceFile,
  config: TsLd09Config,
  project: Project,
): Promise<boolean> => {
  const body = "body" in node ? node.body : undefined
  if (body === undefined) return false
  let found = false
  const visit = async (candidate: import("../tsgo-api.js").Node): Promise<void> => {
    if (found) return
    if (candidate !== body && isFunctionLikeNode(candidate)) return
    if (
      isThrowStatement(candidate) &&
      candidate.expression !== undefined &&
      broadThrowCollapseMode(candidate.expression) !== undefined
    ) {
      found = true
      return
    }
    if (isCatchClause(candidate) && catchCollapsesErrorChannel(candidate, sourceFile)) {
      found = true
      return
    }
    if (isCallExpression(candidate)) {
      if (isPromiseRejectCall(candidate.expression)) {
        found = true
        return
      }
      if (
        calleeName(candidate.expression, sourceFile) === "catch" &&
        await isPromiseCatchCall(candidate, project) &&
        candidate.arguments[0] !== undefined &&
        callbackCollapsesError(candidate.arguments[0], sourceFile)
      ) {
        found = true
        return
      }
      const callee = calleeName(candidate.expression, sourceFile)
      if (
        (callee === "tryPromise" && isEffectStaticCall(candidate.expression, "tryPromise")) ||
        (callee === "promise" &&
          isEffectStaticCall(candidate.expression, "promise") &&
          callTextSuggestsExpectedFailure(candidate, sourceFile, config))
      ) {
        found = true
        return
      }
    }
    const children: Array<import("../tsgo-api.js").Node> = []
    candidate.forEachChild((child) => {
      children.push(child)
    })
    for (const child of children) {
      await visit(child)
    }
  }
  await visit(body)
  return found
}

const functionReturnTypeText = (
  node: FunctionBoundaryOwner,
  sourceFile: import("../tsgo-api.js").SourceFile,
): string | undefined => {
  if (!("type" in node) || node.type === undefined) {
    return hasOpaquePromiseReturn(node, undefined) ? "async function return" : undefined
  }
  return textOf(node.type)
}

const expectedFailureEvidenceFor = (
  symbol: string,
  config: TsLd09Config,
): ReadonlyArray<string> => {
  const lowered = symbol.toLowerCase()
  return config.expected_failure_name_patterns
    .filter((pattern) => pattern.trim() !== "")
    .filter((pattern) => lowered.includes(pattern.toLowerCase()))
    .map((pattern) => `name matches expected-failure pattern \`${pattern}\``)
}

const isPromiseCatchCall = async (
  node: import("../tsgo-api.js").CallExpression,
  project: Project,
): Promise<boolean> => {
  if (!isPropertyAccessExpression(node.expression)) return false
  if (propertyNameText(node.expression.name) !== "catch") return false
  const receiver = node.expression.expression
  const type = await project.checker.getTypeAtLocation(receiver)
  const receiverTypeText = await project.checker.typeToString(type, receiver)
  if (/\bPromise(?:<|$)/u.test(receiverTypeText)) return true
  return (await type.getProperty("then")) !== undefined &&
    (await type.getProperty("catch")) !== undefined
}
