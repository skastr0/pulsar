import {
  type FunctionBoundaryOwner,
  isBoundaryFunctionOwner,
} from "./ts-ld-07-boundary.js"
import {
  calleeName,
  functionLikeName,
  isEffectStaticCall,
  isFunctionLikeNode,
  isPromiseRejectCall,
  nearestBoundaryOwner,
  nearestFunctionName,
  ts,
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

export const collectOpaquePromiseApi = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
  config: TsLd09Config,
  typeChecker: ts.TypeChecker,
): LocalErrorChannelFinding | undefined => {
  if (!isPromiseApiOwner(node)) return undefined
  if (!isBoundaryFunctionOwner(node, exportedNames)) return undefined
  const symbol = functionLikeName(node, sourceFile)
  const expectedFailureEvidence = expectedFailureEvidenceFor(symbol, config)
  if (expectedFailureEvidence.length === 0) return undefined

  const returnTypeText = functionReturnTypeText(node, sourceFile)
  if (!hasOpaquePromiseReturn(node, returnTypeText)) return undefined
  if (!functionContainsExpectedFailureEvidence(node, sourceFile, config, typeChecker)) return undefined

  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol,
    kind: "opaque-promise-api",
    expressionText: node.getText(sourceFile).slice(0, 200),
    ...(returnTypeText === undefined ? {} : { returnTypeText }),
    boundary: true,
    expectedFailureEvidence,
    collapseMode: "promise-rejection",
  })
}

export const collectPromiseCatchCollapse = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
  typeChecker: ts.TypeChecker,
): LocalErrorChannelFinding | undefined => {
  if (!ts.isCallExpression(node)) return undefined
  if (calleeName(node.expression, sourceFile) !== "catch") return undefined
  if (!isPromiseCatchCall(node, typeChecker)) return undefined
  const callback = node.arguments[0]
  if (callback === undefined || !callbackCollapsesError(callback, sourceFile, typeChecker)) return undefined
  const collapseMode = callbackReturnsFallback(callback, sourceFile, typeChecker)
    ? "fallback"
    : "swallowed"

  return localErrorChannelFinding({
    sourceFile,
    node,
    symbol: nearestFunctionName(node, sourceFile) ?? "Promise.catch",
    kind: "promise-catch-collapse",
    expressionText: node.expression.getText(sourceFile),
    boundary: nearestBoundaryOwner(node, exportedNames),
    expectedFailureEvidence: ["Promise.catch returns fallback value or swallows rejection"],
    collapseMode,
  })
}

const isPromiseApiOwner = (node: ts.Node): node is FunctionBoundaryOwner =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node)

const hasOpaquePromiseReturn = (
  node: FunctionBoundaryOwner,
  returnTypeText: string | undefined,
): boolean => {
  if (returnTypeText !== undefined && promiseReturnTypeModelsExpectedFailure(returnTypeText)) {
    return false
  }
  if (returnTypeText?.includes("Promise<") === true) return true
  return ts.canHaveModifiers(node) &&
    (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword) ?? false)
}

const promiseReturnTypeModelsExpectedFailure = (returnTypeText: string): boolean =>
  /\b(?:AsyncResult|Either|PromiseResult|Result|TaskEither)\s*</u.test(returnTypeText)

const functionContainsExpectedFailureEvidence = (
  node: FunctionBoundaryOwner,
  sourceFile: ts.SourceFile,
  config: TsLd09Config,
  typeChecker: ts.TypeChecker,
): boolean => {
  const body = "body" in node ? node.body : undefined
  if (body === undefined) return false
  let found = false
  const visit = (candidate: ts.Node): void => {
    if (found) return
    if (candidate !== body && isFunctionLikeNode(candidate)) return
    if (
      ts.isThrowStatement(candidate) &&
      candidate.expression !== undefined &&
      broadThrowCollapseMode(candidate.expression) !== undefined
    ) {
      found = true
      return
    }
    if (ts.isCatchClause(candidate) && catchCollapsesErrorChannel(candidate, sourceFile)) {
      found = true
      return
    }
    if (ts.isCallExpression(candidate)) {
      if (isPromiseRejectCall(candidate.expression)) {
        found = true
        return
      }
      if (
        calleeName(candidate.expression, sourceFile) === "catch" &&
        isPromiseCatchCall(candidate, typeChecker) &&
        candidate.arguments[0] !== undefined &&
        callbackCollapsesError(candidate.arguments[0], sourceFile, typeChecker)
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
    ts.forEachChild(candidate, visit)
  }
  visit(body)
  return found
}

const functionReturnTypeText = (
  node: FunctionBoundaryOwner,
  sourceFile: ts.SourceFile,
): string | undefined => {
  if (!("type" in node) || node.type === undefined) {
    return hasOpaquePromiseReturn(node, undefined) ? "async function return" : undefined
  }
  return node.type.getText(sourceFile)
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

const isPromiseCatchCall = (node: ts.CallExpression, typeChecker: ts.TypeChecker): boolean => {
  if (!ts.isPropertyAccessExpression(node.expression)) return false
  const receiverType = typeChecker.getTypeAtLocation(node.expression.expression)
  const receiverTypeText = typeChecker.typeToString(receiverType)
  if (/\bPromise(?:<|$)/u.test(receiverTypeText)) return true
  return receiverType.getProperty("then") !== undefined &&
    receiverType.getProperty("catch") !== undefined
}
