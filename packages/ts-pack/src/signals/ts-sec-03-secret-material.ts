import {
  SignalComputeError,
  computeDiagnosticHash,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsAnalysisTag } from "../ts-analysis.js"
import { ancestors, textOf, walkDescendants } from "../ast.js"
import {
  SyntaxKind,
  isArrayLiteralExpression,
  isBinaryExpression,
  isElementAccessExpression,
  isIndexedAccessTypeNode,
  isNewExpression,
  isNoSubstitutionTemplateLiteral,
  isPropertyAssignment,
  isPropertyDeclaration,
  isStringLiteral,
  isVariableDeclaration,
  type Node,
  type SourceFile,
} from "../tsgo-api.js"
import { isExcluded } from "./shared-globs.js"
import {
  PRODUCTION_EXCLUDE_GLOBS,
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

export type SecretFindingSeverity = "block" | "warn"

export type SecretEvidencePath = "proof" | "advisory"

export type SecretDetectorReason =
  | "private-key-header"
  | "published-token-format"
  | "secret-name-and-entropy"
  | "entropy-and-token-shape"

export type SecretFindingEnforcement = "hard-gate" | "review-routing"

export interface SecretScoreChannel {
  readonly findingCount: number
  readonly denominator: number
  readonly score: number
  readonly affectsSignalScore: boolean
  readonly enforcementCeiling: ReadonlyArray<SecretFindingEnforcement>
}

/**
 * Known-format detections (PEM blocks and provider token formats) are the only
 * block-severity path. Heuristic detections (secret-named and high-entropy
 * literals) can only warn: their evidence cannot prove the literal is a secret.
 */
export const secretFindingSeverity = (kind: SecretMaterialKind): SecretFindingSeverity =>
  kind === "private-key-block" || kind === "known-secret-prefix" ? "block" : "warn"

export const secretFindingEvidenceClass = (
  kind: SecretMaterialKind,
): "deterministic-ast" | "heuristic-pattern" =>
  kind === "private-key-block" || kind === "known-secret-prefix"
    ? "deterministic-ast"
    : "heuristic-pattern"

export const secretFindingEvidencePath = (kind: SecretMaterialKind): SecretEvidencePath =>
  secretFindingSeverity(kind) === "block" ? "proof" : "advisory"

export const secretFindingDetectorReason = (
  kind: SecretMaterialKind,
): SecretDetectorReason => {
  switch (kind) {
    case "private-key-block":
      return "private-key-header"
    case "known-secret-prefix":
      return "published-token-format"
    case "secret-named-literal":
      return "secret-name-and-entropy"
    case "high-entropy-literal":
      return "entropy-and-token-shape"
  }
}

export const secretFindingEnforcementCeiling = (
  kind: SecretMaterialKind,
): ReadonlyArray<SecretFindingEnforcement> =>
  secretFindingSeverity(kind) === "block" ? ["hard-gate"] : ["review-routing"]

export interface SecretMaterialFinding extends SourceLocation {
  readonly kind: SecretMaterialKind
  readonly identifier: string
  readonly redacted: string
  readonly entropy: number
  readonly evidenceClass: "deterministic-ast" | "heuristic-pattern"
  readonly evidencePath: SecretEvidencePath
  readonly detectorReason: SecretDetectorReason
  readonly enforcementCeiling: ReadonlyArray<SecretFindingEnforcement>
  readonly scoreDenominator: number
  readonly affectsSignalScore: boolean
}

export interface TsSec03Output {
  readonly state: "present" | "zero" | "not_applicable"
  readonly analyzedFiles: number
  readonly literalsScanned: number
  readonly findings: ReadonlyArray<SecretMaterialFinding>
  readonly scoreChannels: {
    readonly proof: SecretScoreChannel
    readonly advisory: SecretScoreChannel
  }
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

const PROOF_SCORE_DENOMINATOR = 5
const ADVISORY_SCORE_DENOMINATOR = 10
const ADVISORY_SCORE_FLOOR = 0.6

export const TsSec03: Signal<TsSec03Config, TsSec03Output, TsAnalysisTag> = {
  id: "TS-SEC-03-secret-material",
  title: "Secret material",
  aliases: ["TS-SEC-03"],
  tier: 1,
  category: "security-risk",
  kind: "structural",
  evidenceClass: "mixed",
  enforcement: ["hard-gate", "review-routing"],
  knownFailureModes: [
    {
      description: "Entropy and identifier-name heuristics can resemble secret material without proving it.",
      fixture: {
        file: "packages/ts-pack/src/__tests__/ts-sec-03.test.ts",
        testName: "heuristic-only findings keep the proof score clean and retain an advisory floor",
      },
    },
    {
      description: "Lookup keys, explicit fixture labels, and design tokens can cross naive entropy or name thresholds.",
      fixture: {
        file: "packages/ts-pack/src/__tests__/ts-sec-03.test.ts",
        testName: "Vellum lookup-key aliases and explicit fixture labels stay clean",
      },
    },
    {
      description: "Infrastructure resource names declare secret handles without embedding secret material.",
      fixture: {
        file: "packages/ts-pack/src/__tests__/ts-sec-03.test.ts",
        testName: "SST-style constructor labels stay clean without suppressing proof material",
      },
    },
  ],
  cacheVersion: "secret-material-v5-evidence-channel-denominators",
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
      const analysis = yield* TsAnalysisTag
      const fileOutputs = yield* analysis.mapFiles(async (context) =>
        analyzeSecretMaterial(context.sourceFile, context.file.path, config),
      ).pipe(Effect.mapError((cause) =>
        new SignalComputeError({
          signalId: "TS-SEC-03-secret-material",
          message: cause.message,
          cause,
        }),
      ))
      return mergeSecretMaterial(fileOutputs, config)
    }),
  score: (out) => (out.state === "present" ? out.scoreChannels.proof.score : 1),
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.findings.slice(0, out.diagnosticLimit).map((finding) => ({
      severity: secretFindingSeverity(finding.kind),
      evidenceClass: finding.evidenceClass,
      message:
        finding.evidencePath === "proof"
          ? `${finding.kind} proves committed secret material (${finding.redacted})`
          : `${finding.kind} is suspicious and needs secret-material review (${finding.redacted})`,
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
          finding.evidencePath === "proof"
            ? "Revoke this value, replace it with a configuration reference, and keep only test-safe placeholders in source."
            : "Review whether this suspicious literal is a credential before replacing or revoking anything.",
        confidence: finding.evidencePath === "proof" ? "high" : "medium",
        autoApplicable: false,
        data: { kind: finding.kind, identifier: finding.identifier },
      }],
    })),
  outputMetadata: (out) =>
    out.state === "not_applicable" ? { applicability: "not_applicable" as const } : undefined,
}

