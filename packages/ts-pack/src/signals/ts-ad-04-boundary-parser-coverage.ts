import {
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  ArrowFunction,
  type CallExpression,
  FunctionDeclaration,
  FunctionExpression,
  Node,
  type ParameterDeclaration,
  SyntaxKind,
  VariableDeclaration,
  type SourceFile,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"

const TsAd04Config = Schema.Struct({
  boundary_globs: Schema.Array(Schema.String),
  parser_call_patterns: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsAd04Config = typeof TsAd04Config.Type

export type BoundaryParserCoverageState =
  | "present"
  | "zero"
  | "absent"
  | "not_configured"
  | "not_applicable"

export interface WeakBoundaryParameter {
  readonly name: string
  readonly typeText: string
  readonly reason: "any" | "unknown" | "untyped" | "request-like"
}

export interface BoundaryParserFinding {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly weakParameters: ReadonlyArray<WeakBoundaryParameter>
  readonly missingEvidence: string
}

export interface BoundaryParserCoveredFunction {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly parserEvidence: ReadonlyArray<string>
  readonly weakParameters: ReadonlyArray<WeakBoundaryParameter>
}

export interface TsAd04Output {
  readonly state: BoundaryParserCoverageState
  readonly boundaryFilesMatched: number
  readonly boundaryFunctionsAnalyzed: number
  readonly weakBoundaryFunctions: number
  readonly coveredWeakBoundaryFunctions: number
  readonly findings: ReadonlyArray<BoundaryParserFinding>
  readonly covered: ReadonlyArray<BoundaryParserCoveredFunction>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

interface BoundaryFunctionCandidate {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly weakParameters: ReadonlyArray<WeakBoundaryParameter>
  readonly parserEvidence: ReadonlyArray<string>
}

type BoundaryFunctionNode =
  | FunctionDeclaration
  | ArrowFunction
  | FunctionExpression

const REQUEST_LIKE_TYPE_NAMES = [
  "Request",
  "NextRequest",
  "IncomingMessage",
  "APIGatewayProxyEvent",
  "APIGatewayEvent",
  "MessageEvent",
  "Event",
  "FormData",
  "URLSearchParams",
] as const

export const TsAd04: Signal<TsAd04Config, TsAd04Output, TsProjectTag> = {
  id: "TS-AD-04-boundary-parser-coverage",
  title: "Boundary parser coverage",
  aliases: ["TS-AD-04"],
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  cacheVersion:
    "ts-boundary-parser-evidence-v1-diagnostic-limit-v1-parser-attribution-v2",
  configSchema: TsAd04Config,
  defaultConfig: {
    boundary_globs: [
      "**/api/*.ts",
      "**/api/**/*.ts",
      "**/routes/*.ts",
      "**/routes/**/*.ts",
      "**/handlers/*.ts",
      "**/handlers/**/*.ts",
      "**/controllers/*.ts",
      "**/controllers/**/*.ts",
      "**/adapters/*.ts",
      "**/adapters/**/*.ts",
      "**/cli/*.ts",
      "**/cli/**/*.ts",
      "**/*route.ts",
      "**/*handler.ts",
      "**/*controller.ts",
      "**/*adapter.ts",
    ],
    parser_call_patterns: [
      "parse",
      "safeparse",
      "decode",
      "decodeunknown",
      "validate",
      "assert",
      "schema",
      "json.parse",
    ],
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/generated/**",
      "**/*.generated.ts",
      "**/*.gen.ts",
    ],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsAd04Output =>
          computeBoundaryParserCoverage(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AD-04-boundary-parser-coverage",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.state !== "present" && out.state !== "zero") return 1
    if (out.weakBoundaryFunctions === 0) return 1
    return Math.max(0, 1 - out.findings.length / out.weakBoundaryFunctions)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.state === "not_configured") {
      return [{
        severity: "warn",
        message: "Boundary parser coverage is not configured: boundary_globs is empty",
        data: { state: out.state },
      }]
    }
    if (out.state === "absent") {
      return [{
        severity: "info",
        message: "Boundary parser coverage found no files matching configured boundary_globs",
        data: { state: out.state },
      }]
    }
    return out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "warn" as const,
      message:
        `Boundary function \`${finding.symbol}\` accepts weak external input ` +
        "without parse/decode evidence",
      location: { file: finding.file, line: finding.line },
      data: { ...finding },
    }))
  },
  outputMetadata: (out) => {
    if (out.state === "not_configured" || out.state === "absent") {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.state === "not_applicable") {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
}

const computeBoundaryParserCoverage = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsAd04Config,
): TsAd04Output => {
  const diagnosticLimit = normalizeDiagnosticLimit(config.top_n_diagnostics)
  if (config.boundary_globs.length === 0) {
    return baseOutput("not_configured", 0, 0, [], [], diagnosticLimit)
  }

  const boundaryFiles = sourceFiles.filter((sourceFile) =>
    isBoundarySourceFile(sourceFile, config),
  )
  if (boundaryFiles.length === 0) {
    return baseOutput("absent", 0, 0, [], [], diagnosticLimit)
  }

  const candidates = boundaryFiles.flatMap((sourceFile) =>
    collectBoundaryFunctionCandidates(sourceFile, config.parser_call_patterns),
  )
  const weakCandidates = candidates.filter((candidate) => candidate.weakParameters.length > 0)
  if (weakCandidates.length === 0) {
    return baseOutput("not_applicable", boundaryFiles.length, candidates.length, [], [], diagnosticLimit)
  }

  const covered = weakCandidates
    .filter((candidate) => candidate.parserEvidence.length > 0)
    .map((candidate) => ({
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.symbol,
      parserEvidence: candidate.parserEvidence,
      weakParameters: candidate.weakParameters,
    }))
  const findings = weakCandidates
    .filter((candidate) => candidate.parserEvidence.length === 0)
    .map((candidate) => ({
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.symbol,
      weakParameters: candidate.weakParameters,
      missingEvidence: "No parse/decode/schema/assertion call matched parser_call_patterns.",
    }))
    .sort(compareBoundaryParserFindings)
  const state = findings.length === 0 ? "zero" : "present"
  return baseOutput(
    state,
    boundaryFiles.length,
    candidates.length,
    findings,
    covered.sort(compareCoveredBoundaryFunctions),
    diagnosticLimit,
  )
}

const baseOutput = (
  state: BoundaryParserCoverageState,
  boundaryFilesMatched: number,
  boundaryFunctionsAnalyzed: number,
  findings: ReadonlyArray<BoundaryParserFinding>,
  covered: ReadonlyArray<BoundaryParserCoveredFunction>,
  diagnosticLimit: number,
): TsAd04Output => ({
  state,
  boundaryFilesMatched,
  boundaryFunctionsAnalyzed,
  weakBoundaryFunctions: findings.length + covered.length,
  coveredWeakBoundaryFunctions: covered.length,
  findings,
  covered,
  diagnosticLimit,
  compositeConsumers: [
    "boundary trust breach",
    "contract safety gap",
    "AI quicksand risk",
  ],
  cacheContributors: [
    "source tree",
    "config.boundary_globs",
    "config.parser_call_patterns",
    "config.exclude_globs",
    "config.top_n_diagnostics",
  ],
  calibrationSurface:
    "config.boundary_globs and config.parser_call_patterns; future reference-data boundary role conventions can replace path heuristics",
  enforcementCeiling: ["soft-warning", "trend", "review-routing"],
})

const isBoundarySourceFile = (
  sourceFile: SourceFile,
  config: TsAd04Config,
): boolean => {
  const file = sourceFile.getFilePath()
  return (
    !sourceFile.isDeclarationFile() &&
    !isExcluded(file, config.exclude_globs) &&
    isExcluded(file, config.boundary_globs)
  )
}

const collectBoundaryFunctionCandidates = (
  sourceFile: SourceFile,
  parserPatterns: ReadonlyArray<string>,
): ReadonlyArray<BoundaryFunctionCandidate> => [
  ...sourceFile.getFunctions().flatMap((fn) =>
    isBoundaryFunctionDeclaration(fn) ? [candidateFromFunction(sourceFile, fn, fn.getName() ?? "default", parserPatterns)] : [],
  ),
  ...sourceFile.getVariableDeclarations().flatMap((declaration) =>
    boundaryVariableFunction(declaration).map((fn) =>
      candidateFromFunction(sourceFile, fn, declaration.getName(), parserPatterns),
    ),
  ),
  ...sourceFile.getExportAssignments().flatMap((assignment) => {
    const expression = assignment.getExpression()
    if (!Node.isArrowFunction(expression) && !Node.isFunctionExpression(expression)) return []
    return [candidateFromFunction(sourceFile, expression, "default", parserPatterns)]
  }),
]

const isBoundaryFunctionDeclaration = (fn: FunctionDeclaration): boolean =>
  fn.isExported() || fn.isDefaultExport() || isHandlerName(fn.getName() ?? "")

const boundaryVariableFunction = (
  declaration: VariableDeclaration,
): Array<BoundaryFunctionNode> => {
  const initializer = declaration.getInitializer()
  if (initializer === undefined) return []
  const variableStatement = declaration.getVariableStatement()
  const boundaryLike =
    variableStatement?.isExported() === true ||
    isHandlerName(declaration.getName())
  if (!boundaryLike) return []
  if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
    return [initializer]
  }
  return []
}

