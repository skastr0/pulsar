import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsAnalysisTag } from "../ts-analysis.js"
import { locationOf, textOf, walkDescendants } from "../ast.js"
import {
  isArrowFunction,
  isCallExpression,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isNumericLiteral,
  isStringLiteral,
  type CallExpression,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import { matchesAnyGlob } from "./shared-globs.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"
import { isExcluded } from "./shared-globs.js"

const TsSec02Config = Schema.Struct({
  boundary_globs: Schema.Array(Schema.String),
  parser_call_patterns: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsSec02Config = typeof TsSec02Config.Type

export type UntrustedBoundarySinkKind =
  | "raw-json-parse"
  | "unconstrained-fetch-url"
  | "raw-buffer-deserialization"
  | "boundary-value-dangerous-sink"

export interface UntrustedBoundarySinkFinding extends SourceLocation {
  readonly kind: UntrustedBoundarySinkKind
  readonly sink: string
  readonly expression: string
  readonly missingEvidence: string
}

export interface TsSec02Output {
  readonly state: "present" | "zero" | "absent" | "not_configured"
  readonly boundaryFilesMatched: number
  readonly sinksAnalyzed: number
  readonly findings: ReadonlyArray<UntrustedBoundarySinkFinding>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsSec02: Signal<TsSec02Config, TsSec02Output, TsAnalysisTag> = {
  id: "TS-SEC-02-untrusted-boundary-sinks",
  title: "Untrusted boundary sinks",
  aliases: ["TS-SEC-02"],
  tier: 2,
  category: "security-risk",
  kind: "structural",
  evidenceClass: "heuristic-pattern",
  cacheVersion: "untrusted-boundary-sinks-v1",
  configSchema: TsSec02Config,
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
      "**/*route.ts",
      "**/*handler.ts",
      "**/*controller.ts",
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
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const analysis = yield* TsAnalysisTag
      const fileOutputs = yield* analysis.mapFiles(async (context) =>
        analyzeUntrustedBoundarySinks(context.sourceFile, context.file.path, config),
      ).pipe(Effect.mapError((cause) =>
        new SignalComputeError({
          signalId: "TS-SEC-02-untrusted-boundary-sinks",
          message: cause.message,
          cause,
        }),
      ))
      return mergeUntrustedBoundarySinks(fileOutputs, config)
    }),
  score: (out) =>
    out.state === "present" ? 1 / (1 + out.findings.length / 5) : 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "warn",
      message: `${finding.sink} consumes boundary-shaped input without parser/schema evidence`,
      location: {
        file: finding.file,
        line: finding.line,
        column: finding.column,
      },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.kind}:${finding.expression}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "add-boundary-parser",
        title: "Decode before the sink",
        summary:
          "Validate or decode the untrusted value with the repo's schema/parser before it reaches this sink.",
        confidence: "high",
        autoApplicable: false,
        data: { kind: finding.kind, sink: finding.sink },
      }],
    })),
  outputMetadata: (out) => {
    if (out.state === "not_configured" || out.state === "absent") {
      return { applicability: "insufficient_evidence" as const }
    }
    return undefined
  },
}

interface BoundaryFileAnalysis {
  readonly matched: boolean
  readonly sinksAnalyzed: number
  readonly findings: ReadonlyArray<UntrustedBoundarySinkFinding>
}

const analyzeUntrustedBoundarySinks = (
  sourceFile: SourceFile,
  filePath: string,
  config: TsSec02Config,
): BoundaryFileAnalysis => {
  if (isExcluded(filePath, config.exclude_globs) || !matchesAnyGlob(filePath, config.boundary_globs)) {
    return { matched: false, sinksAnalyzed: 0, findings: [] }
  }
  const findings: Array<UntrustedBoundarySinkFinding> = []
  let sinksAnalyzed = 0
  walkDescendants(sourceFile, (node) => {
    if (!isCallExpression(node)) return
    const sink = classifyBoundarySink(node)
    if (sink === undefined) return
    sinksAnalyzed += 1
    if (sink.covered) return
    findings.push({
      ...locationOf(node, filePath),
      kind: sink.kind,
      sink: sink.sink,
      expression: textOf(node).slice(0, 160),
      missingEvidence: missingEvidenceFor(sink.kind, config.parser_call_patterns),
    })
  })
  return { matched: true, sinksAnalyzed, findings }
}

