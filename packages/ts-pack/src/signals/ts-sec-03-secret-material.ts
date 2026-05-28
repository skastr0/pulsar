import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { Node, type SourceFile } from "ts-morph"
import { TsProjectTag } from "../ts-project.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
  isAnalyzableSourceFile,
  normalizeDiagnosticLimit,
  normalizeIdentifier,
  shannonEntropy,
  type SourceLocation,
} from "./trust-signal-helpers.js"

const TsSec03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  min_entropy: Schema.Number,
  min_secret_length: Schema.Number,
})
export type TsSec03Config = typeof TsSec03Config.Type

export type SecretMaterialKind =
  | "known-secret-prefix"
  | "private-key-block"
  | "secret-named-literal"
  | "high-entropy-literal"

export interface SecretMaterialFinding extends SourceLocation {
  readonly kind: SecretMaterialKind
  readonly identifier: string
  readonly redacted: string
  readonly entropy: number
}

export interface TsSec03Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly analyzedFiles: number
  readonly literalsScanned: number
  readonly findings: ReadonlyArray<SecretMaterialFinding>
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export const TsSec03: Signal<TsSec03Config, TsSec03Output, TsProjectTag> = {
  id: "TS-SEC-03-secret-material",
  title: "Secret material",
  aliases: ["TS-SEC-03"],
  tier: 1,
  category: "security-risk",
  kind: "structural",
  cacheVersion: "secret-material-v2-literal-ast-and-token-shape",
  configSchema: TsSec03Config,
  defaultConfig: {
    exclude_globs: [...PRODUCTION_EXCLUDE_GLOBS],
    top_n_diagnostics: 10,
    min_entropy: 3.5,
    min_secret_length: 20,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      return yield* Effect.try({
        try: (): TsSec03Output => computeSecretMaterial(project.getSourceFiles(), config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-SEC-03-secret-material",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => out.state === "present" ? Math.max(0, 1 - out.findings.length / 5) : 1,
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: "block",
      message: `${finding.kind} resembles committed secret material (${finding.redacted})`,
      location: { file: finding.file, line: finding.line, column: finding.column },
      data: {
        hash: computeDiagnosticHash(
          `${finding.file}:${finding.line}:${finding.column}:${finding.kind}:${finding.redacted}`,
        ),
        ...finding,
      },
      fixHints: [{
        kind: "remove-secret-material",
        title: "Move the secret out of source",
        summary:
          "Revoke this value if real, replace it with a configuration reference, and keep only test-safe placeholders in source.",
        confidence: "high",
        autoApplicable: false,
        data: { kind: finding.kind, identifier: finding.identifier },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

const computeSecretMaterial = (
  sourceFiles: ReadonlyArray<SourceFile>,
  config: TsSec03Config,
): TsSec03Output => {
  const findings: Array<SecretMaterialFinding> = []
  let analyzedFiles = 0
  let literalsScanned = 0

  for (const sourceFile of sourceFiles) {
    if (!isAnalyzableSourceFile(sourceFile, config.exclude_globs)) continue
    analyzedFiles += 1
    const text = sourceFile.getFullText()
    for (const literal of collectStringLiterals(sourceFile)) {
      const value = literal.value.trim()
      if (value.length === 0) continue
      literalsScanned += 1
      const identifier = nearbyIdentifier(text, literal.index)
      const kind = classifySecretLiteral(identifier, value, config)
      if (kind === undefined) continue
      const { line, column } = sourceFile.getLineAndColumnAtPos(literal.index)
      findings.push({
        file: sourceFile.getFilePath(),
        line,
        column,
        kind,
        identifier,
        redacted: redactSecret(value),
        entropy: round(shannonEntropy(value)),
      })
    }
  }

  return {
    state: analyzedFiles === 0 ? "not_applicable" : findings.length === 0 ? "zero" : "present",
    analyzedFiles,
    literalsScanned,
    findings: [...dedupeFindings(findings)].sort(compareFindings),
    diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
    compositeConsumers: ["security review route"],
    cacheContributors: [
      "source tree",
      "config.exclude_globs",
      "config.min_entropy",
      "config.min_secret_length",
      "config.top_n_diagnostics",
    ],
    calibrationSurface: "config.exclude_globs and entropy/length thresholds",
    enforcementCeiling: ["hard-gate", "review-route"],
  }
}

const SECRET_NAME_PATTERN = /(secret|token|apikey|api_key|password|passwd|privatekey|private_key|clientsecret|client_secret)/i
const KNOWN_SECRET_PREFIX = /^(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})/
const PLACEHOLDER_PATTERN = /^(?:changeme|example|placeholder|test|dummy|fake|mock|sample|todo|xxx|your[_-]?)/i

interface StringLiteralScanTarget {
  readonly value: string
  readonly index: number
}

const collectStringLiterals = (sourceFile: SourceFile): ReadonlyArray<StringLiteralScanTarget> => {
  const targets: Array<StringLiteralScanTarget> = []
  sourceFile.forEachDescendant((node) => {
    if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
      targets.push({ value: node.getLiteralText(), index: node.getStart() })
    }
  })
  return targets
}

const classifySecretLiteral = (
  identifier: string,
  value: string,
  config: TsSec03Config,
): SecretMaterialKind | undefined => {
  if (PLACEHOLDER_PATTERN.test(value)) return undefined
  if (value.includes("BEGIN") && value.includes("PRIVATE KEY")) return "private-key-block"
  if (KNOWN_SECRET_PREFIX.test(value)) return "known-secret-prefix"
  const entropy = shannonEntropy(value)
  const normalizedName = normalizeIdentifier(identifier)
  if (
    SECRET_NAME_PATTERN.test(normalizedName) &&
    value.length >= Math.max(8, config.min_secret_length / 2)
  ) {
    return "secret-named-literal"
  }
  if (
    value.length >= config.min_secret_length &&
    entropy >= config.min_entropy &&
    hasHighEntropySecretTokenShape(value)
  ) {
    return "high-entropy-literal"
  }
  return undefined
}

const hasHighEntropySecretTokenShape = (value: string): boolean => {
  if (!/^[A-Za-z0-9_+/=-]+$/.test(value)) return false
  if (value.startsWith("--")) return false
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) return false
  if (/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(value)) return false
  if (value.includes("/") && /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+$/.test(value)) {
    return false
  }

  const classes = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[_+/=-]/.test(value),
  ].filter(Boolean).length

  return classes >= 2 && (/[0-9]/.test(value) || /[_+/=-]/.test(value))
}

const nearbyIdentifier = (text: string, index: number): string => {
  const prefix = text.slice(Math.max(0, index - 80), index)
  const match = /([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/.exec(prefix) ??
    /([A-Za-z_$][\w$]*)\s*:\s*$/.exec(prefix)
  return match?.[1] ?? "literal"
}

const redactSecret = (value: string): string =>
  value.length <= 8 ? "<redacted>" : `${value.slice(0, 4)}...${value.slice(-4)}`

const round = (value: number): number => Math.round(value * 100) / 100

const dedupeFindings = (
  findings: ReadonlyArray<SecretMaterialFinding>,
): ReadonlyArray<SecretMaterialFinding> => {
  const seen = new Set<string>()
  return findings.filter((finding) => {
    const key = `${finding.file}:${finding.line}:${finding.column}:${finding.kind}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

const compareFindings = (
  left: SecretMaterialFinding,
  right: SecretMaterialFinding,
): number =>
  secretKindRank(left.kind) - secretKindRank(right.kind) ||
  left.file.localeCompare(right.file) ||
  left.line - right.line ||
  left.column - right.column

const secretKindRank = (kind: SecretMaterialKind): number => {
  switch (kind) {
    case "private-key-block":
      return 0
    case "known-secret-prefix":
      return 1
    case "secret-named-literal":
      return 2
    case "high-entropy-literal":
      return 3
  }
}
