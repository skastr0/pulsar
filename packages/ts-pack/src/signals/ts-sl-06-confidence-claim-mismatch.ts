import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { textOf, walkDescendants } from "../ast.js"
import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isVariableDeclaration,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "../tsgo-api.js"
import { TsAnalysisTag } from "../ts-analysis.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  isAnalyzableSourceFile,
  locationOf,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"
import {
  claimKindOf,
  summarizeClaimBehavior,
  type ClaimFunctionNode,
  type ClaimKind,
} from "./ts-sl-06-behavior-summary.js"

const TsSl06Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  claim_name_patterns: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsSl06Config = typeof TsSl06Config.Type

export interface ConfidenceClaimMismatchFinding extends SourceLocation {
  readonly symbol: string
  readonly claimKind: ClaimKind
  readonly claimedGuarantee: string
  readonly supportingBehavior: ReadonlyArray<string>
  readonly observedBehavior: ReadonlyArray<string>
  readonly missingBehavior: ReadonlyArray<string>
  readonly bodySummary: string
  readonly missingEvidence: string
}

export interface TsSl06Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly analyzedFiles: number
  readonly claimFunctionsAnalyzed: number
  readonly findings: ReadonlyArray<ConfidenceClaimMismatchFinding>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsSl06: Signal<TsSl06Config, TsSl06Output, TsAnalysisTag> = {
  id: "TS-SL-06-confidence-claim-mismatch",
  title: "Confidence claim mismatch",
  aliases: ["TS-SL-06"],
  tier: 2,
  category: "generated-slop",
  kind: "structural",
  evidenceClass: "heuristic-pattern",
  cacheVersion: "confidence-claim-mismatch-v3",
  configSchema: TsSl06Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    claim_name_patterns: ["validate", "parse", "assert", "ensure", "is[A-Z]", "has[A-Z]"],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const sourceFiles = yield* analysis.mapFiles(async (fileContext) => fileContext.sourceFile).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-SL-06-confidence-claim-mismatch",
            message: cause.message,
            cause,
          }),
        ),
      )
      return yield* Effect.try({
        try: (): TsSl06Output =>
          computeConfidenceClaimMismatch(sourceFiles, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-SL-06-confidence-claim-mismatch",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) =>
    out.state === "present"
      ? Math.max(0, 1 - out.findings.length / Math.max(1, out.claimFunctionsAnalyzed))
      : 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "warn",
      message:
        `${finding.symbol} claims ${finding.claimedGuarantee}; ` +
        `supporting behavior: ${formatBehavior(finding.supportingBehavior, "none")}; ` +
        `observed behavior: ${formatBehavior(finding.observedBehavior, "no relevant runtime behavior")}; ` +
        `missing behavior: ${finding.missingBehavior.join(", ")}`,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.symbol}:${finding.claimKind}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "align-confidence-claim",
        title: "Make the claim true or rename it",
        summary:
          "Add actual validation, parsing, assertion, narrowing, or schema decode evidence; otherwise rename the symbol so it does not imply a guarantee.",
        confidence: "medium",
        autoApplicable: false,
        data: { symbol: finding.symbol, claimKind: finding.claimKind },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const computeConfidenceClaimMismatch = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsSl06Config,
): TsSl06Output => {
  const findings: Array<ConfidenceClaimMismatchFinding> = []
  let analyzedFiles = 0
  let claimFunctionsAnalyzed = 0
  const claimPattern = new RegExp(`^(?:${config.claim_name_patterns.join("|")})`)

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    analyzedFiles += 1
    for (const candidate of collectClaimCandidates(sourceFile, claimPattern)) {
      claimFunctionsAnalyzed += 1
      const behavior = summarizeClaimBehavior(candidate.fn, candidate.claimKind)
      if (behavior.supportsClaim) continue
      findings.push({
        ...candidate.location,
        symbol: candidate.symbol,
        claimKind: candidate.claimKind,
        claimedGuarantee: behavior.claimedGuarantee,
        supportingBehavior: behavior.supportingBehavior,
        observedBehavior: behavior.observedBehavior,
        missingBehavior: behavior.missingBehavior,
        bodySummary: candidate.bodyText.slice(0, 160),
        missingEvidence: behavior.missingBehavior.join("; "),
      })
    }
  }

  return {
    state: analyzedFiles === 0
      ? "not_applicable"
      : claimFunctionsAnalyzed === 0 ? "not_applicable" : findings.length === 0 ? "zero" : "present",
    analyzedFiles,
    claimFunctionsAnalyzed,
    findings: findings.sort(compareFindings),
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: ["AI hotspot likelihood", "agent trust readout"],
    cacheContributors: [
      "source tree",
      "config.claim_name_patterns",
      "config.exclude_globs",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config.claim_name_patterns and config.exclude_globs",
    enforcementCeiling: ["review-route"],
  }
}

interface ClaimCandidate {
  readonly symbol: string
  readonly claimKind: ClaimKind
  readonly fn: ClaimFunctionNode
  readonly bodyText: string
  readonly location: SourceLocation
}

const collectClaimCandidates = (
  sourceFile: SourceFile,
  claimPattern: RegExp,
): ReadonlyArray<ClaimCandidate> => {
  const candidates: Array<ClaimCandidate> = []
  walkDescendants(sourceFile, (node) => {
    if (isFunctionDeclaration(node) || isMethodDeclaration(node)) {
      const name = node.name === undefined ? undefined : (isIdentifier(node.name) ? node.name.text : textOf(node.name))
      candidates.push(...candidateFromFunction(node, name, claimPattern))
    }
    if (isVariableDeclaration(node)) {
      candidates.push(...candidateFromVariable(node, claimPattern))
    }
  })
  return candidates
}

const candidateFromFunction = (
  node: FunctionDeclaration | MethodDeclaration,
  name: string | undefined,
  claimPattern: RegExp,
): ReadonlyArray<ClaimCandidate> => {
  if (name === undefined || !claimPattern.test(name)) return []
  const body = node.body
  if (body === undefined) return []
  return [{
    symbol: name,
    claimKind: claimKindOf(name),
    fn: node,
    bodyText: textOf(body),
    location: locationOf(node),
  }]
}

const candidateFromVariable = (
  node: VariableDeclaration,
  claimPattern: RegExp,
): ReadonlyArray<ClaimCandidate> => {
  if (!isIdentifier(node.name)) return []
  const name = node.name.text
  if (!claimPattern.test(name)) return []
  const initializer = node.initializer
  if (
    initializer === undefined ||
    (!isArrowFunction(initializer) && !isFunctionExpression(initializer))
  ) {
    return []
  }
  const body = initializer.body
  if (body === undefined) return []
  return [{
    symbol: name,
    claimKind: claimKindOf(name),
    fn: initializer,
    bodyText: textOf(body),
    location: locationOf(node),
  }]
}

const formatBehavior = (behavior: ReadonlyArray<string>, fallback: string): string =>
  behavior.length === 0 ? fallback : behavior.join(", ")

const compareFindings = (
  left: ConfidenceClaimMismatchFinding,
  right: ConfidenceClaimMismatchFinding,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.symbol.localeCompare(right.symbol)