interface SecretFileAnalysis {
  readonly analyzed: boolean
  readonly literalsScanned: number
  readonly findings: ReadonlyArray<SecretMaterialFinding>
}

const analyzeSecretMaterial = (
  sourceFile: SourceFile,
  filePath: string,
  config: TsSec03Config,
): SecretFileAnalysis => {
  if (isExcluded(filePath, config.exclude_globs)) {
    return { analyzed: false, literalsScanned: 0, findings: [] }
  }
  const findings: Array<SecretMaterialFinding> = []
  let literalsScanned = 0
  for (const literal of collectStringLiterals(sourceFile)) {
    const value = literal.value.trim()
    if (value.length === 0) continue
    literalsScanned += 1
    const kind = classifySecretLiteral(literal.node, literal.identifier, value, config)
    if (kind === undefined) continue
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(literal.index)
    findings.push({
      file: filePath,
      line: line + 1,
      column: character + 1,
      kind,
      identifier: literal.identifier,
      redacted: redactSecret(value),
      entropy: round(shannonEntropy(value)),
      evidenceClass: secretFindingEvidenceClass(kind),
      evidencePath: secretFindingEvidencePath(kind),
      detectorReason: secretFindingDetectorReason(kind),
      enforcementCeiling: secretFindingEnforcementCeiling(kind),
      scoreDenominator:
        secretFindingEvidencePath(kind) === "proof"
          ? PROOF_SCORE_DENOMINATOR
          : ADVISORY_SCORE_DENOMINATOR,
      affectsSignalScore: secretFindingEvidencePath(kind) === "proof",
    })
  }
  return { analyzed: true, literalsScanned, findings }
}

const mergeSecretMaterial = (
  fileOutputs: ReadonlyArray<SecretFileAnalysis>,
  config: TsSec03Config,
): TsSec03Output => {
  const findings = fileOutputs.flatMap((output) => output.findings)
  const analyzedFiles = fileOutputs.filter((output) => output.analyzed).length
  const literalsScanned = fileOutputs.reduce((sum, output) => sum + output.literalsScanned, 0)
  const resolvedFindings = [...dedupeFindings(findings)].sort(compareFindings)
  return {
    state: analyzedFiles === 0 ? "not_applicable" : findings.length === 0 ? "zero" : "present",
    analyzedFiles,
    literalsScanned,
    findings: resolvedFindings,
    scoreChannels: secretScoreChannels(resolvedFindings),
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
    enforcementCeiling: ["hard-gate", "review-routing"],
  }
}