const mergeUntrustedBoundarySinks = (
  fileOutputs: ReadonlyArray<BoundaryFileAnalysis>,
  config: TsSec02Config,
): TsSec02Output => {
  const diagnosticLimit = normalizeDiagnosticLimit(config.top_n_diagnostics)
  if (config.boundary_globs.length === 0) {
    return baseOutput("not_configured", 0, 0, [], diagnosticLimit)
  }
  const matched = fileOutputs.filter((output) => output.matched)
  if (matched.length === 0) {
    return baseOutput("absent", 0, 0, [], diagnosticLimit)
  }
  const findings = matched.flatMap((output) => output.findings)
  const sinksAnalyzed = matched.reduce((sum, output) => sum + output.sinksAnalyzed, 0)
  return baseOutput(
    findings.length === 0 ? "zero" : "present",
    matched.length,
    sinksAnalyzed,
    findings.sort(compareFindings),
    diagnosticLimit,
  )
}

const classifyBoundarySink = (
  call: CallExpression,
): { readonly kind: UntrustedBoundarySinkKind; readonly sink: string; readonly covered: boolean } | undefined => {
  const name = callName(call.expression)
  const args = call.arguments

  if (name === "JSON.parse") {
    return {
      kind: "raw-json-parse",
      sink: name,
      covered: isStringLiteralLike(args[0]) || hasParserAncestor(call),
    }
  }
  if (name === "fetch") {
    return {
      kind: "unconstrained-fetch-url",
      sink: name,
      covered: isStringLiteralLike(args[0]) || isNewUrlExpression(args[0]) || hasParserAncestor(call),
    }
  }
  if (name === "Buffer.from" || name.endsWith(".deserialize") || name.endsWith(".decode")) {
    return {
      kind: "raw-buffer-deserialization",
      sink: name,
      covered: hasParserAncestor(call),
    }
  }
  if ((name === "eval" || name === "Function") && !isStringLiteralLike(args[0])) {
    return {
      kind: "boundary-value-dangerous-sink",
      sink: name,
      covered: hasParserAncestor(call),
    }
  }
  return undefined
}

const hasParserAncestor = (call: CallExpression): boolean => {
  let current: Node | undefined = call.parent
  let depth = 0
  while (current !== undefined && depth < 5) {
    if (isCallExpression(current) && current !== call) {
      const name = callName(current.expression).toLowerCase()
      if (
        name !== "json.parse" &&
        /(parse|safeparse|decode|decodeunknown|validate|assert|schema)/.test(name)
      ) {
        return true
      }
    }
    current = current.parent
    depth += 1
  }
  return false
}

const isNewUrlExpression = (node: Node | undefined): boolean =>
  node !== undefined &&
  isNewExpression(node) &&
  callName(node.expression) === "URL"

const missingEvidenceFor = (
  kind: UntrustedBoundarySinkKind,
  parserPatterns: ReadonlyArray<string>,
): string =>
  kind === "unconstrained-fetch-url"
    ? "Expected literal/URL object construction or schema evidence for boundary-derived URL parts"
    : `Expected one parser/schema call before the sink (${parserPatterns.join(", ")})`

const baseOutput = (
  state: TsSec02Output["state"],
  boundaryFilesMatched: number,
  sinksAnalyzed: number,
  findings: ReadonlyArray<UntrustedBoundarySinkFinding>,
  diagnosticLimit: number,
): TsSec02Output => ({
  state,
  boundaryFilesMatched,
  sinksAnalyzed,
  findings,
  diagnosticLimit,
  compositeConsumers: ["boundary trust breach", "security review route"],
  cacheContributors: [
    "source tree",
    "config.boundary_globs",
    "config.parser_call_patterns",
    "config.exclude_globs",
    "config.top_n_diagnostics",
  ],
  calibrationSurface: "config.boundary_globs and config.parser_call_patterns",
  enforcementCeiling: ["review-route"],
})

const compareFindings = (
  left: UntrustedBoundarySinkFinding,
  right: UntrustedBoundarySinkFinding,
): number =>
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column ||
  left.kind.localeCompare(right.kind)

const callName = (node: Node | undefined): string => {
  if (node === undefined) return ""
  return textOf(node).replace(/\s+/g, " ").trim().replace(/\?./g, ".")
}

const isStringLiteralLike = (node: Node | undefined): boolean =>
  node !== undefined &&
  (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node) || isNumericLiteral(node))
