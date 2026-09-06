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
import type {
  ErrorChannelCollapseMode,
  LocalErrorChannelFinding,
  TsLd09Config,
} from "./ts-ld-09-types.js"
import { compilerPropertyNameText as propertyNameText } from "./shared-compiler-functions.js"
import {
  calleeName,
  expressionName,
  isEffectStaticCall,
  isEffectStaticReference,
  isPipeArgument,
  nearestBoundaryOwner,
  nearestBoundarySymbol,
  positionOf,
} from "./ts-ld-09-ast.js"
import {
  blockReturnsFallback,
  blockSwallowsError,
  callbackReturnsFallback,
  firstParameterBinding,
} from "./ts-ld-09-collapse.js"
import { errorChannelWeight } from "./ts-ld-09-weight.js"

const EFFECT_COLLAPSE_CALLEES = new Set([
  "orDie",
  "orDieWith",
  "orElseSucceed",
])

type EffectTryPromiseCatchMapper =
  | import("../tsgo-api.js").MethodDeclaration
  | import("../tsgo-api.js").PropertyAssignment
  | import("../tsgo-api.js").ShorthandPropertyAssignment

export const collectEffectOpacity = (
  node: import("../tsgo-api.js").Node,
  sourceFile: import("../tsgo-api.js").SourceFile,
  exportedNames: ReadonlySet<string>,
  config: TsLd09Config,
  _project?: unknown,
): LocalErrorChannelFinding | undefined => {
  if (!isCallExpression(node)) return undefined
  const context = effectCallContext(node, sourceFile, exportedNames)
  if (context === undefined) return undefined
  return (
    collectTryPromiseOpacity(context) ??
    collectEffectPromiseOpacity(context, config) ??
    collectDirectEffectCollapseOpacity(context) ??
    collectPipedEffectCollapseOpacity(context)
  )
}

export const callTextSuggestsExpectedFailure = (
  node: import("../tsgo-api.js").CallExpression,
  sourceFile: import("../tsgo-api.js").SourceFile,
  config: TsLd09Config,
): boolean =>
  config.expected_failure_name_patterns
    .filter((pattern) => pattern.trim() !== "")
    .some((pattern) => textOf(node, sourceFile).toLowerCase().includes(pattern.toLowerCase()))

interface EffectCallContext {
  readonly node: import("../tsgo-api.js").CallExpression
  readonly sourceFile: import("../tsgo-api.js").SourceFile
  readonly callee: string
  readonly symbol: string | undefined
  readonly boundary: boolean
}

const effectCallContext = (
  node: import("../tsgo-api.js").CallExpression,
  sourceFile: import("../tsgo-api.js").SourceFile,
  exportedNames: ReadonlySet<string>,
): EffectCallContext | undefined => {
  const callee = calleeName(node.expression, sourceFile)
  if (callee === undefined) return undefined
  return {
    node,
    sourceFile,
    callee,
    symbol: nearestBoundarySymbol(node, sourceFile),
    boundary: nearestBoundaryOwner(node, exportedNames),
  }
}

const collectTryPromiseOpacity = (
  context: EffectCallContext,
): LocalErrorChannelFinding | undefined => {
  if (context.callee !== "tryPromise" || !isEffectStaticCall(context.node.expression, "tryPromise")) {
    return undefined
  }
  const catchMapper = effectTryPromiseCatchMapper(context.node)
  if (catchMapper === undefined) {
    return effectFinding(context, {
      node: context.node,
      symbol: context.symbol ?? "Effect.tryPromise",
      kind: "effect-unknown-exception",
      expressionText: textOf(context.node.expression),
      expectedFailureEvidence: ["Effect.tryPromise without typed catch mapper"],
      collapseMode: "unknown-exception",
    })
  }
  if (!effectTryPromiseCatchMapperCollapses(catchMapper, context.sourceFile)) {
    return undefined
  }
  return effectFinding(context, {
    node: catchMapper,
    symbol: context.symbol ?? "Effect.tryPromise",
    kind: "effect-error-collapse",
    expressionText: textOf(catchMapper).slice(0, 200),
    expectedFailureEvidence: ["Effect.tryPromise catch mapper returns fallback or swallows the exception"],
    collapseMode: effectTryPromiseCatchMapperReturnsFallback(catchMapper, context.sourceFile)
      ? "fallback"
      : "swallowed",
  })
}

const collectEffectPromiseOpacity = (
  context: EffectCallContext,
  config: TsLd09Config,
): LocalErrorChannelFinding | undefined => {
  if (
    context.callee !== "promise" ||
    !isEffectStaticCall(context.node.expression, "promise") ||
    !callTextSuggestsExpectedFailure(context.node, context.sourceFile, config)
  ) {
    return undefined
  }
  return effectFinding(context, {
    node: context.node,
    symbol: context.symbol ?? "Effect.promise",
    kind: "effect-unknown-exception",
    expressionText: textOf(context.node.expression),
    expectedFailureEvidence: ["Effect.promise wrapping expected-failure operation"],
    collapseMode: "promise-rejection",
  })
}

