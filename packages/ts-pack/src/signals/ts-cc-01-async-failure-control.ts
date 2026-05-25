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
  cacheVersion: "async-failure-control-v1",
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
      "write",
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
  score: (out) => out.state === "present" ? 1 / (1 + out.findings.length / 5) : 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "warn",
      message: `${finding.kind} leaves async failure handling implicit`,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.kind}:${finding.expression}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "async-failure-control",
        title: "Make the failure path explicit",
        summary:
          "Await, return, or deliberately detach the async work with an observable rejection handler and cancellation path.",
        confidence: "medium",
        autoApplicable: false,
        data: { kind: finding.kind },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const computeAsyncFailureControl = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsCc01Config,
): TsCc01Output => {
  const findings: Array<AsyncFailureFinding> = []
  let analyzedFiles = 0
  let asyncOperationsObserved = 0
  const asyncNamePattern = new RegExp(`(?:${config.async_name_patterns.map(escapeRegExp).join("|")})`, "i")

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    analyzedFiles += 1

    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      if (isAsyncOperation(call, asyncNamePattern)) {
        asyncOperationsObserved += 1
      }
      const floating = classifyFloatingCall(call, asyncNamePattern)
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
    calibrationSurface: "config.async_name_patterns and config.exclude_globs",
    enforcementCeiling: ["review-route"],
  }
}

const classifyFloatingCall = (
  call: CallExpression,
  asyncNamePattern: RegExp,
): AsyncFailureFinding | undefined => {
  const statement = call.getFirstAncestorByKind(SyntaxKind.ExpressionStatement)
  const expression = statement?.getExpression()
  const parent = call.getParent()
  const isDirectStatement = expression === call
  const isVoidedStatement = Node.isVoidExpression(parent) && expression === parent
  if (statement === undefined || (!isDirectStatement && !isVoidedStatement)) return undefined
  const name = callName(call.getExpression())
  if (!isAsyncOperation(call, asyncNamePattern)) return undefined
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
  if (handler === undefined || !Node.isArrowFunction(handler)) return undefined
  const body = handler.getBody()
  if (!Node.isBlock(body)) return undefined
  if (!blockSwallows(body.getText())) return undefined
  return {
    ...locationOf(call),
    kind: "swallowed-rejection",
    expression: callName(expression),
    evidence: call.getText().slice(0, 160),
  }
}

const classifyEmptyCatch = (catchClause: CatchClause): AsyncFailureFinding | undefined => {
  const blockText = catchClause.getBlock().getText()
  if (!blockSwallows(blockText)) return undefined
  return {
    ...locationOf(catchClause),
    kind: "empty-catch",
    expression: "catch",
    evidence: blockText.slice(0, 160),
  }
}

const blockSwallows = (blockText: string): boolean => {
  const body = blockText.replace(/^\s*\{|\}\s*$/g, "").trim()
  if (body.length === 0) return true
  if (/^(?:\/\/.*|\/\*[\s\S]*\*\/)?$/.test(body)) return true
  if (/^console\.(?:log|warn|error|debug)\s*\([^)]*\)\s*;?$/.test(body)) return true
  return !/(throw|return|await|reject|report|capture|logger|logError|onError)/.test(body)
}

const isAsyncOperation = (call: CallExpression, asyncNamePattern: RegExp): boolean => {
  const name = callName(call.getExpression())
  if (asyncNamePattern.test(name)) return true
  const typeText = safeTypeText(call)
  return /\bPromise(?:Like)?\s*</.test(typeText)
}

const safeTypeText = (call: CallExpression): string => {
  try {
    return call.getType().getText(call)
  } catch {
    return ""
  }
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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