const isHandlerName = (name: string): boolean =>
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|handler|handle|loader|action|fetch|main|run)$/u.test(name)

const candidateFromFunction = (
  sourceFile: SourceFile,
  fn: BoundaryFunctionNode,
  symbol: string,
  parserPatterns: ReadonlyArray<string>,
): BoundaryFunctionCandidate => {
  const weakParameters = fn.getParameters().flatMap(classifyWeakParameter)
  return {
    file: sourceFile.getFilePath(),
    line: fn.getStartLineNumber(),
    symbol,
    weakParameters,
    parserEvidence: collectParserEvidence(fn, parserPatterns, weakParameters),
  }
}

const classifyWeakParameter = (
  parameter: ParameterDeclaration,
): ReadonlyArray<WeakBoundaryParameter> => {
  const name = parameter.getName()
  const typeNode = parameter.getTypeNode()
  const typeText = typeNode?.getText() ?? "<untyped>"
  const normalized = typeText.toLowerCase()
  if (typeNode === undefined) {
    return [{ name, typeText, reason: "untyped" }]
  }
  if (/\bany\b/u.test(normalized)) {
    return [{ name, typeText, reason: "any" }]
  }
  if (/\bunknown\b/u.test(normalized)) {
    return [{ name, typeText, reason: "unknown" }]
  }
  if (REQUEST_LIKE_TYPE_NAMES.some((requestType) => typeText.includes(requestType))) {
    return [{ name, typeText, reason: "request-like" }]
  }
  return []
}