const collectDirectEffectCollapseOpacity = (
  context: EffectCallContext,
): LocalErrorChannelFinding | undefined => {
  if (
    !EFFECT_COLLAPSE_CALLEES.has(context.callee) ||
    !isEffectStaticCall(context.node.expression, context.callee) ||
    isPipeArgument(context.node, context.sourceFile)
  ) {
    return undefined
  }
  return effectCollapseFinding(context, context.callee, textOf(context.node.expression))
}

const collectPipedEffectCollapseOpacity = (
  context: EffectCallContext,
): LocalErrorChannelFinding | undefined => {
  const pipedCollapseCallee = pipeCollapseCallee(context.node, context.sourceFile)
  return pipedCollapseCallee === undefined
    ? undefined
    : effectCollapseFinding(
      context,
      pipedCollapseCallee,
      textOf(context.node).slice(0, 200),
    )
}

const effectCollapseFinding = (
  context: EffectCallContext,
  callee: string,
  expressionText: string,
): LocalErrorChannelFinding =>
  effectFinding(context, {
    node: context.node,
    symbol: context.symbol ?? `Effect.${callee}`,
    kind: "effect-error-collapse",
    expressionText,
    expectedFailureEvidence: [`Effect.${callee} collapses the typed error channel`],
    collapseMode: effectCollapseMode(callee),
  })

const effectFinding = (
  context: EffectCallContext,
  args: {
    readonly node: import("../tsgo-api.js").Node
    readonly symbol: string
    readonly kind: "effect-unknown-exception" | "effect-error-collapse"
    readonly expressionText: string
    readonly expectedFailureEvidence: ReadonlyArray<string>
    readonly collapseMode: ErrorChannelCollapseMode
  },
): LocalErrorChannelFinding => {
  const { line, column } = positionOf(args.node, context.sourceFile)
  const baseWeight = errorChannelWeight(args.kind, context.boundary)
  return {
    findingId: `${line}:${column}:${args.kind}:${args.symbol}`,
    line,
    column,
    symbol: args.symbol,
    kind: args.kind,
    expressionText: args.expressionText,
    boundary: context.boundary,
    expectedFailureEvidence: args.expectedFailureEvidence,
    collapseMode: args.collapseMode,
    severity: context.boundary ? "warn" : "info",
    baseWeight,
    weight: baseWeight,
  }
}

const effectCollapseMode = (callee: string): ErrorChannelCollapseMode =>
  callee === "orElseSucceed" ? "success-channel" : "defect"

const effectTryPromiseCatchMapper = (
  node: import("../tsgo-api.js").CallExpression,
): EffectTryPromiseCatchMapper | undefined => {
  const arg = node.arguments[0]
  if (arg === undefined || !isObjectLiteralExpression(arg)) return undefined
  for (const property of arg.properties) {
    if (
      isPropertyAssignment(property) ||
      isShorthandPropertyAssignment(property) ||
      isMethodDeclaration(property)
    ) {
      if (propertyNameText(property.name) === "catch") return property
    }
  }
  return undefined
}

const effectTryPromiseCatchMapperCollapses = (
  mapper: EffectTryPromiseCatchMapper,
  sourceFile: import("../tsgo-api.js").SourceFile,
): boolean => {
  if (effectTryPromiseCatchMapperReturnsFallback(mapper, sourceFile)) return true
  if (isMethodDeclaration(mapper) && mapper.body !== undefined) {
    return blockSwallowsError(mapper.body)
  }
  if (
    isPropertyAssignment(mapper) &&
    (isArrowFunction(mapper.initializer) || isFunctionExpression(mapper.initializer)) &&
    isBlock(mapper.initializer.body)
  ) {
    return blockSwallowsError(mapper.initializer.body)
  }
  return false
}

const effectTryPromiseCatchMapperReturnsFallback = (
  mapper: EffectTryPromiseCatchMapper,
  sourceFile: import("../tsgo-api.js").SourceFile,
): boolean => {
  if (isShorthandPropertyAssignment(mapper)) return false
  if (isPropertyAssignment(mapper)) {
    return callbackReturnsFallback(mapper.initializer, sourceFile)
  }
  return mapper.body === undefined
    ? false
    : blockReturnsFallback(mapper.body, sourceFile, firstParameterBinding(mapper))
}

const pipeCollapseCallee = (
  node: import("../tsgo-api.js").CallExpression,
  sourceFile: import("../tsgo-api.js").SourceFile,
): string | undefined => {
  if (calleeName(node.expression, sourceFile) !== "pipe") return undefined
  for (const argument of node.arguments) {
    const name = isCallExpression(argument)
      ? calleeName(argument.expression, sourceFile)
      : expressionName(argument)
    if (
      name !== undefined &&
      EFFECT_COLLAPSE_CALLEES.has(name) &&
      (isCallExpression(argument)
        ? isEffectStaticCall(argument.expression, name)
        : isEffectStaticReference(argument, name))
    ) {
      return name
    }
  }
  return undefined
}
