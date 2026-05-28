import { positionOf, ts } from "./ts-ld-09-ast.js"
import type {
  ErrorChannelCollapseMode,
  ErrorChannelOpacityKind,
  LocalErrorChannelFinding,
} from "./ts-ld-09-types.js"
import { errorChannelWeight } from "./ts-ld-09-weight.js"

export const localErrorChannelFinding = (args: {
  readonly sourceFile: ts.SourceFile
  readonly node: ts.Node
  readonly symbol: string
  readonly kind: ErrorChannelOpacityKind
  readonly expressionText: string
  readonly returnTypeText?: string
  readonly boundary: boolean
  readonly expectedFailureEvidence: ReadonlyArray<string>
  readonly collapseMode?: ErrorChannelCollapseMode
}): LocalErrorChannelFinding => {
  const { line, column } = positionOf(args.node, args.sourceFile)
  const baseWeight = errorChannelWeight(args.kind, args.boundary)
  return {
    findingId: `${line}:${column}:${args.kind}:${args.symbol}`,
    line,
    column,
    symbol: args.symbol,
    kind: args.kind,
    expressionText: args.expressionText,
    ...(args.returnTypeText === undefined ? {} : { returnTypeText: args.returnTypeText }),
    boundary: args.boundary,
    expectedFailureEvidence: args.expectedFailureEvidence,
    ...(args.collapseMode === undefined ? {} : { collapseMode: args.collapseMode }),
    severity: args.boundary ? "warn" : "info",
    baseWeight,
    weight: baseWeight,
  }
}

export const errorChannelKindLabel = (kind: ErrorChannelOpacityKind): string => {
  switch (kind) {
    case "broad-throw":
      return "Broad throw"
    case "catch-without-narrowing":
      return "Catch fallback hides error channel"
    case "opaque-promise-api":
      return "Opaque Promise API hides expected failures"
    case "promise-catch-collapse":
      return "Promise catch fallback hides rejection"
    case "effect-unknown-exception":
      return "Effect operation hides expected exception type"
    case "effect-error-collapse":
      return "Effect operation collapses typed error channel"
  }
}