const SECRET_NAME_PATTERN = /(secret|token|apikey|api_key|password|passwd|privatekey|private_key|clientsecret|client_secret)/i
// Design-system vocabulary: "token" preceded by color/design/theme/style context
// names a design token, not a credential.
const DESIGN_TOKEN_CONTEXT_PATTERN = /(color|colour|design|theme|style|styling|brand)token/gi
const PLACEHOLDER_PATTERN = /^(?:changeme|example|placeholder|test|dummy|fake|mock|sample|todo|xxx|your[_-]?)/i

// Known secret formats are the only block-severity detections. Each pattern
// encodes a provider-published token format, not a statistical heuristic.
const PRIVATE_KEY_BLOCK_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/
const KNOWN_SECRET_FORMAT_PATTERNS: ReadonlyArray<RegExp> = [
  /\bAKIA[0-9A-Z]{16}(?![0-9A-Z])/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/,
  /\bxox[baprs]-[A-Za-z0-9][A-Za-z0-9-]{14,}/,
  /\bAIza[0-9A-Za-z_-]{35}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
]
const OPENAI_KEY_PATTERN = /(?:^|[^A-Za-z0-9])(sk-[A-Za-z0-9_-]{16,})/
// Rejects all-same-character documentation placeholders like ghp_xxxxxxxx...
const KNOWN_FORMAT_MIN_ENTROPY = 2.5
// A secret-shaped name is itself evidence, so the value needs less entropy
// evidence than anonymous literals: word-based passphrases (Shannon ~2.5-3.3)
// assigned to password/apiSecret identifiers must still fire. Identifier- and
// structure-shaped values are already excluded separately.
const SECRET_NAMED_MIN_ENTROPY = 2.5

// Checksum context: hash-named identifiers holding pure-hex values are
// checksums (git object ids, digests), not secrets. Matching is per word
// segment, not substring — "sha" inside "sharedSecret" is not checksum
// context — and secret-named identifiers take precedence over checksum
// context so `sharedSecret`/`hashedApiKey` stay eligible.
const CHECKSUM_NAME_SEGMENTS = new Set([
  "hash", "sha", "sha1", "sha256", "sha384", "sha512", "md5",
  "digest", "checksum", "crc", "crc32", "tree", "etag", "fingerprint",
])
const PURE_HEX_PATTERN = /^[0-9a-fA-F]{16,}$/

const identifierWordSegments = (identifier: string): ReadonlyArray<string> =>
  identifier
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((segment) => segment.toLowerCase())
    .filter((segment) => segment.length > 0)

const isChecksumName = (identifier: string): boolean =>
  identifierWordSegments(identifier).some((segment) => CHECKSUM_NAME_SEGMENTS.has(segment))

const IDENTIFIER_SHAPE_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const COMMAND_FLAG_PATTERN = /^--?[A-Za-z][A-Za-z0-9_-]*$/
const PATH_SHAPE_PATTERN = /^\/?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/
const KEY_VALUE_SETTING_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\/[A-Za-z_][A-Za-z0-9_]*)*=[^=]+$/
const SEPARATED_VALUE_PATTERN = /^[A-Za-z0-9]+(?:[-_][A-Za-z0-9]*)+$/
const WORD_CHUNK_PATTERNS: ReadonlyArray<RegExp> = [
  /^[0-9]{1,6}$/,
  /^[A-Za-z]+$/,
  /^[A-Za-z]+[0-9]{1,3}$/,
]
// Fused 8-digit YYYYMMDD dates appear in model ids ("claude-sonnet-4-20250514"),
// build stamps, and release tags: calendar vocabulary, not secret entropy.
// The date chunk only joins the anonymous-literal vocabulary — secret-named
// identifiers keep the stricter base vocabulary so an apiKey/token holding a
// date-bearing value stays eligible (secret-name precedence).
const FUSED_DATE_CHUNK_PATTERN = /^(?:19|20)[0-9]{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12][0-9]|3[01])$/
const ANONYMOUS_WORD_CHUNK_PATTERNS: ReadonlyArray<RegExp> = [
  ...WORD_CHUNK_PATTERNS,
  FUSED_DATE_CHUNK_PATTERN,
]

interface StringLiteralScanTarget {
  readonly value: string
  readonly index: number
  readonly identifier: string
  readonly node: Node
}

