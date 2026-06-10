import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type CatchClause,
  type Node as TsMorphNode,
  type SourceFile,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  callName,
  isAnalyzableSourceFile,
  locationOf,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"

const TsCc01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  async_name_patterns: Schema.Array(Schema.String),
})
export type TsCc01Config = typeof TsCc01Config.Type

export type AsyncFailureFindingKind =
  | "floating-promise"
  | "fire-and-forget"
  | "swallowed-rejection"
  | "empty-catch"
  | "log-only-handler"

export interface AsyncFailureFinding extends SourceLocation {
  readonly kind: AsyncFailureFindingKind
  readonly expression: string
  readonly evidence: string
}

export interface TsCc01Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly analyzedFiles: number
  readonly asyncOperationsObserved: number
  readonly findings: ReadonlyArray<AsyncFailureFinding>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsCc01: Signal<TsCc01Config, TsCc01Output, TsProjectTag> = {
  id: "TS-CC-01-async-failure-control",
  title: "Async failure control",
  aliases: ["TS-CC-01"],
  tier: 1,
  category: "concurrency-safety",
  kind: "structural",
  cacheVersion: "async-failure-control-v3-syntactic-promise-evidence-documented-catch",
  configSchema: TsCc01Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
    async_name_patterns: [
      "fetch",
      "request",
      "mutate",
      "query",
      "execute",
      "load",
      "save",
      "send",
      "publish",
      "read",
    ],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsCc01Output => computeAsyncFailureControl(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-CC-01-async-failure-control",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    const pressure = out.findings.filter((finding) => finding.kind !== "log-only-handler").length
    return pressure > 0 ? 1 / (1 + pressure / 5) : 1
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: finding.kind === "log-only-handler" ? "info" : "warn",
      message: findingMessage(finding.kind),
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.kind}:${finding.expression}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "async-failure-control",
        title: finding.kind === "log-only-handler"
          ? "Confirm log-and-continue is the intended recovery"
          : "Make the failure path explicit",
        summary: finding.kind === "log-only-handler"
          ? "The failure is logged explicitly and execution continues; escalate or recover instead if the failure must stop the flow."
          : "Await, return, or deliberately detach the async work with an observable rejection handler and cancellation path.",
        confidence: "medium",
        autoApplicable: false,
        data: { kind: finding.kind },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const findingMessage = (kind: AsyncFailureFindingKind): string =>
  kind === "log-only-handler"
    ? "log-only-handler handles the async failure explicitly by logging and continuing"
    : `${kind} leaves async failure handling implicit`

const computeAsyncFailureControl = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsCc01Config,
): TsCc01Output => {
  const findings: Array<AsyncFailureFinding> = []
  let analyzedFiles = 0
  let asyncOperationsObserved = 0
  const asyncNamePatterns = config.async_name_patterns.map((pattern) => pattern.toLowerCase())

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    analyzedFiles += 1

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isAsyncOperation(call, asyncNamePatterns)) {
        asyncOperationsObserved += 1
      }
      const floating = classifyFloatingCall(call)
      if (floating !== undefined) findings.push(floating)
      const swallowed = classifySwallowedCatch(call)
      if (swallowed !== undefined) findings.push(swallowed)
    }

    for (const catchClause of sourceFile.getDescendantsOfKind(SyntaxKind.CatchClause)) {
      const finding = classifyEmptyCatch(catchClause)
      if (finding !== undefined) findings.push(finding)
    }
  }

  return {
    state: analyzedFiles === 0
      ? "not_applicable"
      : findings.length === 0 ? "zero" : "present",
    analyzedFiles,
    asyncOperationsObserved,
    findings: [...dedupeFindings(findings)].sort(compareFindings),
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: ["concurrency review route", "agent trust readout"],
    cacheContributors: [
      "source tree",
      "config.exclude_globs",
      "config.async_name_patterns",
      "config.top_n_diagnostics",
    ],
    calibrationSurface:
      "config.exclude_globs scopes analysis; config.async_name_patterns is observational only — it feeds asyncOperationsObserved and never findings or score",
    enforcementCeiling: ["review-route"],
  }
}

