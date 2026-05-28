import { ts } from "ts-morph"
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
} from "./ts-ld-09-collapse.js"
import { errorChannelWeight } from "./ts-ld-09-weight.js"

const EFFECT_COLLAPSE_CALLEES = new Set([
  "orDie",
  "orDieWith",
  "orElseSucceed",
])

type EffectTryPromiseCatchMapper =
  | ts.MethodDeclaration
  | ts.PropertyAssignment
  | ts.ShorthandPropertyAssignment

export const collectEffectOpacity = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
  config: TsLd09Config,
  typeChecker: ts.TypeChecker,
): LocalErrorChannelFinding | undefined => {
  if (!ts.isCallExpression(node)) return undefined
  const context = effectCallContext(node, sourceFile, exportedNames)
  if (context === undefined) return undefined
  return (
    collectTryPromiseOpacity(context, typeChecker) ??
    collectEffectPromiseOpacity(context, config) ??
    collectDirectEffectCollapseOpacity(context) ??
    collectPipedEffectCollapseOpacity(context)
  )
}

export const callTextSuggestsExpectedFailure = (
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
  config: TsLd09Config,
): boolean =>
  config.expected_failure_name_patterns
    .filter((pattern) => pattern.trim() !== "")
    .some((pattern) => node.getText(sourceFile).toLowerCase().includes(pattern.toLowerCase()))

interface EffectCallContext {
  readonly node: ts.CallExpression
  readonly sourceFile: ts.SourceFile
  readonly callee: string
  readonly symbol: string | undefined
  readonly boundary: boolean
}

const effectCallContext = (
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
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
  typeChecker: ts.TypeChecker,
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
      expressionText: context.node.expression.getText(context.sourceFile),
      expectedFailureEvidence: ["Effect.tryPromise without typed catch mapper"],
      collapseMode: "unknown-exception",
    })
  }
  if (!effectTryPromiseCatchMapperCollapses(catchMapper, context.sourceFile, typeChecker)) {
    return undefined
  }
  return effectFinding(context, {
    node: catchMapper,
    symbol: context.symbol ?? "Effect.tryPromise",
    kind: "effect-error-collapse",
    expressionText: catchMapper.getText(context.sourceFile).slice(0, 200),
    expectedFailureEvidence: ["Effect.tryPromise catch mapper returns fallback or swallows the exception"],
    collapseMode: effectTryPromiseCatchMapperReturnsFallback(catchMapper, context.sourceFile, typeChecker)
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
    expressionText: context.node.expression.getText(context.sourceFile),
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
  return effectCollapseFinding(context, context.callee, context.node.expression.getText(context.sourceFile))
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
      context.node.getText(context.sourceFile).slice(0, 200),
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
    readonly node: ts.Node
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
  node: ts.CallExpression,
): EffectTryPromiseCatchMapper | undefined => {
  const arg = node.arguments[0]
  if (arg === undefined || !ts.isObjectLiteralExpression(arg)) return undefined
  for (const property of arg.properties) {
    if (
      ts.isPropertyAssignment(property) ||
      ts.isShorthandPropertyAssignment(property) ||
      ts.isMethodDeclaration(property)
    ) {
      if (propertyNameText(property.name) === "catch") return property
    }
  }
  return undefined
}

const effectTryPromiseCatchMapperCollapses = (
  mapper: EffectTryPromiseCatchMapper,
  sourceFile: ts.SourceFile,
  typeChecker?: ts.TypeChecker,
): boolean => {
  if (effectTryPromiseCatchMapperReturnsFallback(mapper, sourceFile, typeChecker)) return true
  if (ts.isMethodDeclaration(mapper) && mapper.body !== undefined) {
    return blockSwallowsError(mapper.body)
  }
  if (
    ts.isPropertyAssignment(mapper) &&
    (ts.isArrowFunction(mapper.initializer) || ts.isFunctionExpression(mapper.initializer)) &&
    ts.isBlock(mapper.initializer.body)
  ) {
    return blockSwallowsError(mapper.initializer.body)
  }
  return false
}

const effectTryPromiseCatchMapperReturnsFallback = (
  mapper: EffectTryPromiseCatchMapper,
  sourceFile: ts.SourceFile,
  typeChecker?: ts.TypeChecker,
): boolean => {
  if (ts.isShorthandPropertyAssignment(mapper)) return false
  if (ts.isPropertyAssignment(mapper)) {
    return callbackReturnsFallback(mapper.initializer, sourceFile, typeChecker)
  }
  return mapper.body === undefined ? false : blockReturnsFallback(mapper.body, sourceFile)
}

const pipeCollapseCallee = (
  node: ts.CallExpression,
  sourceFile: ts.SourceFile,
): string | undefined => {
  if (calleeName(node.expression, sourceFile) !== "pipe") return undefined
  for (const argument of node.arguments) {
    const name = ts.isCallExpression(argument)
      ? calleeName(argument.expression, sourceFile)
      : expressionName(argument)
    if (
      name !== undefined &&
      EFFECT_COLLAPSE_CALLEES.has(name) &&
      (ts.isCallExpression(argument)
        ? isEffectStaticCall(argument.expression, name)
        : isEffectStaticReference(argument, name))
    ) {
      return name
    }
  }
  return undefined
}