const collectStringLiterals = (sourceFile: SourceFile): ReadonlyArray<StringLiteralScanTarget> => {
  const targets: Array<StringLiteralScanTarget> = []
  walkDescendants(sourceFile, (node) => {
    if (isStringLiteral(node) || isNoSubstitutionTemplateLiteral(node)) {
      targets.push({
        value: node.text,
        index: node.getStart(sourceFile),
        identifier: enclosingBindingName(node),
        node,
      })
    }
  })
  return targets
}

/**
 * Attribute a literal to its nearest enclosing binding: the property name,
 * variable name, class property name, or assignment target that owns it.
 * Text-proximity attribution misreports unrelated identifiers (for example a
 * module specifier in a preceding import).
 */
const enclosingBindingName = (node: Node): string => {
  let current: Node | undefined = node.parent
  while (current !== undefined) {
    if (isPropertyAssignment(current) || isPropertyDeclaration(current) || isVariableDeclaration(current)) {
      return "name" in current && current.name !== undefined ? textOf(current.name) : "literal"
    }
    if (isBinaryExpression(current) && current.operatorToken.kind === SyntaxKind.EqualsToken) {
      const left = textOf(current.left)
      return left.split(".").pop() ?? left
    }
    current = current.parent
  }
  return "literal"
}

