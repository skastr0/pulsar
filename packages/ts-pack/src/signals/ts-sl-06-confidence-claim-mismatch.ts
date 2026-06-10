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
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  isAnalyzableSourceFile,
  locationOf,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"

const TsSl06Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  claim_name_patterns: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsSl06Config = typeof TsSl06Config.Type

export interface ConfidenceClaimMismatchFinding extends SourceLocation {
  readonly symbol: string
  readonly claimKind: string
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

export const TsSl06: Signal<TsSl06Config, TsSl06Output, TsProjectTag> = {
  id: "TS-SL-06-confidence-claim-mismatch",
  title: "Confidence claim mismatch",
  aliases: ["TS-SL-06"],
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  cacheVersion: "confidence-claim-mismatch-v2",
  configSchema: TsSl06Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    claim_name_patterns: ["validate", "parse", "assert", "ensure", "is[A-Z]", "has[A-Z]"],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsSl06Output =>
          computeConfidenceClaimMismatch(project.getSourceFiles(), config),
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
      message: `${finding.symbol} claims to ${finding.claimKind} but has no validation/narrowing evidence`,
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
      if (hasClaimEvidence(candidate.bodyText, candidate.returnTypeText, candidate.claimKind)) {
        continue
      }
      findings.push({
        ...candidate.location,
        symbol: candidate.symbol,
        claimKind: candidate.claimKind,
        bodySummary: candidate.bodyText.slice(0, 160),
        missingEvidence: "Expected schema/parser call, runtime guard, assertion throw, or type predicate evidence",
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
  readonly claimKind: string
  readonly bodyText: string
  readonly returnTypeText: string
  readonly location: SourceLocation
}

const collectClaimCandidates = (
  sourceFile: SourceFile,
  claimPattern: RegExp,
): ReadonlyArray<ClaimCandidate> => [
  ...sourceFile.getDescendantsOfKind(SyntaxKind.FunctionDeclaration).flatMap((node) =>
    candidateFromFunction(node, node.getName(), claimPattern),
  ),
  ...sourceFile.getDescendantsOfKind(SyntaxKind.MethodDeclaration).flatMap((node) =>
    candidateFromFunction(node, node.getName(), claimPattern),
  ),
  ...sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration).flatMap((node) =>
    candidateFromVariable(node, claimPattern),
  ),
]

const candidateFromFunction = (
  node: FunctionDeclaration | MethodDeclaration,
  name: string | undefined,
  claimPattern: RegExp,
): ReadonlyArray<ClaimCandidate> => {
  if (name === undefined || !claimPattern.test(name)) return []
  const body = node.getBody()
  if (body === undefined) return []
  return [{
    symbol: name,
    claimKind: claimKindOf(name),
    bodyText: body.getText(),
    returnTypeText: node.getReturnType().getText(node),
    location: locationOf(node),
  }]
}

const candidateFromVariable = (
  node: VariableDeclaration,
  claimPattern: RegExp,
): ReadonlyArray<ClaimCandidate> => {
  const name = node.getName()
  if (!claimPattern.test(name)) return []
  const initializer = node.getInitializer()
  if (
    initializer === undefined ||
    (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer))
  ) {
    return []
  }
  const body = initializer.getBody()
  return [{
    symbol: name,
    claimKind: claimKindOf(name),
    bodyText: body.getText(),
    returnTypeText: initializer.getReturnType().getText(initializer),
    location: locationOf(node),
  }]
}

const hasClaimEvidence = (
  bodyText: string,
  returnTypeText: string,
  claimKind: string,
): boolean => {
  const normalized = bodyText.toLowerCase()
  if (/\basserts\b|\sis\s/.test(returnTypeText)) return true
  if (/(throw\s+new|throw\s+\w+)/.test(bodyText)) return true
  if (hasRuntimeGuardEvidence(bodyText)) return true
  // Delegating to a parse*/validate*/decode*/assert* call target (local or member) is
  // validation evidence: the callee carries the verification.
  if (/(\.safeparse\s*\(|\bparse\w*\s*\(|\bdecode\w*\s*\(|\bvalidate\w*\s*\(|\bassert\w*\s*\(|schema)/i.test(bodyText)) {
    return true
  }
  if (claimKind === "parse" && hasParseEvidence(bodyText)) {
    return true
  }
  if (claimKind === "ensure" && hasEnsureEvidence(bodyText)) {
    return true
  }
  if (/return\s+(?:true|false|value|input|raw|data)\s*;?\s*\}?$/i.test(normalized)) {
    return false
  }
  if (/\bas\s+[A-Za-z_$][\w$<>, ]+/.test(bodyText)) return false
  return false
}

const hasRuntimeGuardEvidence = (bodyText: string): boolean =>
  /(typeof|instanceof|\bin\b|!==|===|!=|==|Array\.isArray)/.test(bodyText) ||
  /\.(?:test|startsWith|endsWith|includes|has)\s*\(/.test(bodyText) ||
  // Either.isRight / Option.isSome style guards (Effect/fp-ts idioms) are checked-branch
  // verification, whether module-qualified or imported standalone.
  /\bis(?:Right|Left|Some|None|Ok|Err|Success|Failure)\s*\(/.test(bodyText) ||
  /\b(?:length|size)\s*(?:>|>=|<|<=)\s*\d+/.test(bodyText)

const hasParseEvidence = (bodyText: string): boolean =>
  /(JSON\.parse|Number\s*\(|String\s*\(|Boolean\s*\(|parseInt\s*\(|parseFloat\s*\()/.test(bodyText) ||
  /(?:new\s+(?:Date|URL)|Date\.parse|URL\.parse)\s*\(/.test(bodyText)

const hasEnsureEvidence = (bodyText: string): boolean =>
  /\b(?:mkdir|writeFile|rename|rm)\s*\(/.test(bodyText) ||
  /\.(?:mkdir|writeFile|rename|rm)\s*\(/.test(bodyText) ||
  hasConflictTolerantSqlEvidence(bodyText)

// SQL keywords inside embedded query strings are not code-level confidence claims:
// INSERT OR IGNORE / ON CONFLICT DO NOTHING are database-enforced idempotent writes,
// which is exactly the guarantee an ensure* claim promises.
const hasConflictTolerantSqlEvidence = (bodyText: string): boolean =>
  /\binsert\s+or\s+ignore\b/i.test(bodyText) ||
  /\bon\s+conflict\b[\s\S]{0,120}?\bdo\s+nothing\b/i.test(bodyText)

const claimKindOf = (name: string): string => {
  const lower = name.toLowerCase()
  if (lower.startsWith("parse")) return "parse"
  if (lower.startsWith("assert")) return "assert"
  if (lower.startsWith("ensure")) return "ensure"
  if (lower.startsWith("validate")) return "validate"
  if (lower.startsWith("is")) return "narrow"
  if (lower.startsWith("has")) return "presence-check"
  return "validate"
}

const compareFindings = (
  left: ConfidenceClaimMismatchFinding,
  right: ConfidenceClaimMismatchFinding,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.symbol.localeCompare(right.symbol)
