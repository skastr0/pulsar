import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { Node, SyntaxKind, type CallExpression, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import { matchesAnyGlob } from "./shared-globs.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  callName,
  isAnalyzableSourceFile,
  isStringLiteralLike,
  locationOf,
  normalizeDiagnosticLimit,
  type SourceLocation,
} from "./trust-signal-helpers.js"

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

export const TsSec02: Signal<TsSec02Config, TsSec02Output, TsProjectTag> = {
  id: "TS-SEC-02-untrusted-boundary-sinks",
  title: "Untrusted boundary sinks",
  aliases: ["TS-SEC-02"],
  tier: 1,
  category: "security-risk",
  kind: "structural",
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
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsSec02Output =>
          computeUntrustedBoundarySinks(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-SEC-02-untrusted-boundary-sinks",
            message: String(cause),
            cause,
          }),
      })
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

const computeUntrustedBoundarySinks = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsSec02Config,
): TsSec02Output => {
  const diagnosticLimit = normalizeDiagnosticLimit(config.top_n_diagnostics)
  if (config.boundary_globs.length === 0) {
    return baseOutput("not_configured", 0, 0, [], diagnosticLimit)
  }

  const boundaryFiles = sourceFiles.filter((sourceFile) =>
    isAnalyzableSourceFile(sourceFile, config.exclude_globs) &&
    matchesAnyGlob(sourceFile.getFilePath(), config.boundary_globs)
  )
  if (boundaryFiles.length === 0) {
    return baseOutput("absent", 0, 0, [], diagnosticLimit)
  }

  const findings: Array<UntrustedBoundarySinkFinding> = []
  let sinksAnalyzed = 0
  for (const sourceFile of boundaryFiles) {
    for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const sink = classifyBoundarySink(call)
      if (sink === undefined) continue
      sinksAnalyzed += 1
      if (sink.covered) continue
      findings.push({
        ...locationOf(call),
        kind: sink.kind,
        sink: sink.sink,
        expression: call.getText().slice(0, 160),
        missingEvidence: missingEvidenceFor(sink.kind, config.parser_call_patterns),
      })
    }
  }

  return baseOutput(
    findings.length === 0 ? "zero" : "present",
    boundaryFiles.length,
    sinksAnalyzed,
    findings.sort(compareFindings),
    diagnosticLimit,
  )
}

const classifyBoundarySink = (
  call: CallExpression,
): { readonly kind: UntrustedBoundarySinkKind; readonly sink: string; readonly covered: boolean } | undefined => {
  const name = callName(call.getExpression())
  const args = call.getArguments()

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
  let current: Node | undefined = call.getParent()
  let depth = 0
  while (current !== undefined && depth < 5) {
    if (Node.isCallExpression(current) && current !== call) {
      const name = callName(current.getExpression()).toLowerCase()
      if (
        name !== "json.parse" &&
        /(parse|safeparse|decode|decodeunknown|validate|assert|schema)/.test(name)
      ) {
        return true
      }
    }
    current = current.getParent()
    depth += 1
  }
  return false
}

const isNewUrlExpression = (node: Node | undefined): boolean =>
  node !== undefined &&
  Node.isNewExpression(node) &&
  callName(node.getExpression()) === "URL"

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
