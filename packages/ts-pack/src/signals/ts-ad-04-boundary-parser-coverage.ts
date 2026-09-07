import {
  SignalComputeError,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import type { SourceFile } from "../tsgo-api.js"
import { TsAnalysisTag } from "../ts-analysis.js"
import { isExcluded } from "./shared-globs.js"
import {
  collectBoundaryFunctionCandidates,
  type BoundaryFunctionAnalysis,
} from "./ts-ad-04-ingress-analysis.js"

export const TsAd04Config = Schema.Struct({
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

export type BoundaryIngressKind =
  | "unknown"
  | "untyped"
  | "parsed-wire"
  | "environment"
  | "filesystem"
  | "subprocess"
  | "ipc"
  | "external-sdk"

export interface BoundaryIngressSource {
  readonly kind: BoundaryIngressKind
  readonly evidence: string
  readonly parameter?: string
}

export type BoundaryFunctionExclusionReason =
  | "already-decoded-input"
  | "typed-input-projection"
  | "typed-error-envelope"
  | "runtime-type-refinement"
  | "terminal-output-projection"
  | "raw-ingress-carrier"
  | "effect-requirement-wrapper"

export interface BoundaryParserExcludedFunction {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly exclusionReason: BoundaryFunctionExclusionReason
  readonly exclusionEvidence: ReadonlyArray<string>
  readonly ingressSources: ReadonlyArray<BoundaryIngressSource>
  readonly parserEvidence: ReadonlyArray<string>
}

export interface BoundaryParserFinding {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly weakParameters: ReadonlyArray<WeakBoundaryParameter>
  readonly ingressSources: ReadonlyArray<BoundaryIngressSource>
  readonly candidateReason: "supported-untrusted-ingress"
  readonly parserEvidence: ReadonlyArray<string>
  readonly missingEvidence: string
}

export interface BoundaryParserCoveredFunction {
  readonly file: string
  readonly line: number
  readonly symbol: string
  readonly parserEvidence: ReadonlyArray<string>
  readonly weakParameters: ReadonlyArray<WeakBoundaryParameter>
  readonly ingressSources: ReadonlyArray<BoundaryIngressSource>
  readonly candidateReason: "supported-untrusted-ingress"
}

export interface TsAd04Output {
  readonly state: BoundaryParserCoverageState
  readonly boundaryFilesMatched: number
  readonly boundaryFunctionsAnalyzed: number
  readonly weakBoundaryFunctions: number
  readonly coveredWeakBoundaryFunctions: number
  readonly findings: ReadonlyArray<BoundaryParserFinding>
  readonly covered: ReadonlyArray<BoundaryParserCoveredFunction>
  readonly excludedBoundaryFunctions: number
  readonly excluded: ReadonlyArray<BoundaryParserExcludedFunction>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

// Ratio denominators below this count scale pressure down proportionally:
// a single weak function cannot zero the signal on its own.
const MIN_WEAK_BOUNDARY_EVIDENCE = 4

export const TsAd04: Signal<TsAd04Config, TsAd04Output, TsAnalysisTag> = {
  id: "TS-AD-04-boundary-parser-coverage",
  title: "Boundary parser coverage",
  aliases: ["TS-AD-04"],
  tier: 2,
  category: "architectural-drift",
  kind: "structural",
  evidenceClass: "heuristic-pattern",
  cacheVersion:
    "ts-boundary-parser-evidence-v8-lexical-binding-compound-write",
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
      "**/src/cli/*.ts",
      "**/src/cli/**/*.ts",
      "**/commands/*.ts",
      "**/commands/**/*.ts",
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
      const analysis = yield* TsAnalysisTag
      const sourceFiles = yield* analysis.mapFiles(async (fileContext) => fileContext.sourceFile).pipe(
        Effect.mapError((cause) =>
          new SignalComputeError({
            signalId: "TS-AD-04-boundary-parser-coverage",
            message: cause.message,
            cause,
          }),
        ),
      )
      return yield* Effect.try({
        try: (): TsAd04Output =>
          computeBoundaryParserCoverage(sourceFiles, config),
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
    // Below the evidence floor a ratio is one misclassification away from a
    // cliff (1 finding / 1 weak function scored 0.00 and poisoned a whole
    // category); pressure scales with how much evidence actually exists.
    const ratio = Math.min(1, out.findings.length / out.weakBoundaryFunctions)
    const evidenceFactor = Math.min(
      1,
      out.weakBoundaryFunctions / MIN_WEAK_BOUNDARY_EVIDENCE,
    )
    return Math.max(0, 1 - ratio * evidenceFactor)
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
    const findings: ReadonlyArray<Diagnostic> = out.findings
      .slice(0, out.diagnosticLimit)
      .map((finding) => ({
        severity: "warn" as const,
        message:
          `Boundary function \`${finding.symbol}\` receives supported untrusted ingress ` +
          "without parse/decode evidence",
        location: { file: finding.file, line: finding.line },
        data: { ...finding },
        fixHints: [{
          kind: "add-boundary-parser",
          title: "Validate untrusted boundary ingress",
          summary:
            "Validate the cited ingress source near the boundary, then pass only decoded data into domain logic.",
          confidence: "high",
          autoApplicable: false,
          data: {
            symbol: finding.symbol,
            weakParameters: finding.weakParameters,
            ingressSources: finding.ingressSources,
            candidateReason: finding.candidateReason,
          },
        }],
      }))
    if (
      out.diagnosticLimit === 0 ||
      (out.covered.length === 0 && out.excluded.length === 0)
    ) return findings
    return [
      ...findings,
      {
        severity: "info" as const,
        message:
          `Boundary parser coverage audit: ${out.covered.length} covered, ${out.excluded.length} excluded`,
        data: {
          kind: "boundary-parser-coverage-audit",
          coveredTotal: out.covered.length,
          excludedTotal: out.excluded.length,
          coveredTruncated: out.covered.length > out.diagnosticLimit,
          excludedTruncated: out.excluded.length > out.diagnosticLimit,
          covered: out.covered.slice(0, out.diagnosticLimit),
          excluded: out.excluded.slice(0, out.diagnosticLimit),
        },
      },
    ]
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
    return baseOutput("not_configured", 0, 0, [], [], [], diagnosticLimit)
  }

  const boundaryFiles = sourceFiles.filter((sourceFile) =>
    isBoundarySourceFile(sourceFile, config),
  )
  if (boundaryFiles.length === 0) {
    return baseOutput("absent", 0, 0, [], [], [], diagnosticLimit)
  }

  const callSiteSourceFiles = sourceFiles.filter((sourceFile) =>
    isAnalyzedSourceFile(sourceFile, config),
  )
  const candidates = boundaryFiles.flatMap((sourceFile) =>
    collectBoundaryFunctionCandidates(
      sourceFile,
      config.parser_call_patterns,
      callSiteSourceFiles,
    ),
  )
  const excluded = candidates
    .filter((candidate): candidate is BoundaryFunctionAnalysis & {
      readonly exclusionReason: BoundaryFunctionExclusionReason
    } => candidate.exclusionReason !== undefined)
    .map((candidate) => ({
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.symbol,
      exclusionReason: candidate.exclusionReason,
      exclusionEvidence: candidate.exclusionEvidence,
      ingressSources: candidate.ingressSources,
      parserEvidence: candidate.parserEvidence,
    }))
    .sort(compareBoundaryFunctionLocation)
  const weakCandidates = candidates.filter((candidate) =>
    candidate.exclusionReason === undefined && candidate.ingressSources.length > 0
  )
  if (weakCandidates.length === 0) {
    return baseOutput(
      "not_applicable",
      boundaryFiles.length,
      candidates.length,
      [],
      [],
      excluded,
      diagnosticLimit,
    )
  }

  const covered = weakCandidates
    .filter((candidate) => candidate.parserEvidence.length > 0)
    .map((candidate) => ({
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.symbol,
      parserEvidence: candidate.parserEvidence,
      weakParameters: candidate.weakParameters,
      ingressSources: candidate.ingressSources,
      candidateReason: "supported-untrusted-ingress" as const,
    }))
  const findings = weakCandidates
    .filter((candidate) => candidate.parserEvidence.length === 0)
    .map((candidate) => ({
      file: candidate.file,
      line: candidate.line,
      symbol: candidate.symbol,
      weakParameters: candidate.weakParameters,
      ingressSources: candidate.ingressSources,
      candidateReason: "supported-untrusted-ingress" as const,
      parserEvidence: candidate.parserEvidence,
      missingEvidence: "No parse/decode/schema/assertion call matched parser_call_patterns.",
    }))
    .sort(compareBoundaryFunctionLocation)
  const state = findings.length === 0 ? "zero" : "present"
  return baseOutput(
    state,
    boundaryFiles.length,
    candidates.length,
    findings,
    covered.sort(compareBoundaryFunctionLocation),
    excluded,
    diagnosticLimit,
  )
}

const baseOutput = (
  state: BoundaryParserCoverageState,
  boundaryFilesMatched: number,
  boundaryFunctionsAnalyzed: number,
  findings: ReadonlyArray<BoundaryParserFinding>,
  covered: ReadonlyArray<BoundaryParserCoveredFunction>,
  excluded: ReadonlyArray<BoundaryParserExcludedFunction>,
  diagnosticLimit: number,
): TsAd04Output => ({
  state,
  boundaryFilesMatched,
  boundaryFunctionsAnalyzed,
  weakBoundaryFunctions: findings.length + covered.length,
  coveredWeakBoundaryFunctions: covered.length,
  findings,
  covered,
  excludedBoundaryFunctions: excluded.length,
  excluded,
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
  const file = sourceFile.fileName
  return (
    !sourceFile.isDeclarationFile &&
    !isExcluded(file, config.exclude_globs) &&
    isExcluded(file, config.boundary_globs)
  )
}

const isAnalyzedSourceFile = (
  sourceFile: SourceFile,
  config: TsAd04Config,
): boolean =>
  !sourceFile.isDeclarationFile &&
  !isExcluded(sourceFile.fileName, config.exclude_globs)


const normalizeDiagnosticLimit = (value: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

const compareBoundaryFunctionLocation = (
  left: { readonly file: string; readonly line: number; readonly symbol: string },
  right: { readonly file: string; readonly line: number; readonly symbol: string },
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.symbol.localeCompare(right.symbol)
