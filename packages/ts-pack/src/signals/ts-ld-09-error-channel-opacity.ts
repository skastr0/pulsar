import {
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { type SourceFile, ts } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  collectLocalExportedNames,
  type FunctionBoundaryOwner,
  isBoundaryFunctionOwner,
} from "./ts-ld-07-boundary.js"
import { countNonEmptyLines } from "./ts-ld-07-output.js"
import {
  calleeName,
  expressionName,
  functionLikeName,
  isEffectFailCall,
  isEffectStaticCall,
  isFunctionLikeNode,
  isPromiseRejectCall,
  nearestBoundaryOwner,
  nearestFunctionName,
  positionOf,
} from "./ts-ld-09-ast.js"
import {
  blockReturnsFallback,
  blockSwallowsError,
  callbackCollapsesError,
  callbackReturnsFallback,
} from "./ts-ld-09-collapse.js"
import {
  callTextSuggestsExpectedFailure,
  collectEffectOpacity,
} from "./ts-ld-09-effect-opacity.js"
import { catchHasGuardedFallbackAndPropagation } from "./ts-ld-09-guarded-catch.js"
import { errorChannelWeight } from "./ts-ld-09-weight.js"

const TsLd09Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  max_weighted_opacity_per_kloc: Schema.Number,
  max_boundary_weighted_opacity: Schema.Number,
  expected_failure_name_patterns: Schema.Array(Schema.String),
})
export type TsLd09Config = typeof TsLd09Config.Type

export type ErrorChannelOpacityState =
  | "present"
  | "zero"
  | "not_applicable"

export type ErrorChannelOpacityKind =
  | "broad-throw"
  | "catch-without-narrowing"
  | "opaque-promise-api"
  | "promise-catch-collapse"
  | "effect-unknown-exception"
  | "effect-error-collapse"

export type ErrorChannelCollapseMode =
  | "fallback"
  | "generic-error"
  | "unknown-exception"
  | "defect"
  | "promise-rejection"
  | "swallowed"
  | "success-channel"

export interface ErrorChannelOpacityFinding {
  readonly findingId: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly symbol: string
  readonly kind: ErrorChannelOpacityKind
  readonly expressionText: string
  readonly returnTypeText?: string
  readonly boundary: boolean
  readonly expectedFailureEvidence: ReadonlyArray<string>
  readonly collapseMode?: ErrorChannelCollapseMode
  readonly severity: "info" | "warn"
  readonly baseWeight: number
  readonly weight: number
}

export interface ErrorChannelOpacityFileSummary {
  readonly findings: number
  readonly boundaryFindings: number
  readonly weightedOpacity: number
  readonly boundaryWeightedOpacity: number
}

export interface TsLd09Output {
  readonly state: ErrorChannelOpacityState
  readonly findings: ReadonlyArray<ErrorChannelOpacityFinding>
  readonly topFindings: ReadonlyArray<ErrorChannelOpacityFinding>
  readonly byFile: ReadonlyMap<string, ErrorChannelOpacityFileSummary>
  readonly byKind: ReadonlyMap<ErrorChannelOpacityKind, number>
  readonly totalFindings: number
  readonly boundaryFindings: number
  readonly weightedOpacity: number
  readonly boundaryWeightedOpacity: number
  readonly analyzedFiles: number
  readonly analyzedLines: number
  readonly densityPerKloc: number
  readonly densityPressure: number
  readonly boundaryPressure: number
  readonly densityThreshold: number
  readonly boundaryThreshold: number
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly evidenceClass: ReadonlyArray<string>
  readonly claimLimit: string
  readonly nonClaimLimit: string
  readonly knownFailureMode: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export interface LocalErrorChannelFinding extends Omit<ErrorChannelOpacityFinding, "file"> {}

const BUILT_IN_ERROR_NAMES = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
])