const classifySecretLiteral = (
  node: Node,
  identifier: string,
  value: string,
  config: TsSec03Config,
): SecretMaterialKind | undefined => {
  if (PLACEHOLDER_PATTERN.test(value)) return undefined
  if (PRIVATE_KEY_BLOCK_PATTERN.test(value)) return "private-key-block"
  if (matchesKnownSecretFormat(value)) return "known-secret-prefix"
  if (hasExplicitNonSecretSemanticRole(node, identifier, value)) return undefined
  const normalizedName = normalizeIdentifier(identifier)
  const secretNamed = isSecretName(normalizedName)
  if (!secretNamed && isChecksumName(identifier) && PURE_HEX_PATTERN.test(value)) return undefined
  const entropy = shannonEntropy(value)
  if (
    secretNamed &&
    value.length >= Math.max(8, config.min_secret_length / 2) &&
    entropy >= SECRET_NAMED_MIN_ENTROPY &&
    !isStructuredNonSecretShape(value)
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

const LOOKUP_COLLECTION_SEGMENTS = new Set([
  "alias",
  "aliases",
  "attribute",
  "attributes",
  "field",
  "fields",
  "key",
  "keys",
  "name",
  "names",
  "property",
  "properties",
])

const EXPLICIT_FIXTURE_SEGMENTS = new Set(["example", "fixture", "mock", "sample", "test"])
const ALL_CAPS_RESOURCE_LABEL_PATTERN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/
const EXPLICIT_REDACTION_MARKER_PATTERN = /^<redacted>$/i

/**
 * Exclude literals whose AST position proves they are labels rather than
 * credential values. Known secret formats are checked before this function,
 * so a provider token or private-key block cannot be suppressed by its role.
 */
const hasExplicitNonSecretSemanticRole = (
  node: Node,
  identifier: string,
  value: string,
): boolean =>
  isDirectLookupKey(node, value) ||
  isLookupKeyCollectionMember(node, identifier, value) ||
  isResourceDeclarationLabel(node, identifier, value) ||
  isExplicitFixtureLabel(value) ||
  EXPLICIT_REDACTION_MARKER_PATTERN.test(value)

const isDirectLookupKey = (node: Node, value: string): boolean => {
  const parent = node.parent
  if (!IDENTIFIER_SHAPE_PATTERN.test(value)) return false
  return (
    parent !== undefined &&
    isElementAccessExpression(parent) &&
    parent.argumentExpression === node
  ) || hasAncestor(node, isIndexedAccessTypeNode)
}

const isLookupKeyCollectionMember = (
  node: Node,
  identifier: string,
  value: string,
): boolean => {
  if (!IDENTIFIER_SHAPE_PATTERN.test(value)) return false
  if (!hasAncestor(node, isArrayLiteralExpression)) return false
  return identifierWordSegments(identifier)
    .some((segment) => LOOKUP_COLLECTION_SEGMENTS.has(segment))
}

const isResourceDeclarationLabel = (
  node: Node,
  identifier: string,
  value: string,
): boolean => {
  const parent = node.parent
  if (parent === undefined || !isNewExpression(parent)) return false
  if (parent.arguments[0] !== node) return false

  const normalizedValue = normalizeIdentifier(value)
  const normalizedBinding = normalizeIdentifier(identifier)
  return (
    normalizedBinding.length > 0 && normalizedValue === normalizedBinding
  ) || ALL_CAPS_RESOURCE_LABEL_PATTERN.test(value)
}

const isExplicitFixtureLabel = (value: string): boolean => {
  const segments = identifierWordSegments(value)
  return segments.length > 1 &&
    segments.some((segment) => EXPLICIT_FIXTURE_SEGMENTS.has(segment)) &&
    /^_*[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+_*$/u.test(value)
}

const hasAncestor = (
  node: Node,
  predicate: (candidate: Node) => boolean,
): boolean => {
  let current = node.parent
  while (current !== undefined) {
    if (predicate(current)) return true
    current = current.parent
  }
  return false
}

const matchesKnownSecretFormat = (value: string): boolean => {
  for (const pattern of KNOWN_SECRET_FORMAT_PATTERNS) {
    const matched = pattern.exec(value)?.[0]
    if (matched !== undefined && shannonEntropy(matched) >= KNOWN_FORMAT_MIN_ENTROPY) return true
  }
  // "sk-" also prefixes ordinary kebab-case words, so the OpenAI format only
  // applies when the literal is not a separated-words identifier.
  if (isSeparatedWordsValue(value)) return false
  const openAiKey = OPENAI_KEY_PATTERN.exec(value)?.[1]
  return openAiKey !== undefined && shannonEntropy(openAiKey) >= KNOWN_FORMAT_MIN_ENTROPY
}

const isSecretName = (normalizedIdentifier: string): boolean =>
  SECRET_NAME_PATTERN.test(normalizedIdentifier.replace(DESIGN_TOKEN_CONTEXT_PATTERN, ""))

/**
 * Identifier-shaped values built from dictionary-word chunks joined by `-` or
 * `_` (migration ids, mkdtemp prefixes with trailing separators, env var
 * names) are names, not secrets, even when raw entropy clears the threshold.
 */
const isSeparatedWordsValue = (
  value: string,
  chunkPatterns: ReadonlyArray<RegExp> = WORD_CHUNK_PATTERNS,
): boolean =>
  SEPARATED_VALUE_PATTERN.test(value) &&
  value
    .split(/[-_]/)
    .every((chunk) =>
      chunk.length === 0 || chunkPatterns.some((pattern) => pattern.test(chunk))
    )

const isStructuredNonSecretShape = (
  value: string,
  chunkPatterns: ReadonlyArray<RegExp> = WORD_CHUNK_PATTERNS,
): boolean =>
  value.startsWith("--") ||
  COMMAND_FLAG_PATTERN.test(value) ||
  PATH_SHAPE_PATTERN.test(value) ||
  KEY_VALUE_SETTING_PATTERN.test(value) ||
  isSeparatedWordsValue(value, chunkPatterns)

const hasHighEntropySecretTokenShape = (value: string): boolean => {
  if (!/^[A-Za-z0-9_+/=-]+$/.test(value)) return false
  if (IDENTIFIER_SHAPE_PATTERN.test(value)) return false
  if (isStructuredNonSecretShape(value, ANONYMOUS_WORD_CHUNK_PATTERNS)) return false

  const classes = [
    /[a-z]/.test(value),
    /[A-Z]/.test(value),
    /[0-9]/.test(value),
    /[_+/=-]/.test(value),
  ].filter(Boolean).length

  return classes >= 2 && (/[0-9]/.test(value) || /[_+/=-]/.test(value))
}

const redactSecret = (value: string): string =>
  value.length <= 8 ? "<redacted>" : `${value.slice(0, 4)}...${value.slice(-4)}`

const round = (value: number): number => Math.round(value * 100) / 100

const secretScoreChannels = (
  findings: ReadonlyArray<SecretMaterialFinding>,
): TsSec03Output["scoreChannels"] => {
  const proofCount = findings.filter((finding) => finding.evidencePath === "proof").length
  const advisoryCount = findings.length - proofCount
  return {
    proof: {
      findingCount: proofCount,
      denominator: PROOF_SCORE_DENOMINATOR,
      score: Math.max(0, 1 - proofCount / PROOF_SCORE_DENOMINATOR),
      affectsSignalScore: true,
      enforcementCeiling: ["hard-gate"],
    },
    advisory: {
      findingCount: advisoryCount,
      denominator: ADVISORY_SCORE_DENOMINATOR,
      score: Math.max(
        ADVISORY_SCORE_FLOOR,
        1 - advisoryCount / ADVISORY_SCORE_DENOMINATOR,
      ),
      affectsSignalScore: false,
      enforcementCeiling: ["review-routing"],
    },
  }
}

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