const classifyFloatingCall = (
  call: CallExpression,
): AsyncFailureFinding | undefined => {
  const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement)
  const expression = statement?.getExpression()
  const parent = call.getParent()
  const isDirectStatement = expression === call
  const isVoidedStatement = Node.isVoidExpression(parent) && expression === parent
  if (statement === undefined || (!isDirectStatement && !isVoidedStatement)) return undefined
  if (!hasPromiseEvidence(call)) return undefined
  if (hasTerminalRejectionHandler(call)) return undefined
  const name = callName(call.getExpression())
  if (isVoidedStatement) {
    return {
      ...locationOf(call),
      kind: "fire-and-forget",
      expression: name,
      evidence: statement.getText().slice(0, 160),
    }
  }
  return {
    ...locationOf(call),
    kind: "floating-promise",
    expression: name,
    evidence: statement.getText().slice(0, 160),
  }
}

const classifySwallowedCatch = (call: CallExpression): AsyncFailureFinding | undefined => {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression) || expression.getName() !== "catch") {
    return undefined
  }
  const handler = call.getArguments()[0]
  if (handler === undefined) return undefined
  if (isConsoleLogReference(handler)) return catchHandlerFinding(call, "log-only-handler")
  if (!Node.isArrowFunction(handler) && !Node.isFunctionExpression(handler)) return undefined
  const body = handler.getBody()
  if (!Node.isBlock(body)) {
    return Node.isCallExpression(body) && isConsoleLogReference(body.getExpression())
      ? catchHandlerFinding(call, "log-only-handler")
      : undefined
  }
  const bodyKind = classifyCatchBody(body.getText())
  if (bodyKind === "silent") return catchHandlerFinding(call, "swallowed-rejection")
  if (bodyKind === "log-only") return catchHandlerFinding(call, "log-only-handler")
  return undefined
}

const catchHandlerFinding = (
  call: CallExpression,
  kind: AsyncFailureFindingKind,
): AsyncFailureFinding => ({
  ...locationOf(call),
  kind,
  expression: callName(call.getExpression()),
  evidence: call.getText().slice(0, 160),
})

const classifyEmptyCatch = (catchClause: CatchClause): AsyncFailureFinding | undefined => {
  const blockText = catchClause.getBlock().getText()
  const bodyKind = classifyCatchBody(blockText)
  if (bodyKind === "documented" || bodyKind === "substantive") return undefined
  if (bodyKind === "silent" && hasDocumentingComment(catchClause)) return undefined
  return {
    ...locationOf(catchClause),
    kind: bodyKind === "log-only" ? "log-only-handler" : "empty-catch",
    expression: "catch",
    evidence: blockText.slice(0, 160),
  }
}

type CatchBodyKind = "silent" | "documented" | "log-only" | "substantive"

const classifyCatchBody = (blockText: string): CatchBodyKind => {
  const body = blockText.replace(/^\s*\{|\}\s*$/g, "").trim()
  if (body.length === 0) return "silent"
  const code = stripComments(body).trim()
  if (code.length === 0) return hasCommentContent(body) ? "documented" : "silent"
  if (/^console\.(?:log|warn|error|debug)\s*\([^)]*\)\s*;?$/.test(code)) return "log-only"
  return "substantive"
}

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ")