export const TsLd09: Signal<TsLd09Config, TsLd09Output, TsProjectTag> = {
  id: "TS-LD-09-error-channel-opacity",
  title: "Error channel opacity",
  aliases: ["TS-LD-09"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "ts-error-channel-opacity-v8-guarded-fallback-mapping-v1",
  configSchema: TsLd09Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/.pi/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/test-utils/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/*test-utils.ts",
      "**/*test-utils.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
      "**/fixtures/**",
    ],
    top_n_diagnostics: 10,
    max_weighted_opacity_per_kloc: 18,
    max_boundary_weighted_opacity: 36,
    expected_failure_name_patterns: [
      "parse",
      "decode",
      "load",
      "fetch",
      "read",
      "write",
      "request",
      "validate",
      "resolve",
    ],
  },
  configDirections: {
    max_weighted_opacity_per_kloc: "higher-is-looser",
    max_boundary_weighted_opacity: "higher-is-looser",
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsLd09Output =>
          computeErrorChannelOpacityOutput(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-09-error-channel-opacity",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.totalFindings === 0) return 1
    const pressure = Math.max(out.densityPressure, out.boundaryPressure)
    return 1 / (1 + pressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.topFindings.map((finding) => ({
      severity: finding.severity,
      message:
        `${errorChannelKindLabel(finding.kind)} in ` +
        `${finding.boundary ? "boundary " : ""}\`${finding.symbol}\``,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        ...finding,
        densityPerKloc: out.densityPerKloc,
        densityThreshold: out.densityThreshold,
        boundaryThreshold: out.boundaryThreshold,
      },
      fixHints: [{
        kind: "make-error-channel-explicit",
        title: "Expose the failure contract",
        summary:
          "Map unknown throws/rejections into a domain error, return a typed Result/Either/Effect error channel, or preserve the rejection instead of collapsing it.",
        confidence: "medium",
        autoApplicable: false,
        data: {
          kind: finding.kind,
          symbol: finding.symbol,
          boundary: finding.boundary,
        },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

export const computeErrorChannelOpacityOutput = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsLd09Config,
): TsLd09Output => {
  const byFile = new Map<string, ErrorChannelOpacityFileSummary>()
  const byKind = new Map<ErrorChannelOpacityKind, number>()
  const findings: Array<ErrorChannelOpacityFinding> = []
  let analyzedFiles = 0
  let analyzedLines = 0

  for (const sourceFile of sourceFiles) {
    const file = sourceFile.getFilePath()
    if (sourceFile.isDeclarationFile() || isExcluded(file, config.exclude_globs)) continue

    analyzedFiles += 1
    analyzedLines += countNonEmptyLines(sourceFile)

    const fileFindings = collectErrorChannelOpacityFindings(sourceFile, config)
      .map((finding) => ({ ...finding, file }))
      .sort(compareErrorChannelFindings)

    if (fileFindings.length === 0) continue

    findings.push(...fileFindings)
    byFile.set(file, summarizeFileFindings(fileFindings))
    for (const finding of fileFindings) {
      byKind.set(finding.kind, (byKind.get(finding.kind) ?? 0) + 1)
    }
  }

  findings.sort(compareErrorChannelFindings)
  return buildErrorChannelOpacityOutput(byFile, byKind, findings, analyzedFiles, analyzedLines, config)
}

const collectErrorChannelOpacityFindings = (
  sourceFile: SourceFile,
  config: TsLd09Config,
): ReadonlyArray<LocalErrorChannelFinding> => {
  const compilerSourceFile = sourceFile.compilerNode
  const typeChecker = sourceFile.getProject().getTypeChecker().compilerObject
  const exportedNames = collectLocalExportedNames(compilerSourceFile)
  const findings: Array<LocalErrorChannelFinding> = []

  const visit = (node: ts.Node): void => {
    const finding =
      collectBroadThrow(node, compilerSourceFile, exportedNames) ??
      collectCatchCollapse(node, compilerSourceFile, exportedNames) ??
      collectOpaquePromiseApi(node, compilerSourceFile, exportedNames, config, typeChecker) ??
      collectEffectOpacity(node, compilerSourceFile, exportedNames, config, typeChecker) ??
      collectPromiseCatchCollapse(node, compilerSourceFile, exportedNames, typeChecker)

    if (finding !== undefined) findings.push(finding)
    ts.forEachChild(node, visit)
  }

  visit(compilerSourceFile)
  return findings
}

const collectBroadThrow = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): LocalErrorChannelFinding | undefined => {
  if (!ts.isThrowStatement(node) || node.expression === undefined) return undefined
  const collapse = broadThrowCollapseMode(node.expression)
  if (collapse === undefined) return undefined

  const boundary = nearestBoundaryOwner(node, exportedNames)
  const symbol = nearestFunctionName(node, sourceFile) ?? "<top-level>"
  return localFinding({
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

const collectCatchCollapse = (
  node: ts.Node,
  sourceFile: ts.SourceFile,
  exportedNames: ReadonlySet<string>,
): LocalErrorChannelFinding | undefined => {
  if (!ts.isCatchClause(node)) return undefined
  if (!catchCollapsesErrorChannel(node, sourceFile)) return undefined

  const boundary = nearestBoundaryOwner(node, exportedNames)
  const symbol = nearestFunctionName(node, sourceFile) ?? "<catch>"
  const collapseMode = blockReturnsFallback(node.block, sourceFile) ? "fallback" : "swallowed"
  return localFinding({
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

const collectOpaquePromiseApi = (
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

  return localFinding({
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

const collectPromiseCatchCollapse = (
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
  const collapseMode = callbackReturnsFallback(callback, sourceFile, typeChecker) ? "fallback" : "swallowed"

  return localFinding({
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

const localFinding = (args: {
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

const buildErrorChannelOpacityOutput = (
  byFile: ReadonlyMap<string, ErrorChannelOpacityFileSummary>,
  byKind: ReadonlyMap<ErrorChannelOpacityKind, number>,
  findings: ReadonlyArray<ErrorChannelOpacityFinding>,
  analyzedFiles: number,
  analyzedLines: number,
  config: TsLd09Config,
): TsLd09Output => {
  const weightedOpacity = findings.reduce((sum, finding) => sum + finding.weight, 0)
  const boundaryFindings = findings.filter((finding) => finding.boundary).length
  const boundaryWeightedOpacity = findings.reduce(
    (sum, finding) => sum + (finding.boundary ? finding.weight : 0),
    0,
  )
  const analyzedKloc = Math.max(1, analyzedLines / 1000)
  const densityPerKloc = weightedOpacity / analyzedKloc
  const diagnosticLimit = normalizeDiagnosticLimit(config.top_n_diagnostics)

  return {
    state: analyzedFiles === 0 ? "not_applicable" : findings.length === 0 ? "zero" : "present",
    findings,
    topFindings: findings.slice(0, diagnosticLimit),
    byFile,
    byKind,
    totalFindings: findings.length,
    boundaryFindings,
    weightedOpacity,
    boundaryWeightedOpacity,
    analyzedFiles,
    analyzedLines,
    densityPerKloc,
    densityPressure: thresholdPressure(densityPerKloc, config.max_weighted_opacity_per_kloc),
    boundaryPressure: thresholdPressure(
      boundaryWeightedOpacity,
      config.max_boundary_weighted_opacity,
    ),
    densityThreshold: config.max_weighted_opacity_per_kloc,
    boundaryThreshold: config.max_boundary_weighted_opacity,
    diagnosticLimit,
    compositeConsumers: [
      "contract safety gap",
      "review shock",
      "theory encoding index",
    ],
    cacheContributors: [
      "source tree",
      "config.exclude_globs",
      "config.expected_failure_name_patterns",
      "config.max_weighted_opacity_per_kloc",
      "config.max_boundary_weighted_opacity",
      "config.top_n_diagnostics",
    ],
    calibrationSurface:
      "config thresholds and exclude globs; future typescript.error-channel-policy can deweight intentional adapters with provenance",
    evidenceClass: [
      "syntax",
      "type",
      "runtime boundary",
    ],
    claimLimit:
      "Identifies code where expected failure semantics are hidden behind broad exceptions, opaque promises, or collapsed Effect error channels.",
    nonClaimLimit:
      "Does not prove the error behavior is incorrect or that every expected failure has been modeled.",
    knownFailureMode:
      "Name-pattern expected-failure evidence can miss domain-specific operation names or flag intentional boundary translation.",
    enforcementCeiling: ["soft-warning", "trend", "review-routing"],
  }
}

const summarizeFileFindings = (
  findings: ReadonlyArray<ErrorChannelOpacityFinding>,
): ErrorChannelOpacityFileSummary => ({
  findings: findings.length,
  boundaryFindings: findings.filter((finding) => finding.boundary).length,
  weightedOpacity: findings.reduce((sum, finding) => sum + finding.weight, 0),
  boundaryWeightedOpacity: findings.reduce(
    (sum, finding) => sum + (finding.boundary ? finding.weight : 0),
    0,
  ),
})

const broadThrowCollapseMode = (
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

const catchCollapsesErrorChannel = (
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

const compareErrorChannelFindings = (
  left: ErrorChannelOpacityFinding,
  right: ErrorChannelOpacityFinding,
): number => {
  if (left.boundary !== right.boundary) return left.boundary ? -1 : 1
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.file !== right.file) return left.file < right.file ? -1 : 1
  return left.line - right.line || left.column - right.column
}

const thresholdPressure = (value: number, threshold: number): number =>
  threshold <= 0 ? 0 : value / threshold

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 0

const errorChannelKindLabel = (kind: ErrorChannelOpacityKind): string => {
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