const collectParserEvidence = (
  fn: BoundaryFunctionNode,
  parserPatterns: ReadonlyArray<string>,
  weakParameters: ReadonlyArray<WeakBoundaryParameter>,
): ReadonlyArray<string> => {
  const patterns = parserPatterns.map((pattern) => normalizeCallText(pattern))
  const weakParameterNames = new Set(weakParameters.map((parameter) => parameter.name))
  if (patterns.length === 0 || weakParameterNames.size === 0) return []
  const calls = fn.getDescendantsOfKind(SyntaxKind.CallExpression)
  const evidence = new Set<string>()
  for (const call of calls) {
    const expression = call.getExpression()
    const expressionText = expression.getText()
    const normalizedCallee = normalizeCallText(calleeText(expression))
    if (
      patterns.some((pattern) => parserPatternMatchesCallee(pattern, normalizedCallee)) &&
      callReferencesWeakParameter(call, weakParameterNames)
    ) {
      evidence.add(expressionText)
    }
  }
  return [...evidence].sort()
}

const calleeText = (node: Node): string => {
  if (Node.isCallExpression(node)) return calleeText(node.getExpression())
  return node.getText()
}

const normalizeCallText = (text: string): string =>
  text.toLowerCase().replace(/\s+/gu, "")

const parserPatternMatchesCallee = (
  normalizedPattern: string,
  normalizedCallee: string,
): boolean => {
  if (normalizedPattern.includes(".")) {
    return normalizedCallee === normalizedPattern ||
      normalizedCallee.endsWith(`.${normalizedPattern}`)
  }
  return calleeSegments(normalizedCallee).some((segment) =>
    parserPatternMatchesSegment(normalizedPattern, segment),
  )
}

const calleeSegments = (normalizedCallee: string): ReadonlyArray<string> =>
  normalizedCallee.split(/[^a-z0-9_$]+/u).filter((segment) => segment.length > 0)

const parserPatternMatchesSegment = (
  normalizedPattern: string,
  segment: string,
): boolean => {
  if (segment === normalizedPattern) return true
  const suffix = segment.slice(normalizedPattern.length)
  return (suffix === "sync" || suffix === "async") &&
    segment.startsWith(normalizedPattern)
}

const callReferencesWeakParameter = (
  call: CallExpression,
  weakParameterNames: ReadonlySet<string>,
): boolean =>
  call.getArguments().some((argument) =>
    nodeReferencesWeakParameter(argument, weakParameterNames),
  )

const nodeReferencesWeakParameter = (
  node: Node,
  weakParameterNames: ReadonlySet<string>,
): boolean => {
  if (isFunctionScopeNode(node)) return false
  if (Node.isIdentifier(node) && weakParameterNames.has(node.getText())) return true
  return node.getChildren().some((child) =>
    nodeReferencesWeakParameter(child, weakParameterNames),
  )
}

const isFunctionScopeNode = (node: Node): boolean => {
  switch (node.getKind()) {
    case SyntaxKind.ArrowFunction:
    case SyntaxKind.FunctionExpression:
    case SyntaxKind.FunctionDeclaration:
    case SyntaxKind.MethodDeclaration:
    case SyntaxKind.Constructor:
    case SyntaxKind.GetAccessor:
    case SyntaxKind.SetAccessor:
      return true
    default:
      return false
  }
}

const normalizeDiagnosticLimit = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

const compareBoundaryParserFindings = (
  left: BoundaryParserFinding,
  right: BoundaryParserFinding,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.symbol.localeCompare(right.symbol)

const compareCoveredBoundaryFunctions = (
  left: BoundaryParserCoveredFunction,
  right: BoundaryParserCoveredFunction,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.symbol.localeCompare(right.symbol)