const hasCommentContent = (text: string): boolean =>
  /[A-Za-z0-9]/.test(text.replace(/\/\*|\*\/|\/\//g, " "))

// TODO/FIXME-only markers document unfinishedness, not a decision to swallow.
const isUnfinishedMarkerComment = (text: string): boolean =>
  /^\s*(?:todo|fixme|xxx)\b[\s.:!-]*$/i.test(text.replace(/\/\*|\*\/|\/\//g, " ").trim())

const hasDocumentingComment = (catchClause: CatchClause): boolean =>
  [...catchClause.getLeadingCommentRanges(), ...catchClause.getBlock().getLeadingCommentRanges()]
    .some((range) => hasCommentContent(range.getText()) && !isUnfinishedMarkerComment(range.getText()))

const isAsyncOperation = (call: CallExpression, asyncNamePatterns: ReadonlyArray<string>): boolean => {
  const typeText = safeTypeText(call)
  if (isTopLevelPromiseLikeType(typeText)) return true
  if (isKnownSynchronousType(typeText)) return false
  return hasSyntacticPromiseEvidence(call) ||
    matchesAsyncNamePattern(callName(call.getExpression()), asyncNamePatterns)
}

const hasPromiseEvidence = (call: CallExpression): boolean => {
  const typeText = safeTypeText(call)
  if (isTopLevelPromiseLikeType(typeText)) return true
  if (isKnownSynchronousType(typeText)) return false
  return hasSyntacticPromiseEvidence(call)
}

const KNOWN_PROMISE_GLOBALS: ReadonlySet<string> = new Set(["fetch"])
const PROMISE_CHAIN_MEMBERS: ReadonlySet<string> = new Set(["then", "catch", "finally"])
const PROMISE_STATIC_MEMBERS: ReadonlySet<string> = new Set([
  "resolve",
  "reject",
  "all",
  "allSettled",
  "race",
  "any",
])

const hasSyntacticPromiseEvidence = (call: CallExpression): boolean => {
  const expression = call.getExpression()
  if (expression.getKind() === SyntaxKind.ImportKeyword) return true
  if (Node.isIdentifier(expression) && KNOWN_PROMISE_GLOBALS.has(expression.getText())) return true
  if (Node.isPropertyAccessExpression(expression)) {
    if (PROMISE_CHAIN_MEMBERS.has(expression.getName())) return true
    const receiver = expression.getExpression()
    if (
      Node.isIdentifier(receiver) &&
      receiver.getText() === "Promise" &&
      PROMISE_STATIC_MEMBERS.has(expression.getName())
    ) {
      return true
    }
  }
  return declarationsOf(expression).some(isPromiseReturningDeclaration)
}

const declarationsOf = (expression: TsMorphNode): ReadonlyArray<TsMorphNode> => {
  try {
    return expression.getSymbol()?.getDeclarations() ?? []
  } catch {
    return []
  }
}

const isPromiseReturningDeclaration = (declaration: TsMorphNode): boolean => {
  if (Node.isVariableDeclaration(declaration) || Node.isPropertyDeclaration(declaration)) {
    const initializer = declaration.getInitializer()
    return initializer !== undefined && isPromiseReturningDeclaration(initializer)
  }
  if (
    Node.isFunctionDeclaration(declaration) ||
    Node.isMethodDeclaration(declaration) ||
    Node.isFunctionExpression(declaration) ||
    Node.isArrowFunction(declaration)
  ) {
    if (declaration.isAsync()) return true
    const returnTypeNode = declaration.getReturnTypeNode()
    return returnTypeNode !== undefined && isTopLevelPromiseLikeType(returnTypeNode.getText())
  }
  if (Node.isMethodSignature(declaration)) {
    const returnTypeNode = declaration.getReturnTypeNode()
    return returnTypeNode !== undefined && isTopLevelPromiseLikeType(returnTypeNode.getText())
  }
  return false
}

const isConsoleLogReference = (node: TsMorphNode): boolean =>
  Node.isPropertyAccessExpression(node) &&
  Node.isIdentifier(node.getExpression()) &&
  node.getExpression().getText() === "console" &&
  ["log", "warn", "error", "debug"].includes(node.getName())

const safeTypeText = (call: CallExpression): string => {
  try {
    return call.getType().getText(call)
  } catch {
    return ""
  }
}

const isTopLevelPromiseLikeType = (typeText: string): boolean =>
  /^(?:Promise|PromiseLike)\s*</.test(typeText)

const isKnownSynchronousType = (typeText: string): boolean =>
  typeText.length > 0 &&
  typeText !== "any" &&
  typeText !== "unknown" &&
  !isTopLevelPromiseLikeType(typeText)

const hasTerminalRejectionHandler = (call: CallExpression): boolean => {
  const expression = call.getExpression()
  if (!Node.isPropertyAccessExpression(expression)) return false
  const member = expression.getName()
  if (member === "catch") return call.getArguments().length > 0
  if (member === "then") return call.getArguments()[1] !== undefined
  if (member === "finally") {
    const receiver = expression.getExpression()
    return Node.isCallExpression(receiver) && hasTerminalRejectionHandler(receiver)
  }
  return false
}

const matchesAsyncNamePattern = (
  name: string,
  patterns: ReadonlyArray<string>,
): boolean =>
  name
    .split(/[^A-Za-z0-9_$]+/)
    .some((segment) => patterns.some((pattern) => segmentMatchesPattern(segment, pattern)))

const segmentMatchesPattern = (segment: string, pattern: string): boolean => {
  const lower = segment.toLowerCase()
  if (lower === pattern) return true
  if (!lower.startsWith(pattern) || segment.length === pattern.length) return false
  const next = segment[pattern.length]
  return next === "_" || next === "$" || next === "-" || /[A-Z]/.test(next ?? "")
}

const dedupeFindings = (
  findings: ReadonlyArray<AsyncFailureFinding>,
): ReadonlyArray<AsyncFailureFinding> => {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.file}:${finding.line}:${finding.column}:${finding.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const compareFindings = (
  left: AsyncFailureFinding,
  right: AsyncFailureFinding,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.kind.localeCompare(right.kind)
