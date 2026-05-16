import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Schema } from "effect"

export const DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY = "domain-construction" as const
export const CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH =
  ".pulsar/domain-construction.json" as const

const DomainConstructionEvidence = Schema.Struct({
  path: Schema.String,
  symbol: Schema.optional(Schema.String),
  note: Schema.optional(Schema.String),
})
type DomainConstructionEvidence = typeof DomainConstructionEvidence.Type

const DomainConstructionControl = Schema.Struct({
  intent: Schema.Literal("controlled", "intentionally_open"),
  reason: Schema.optional(Schema.String),
  smart_constructors: Schema.optional(Schema.Array(DomainConstructionEvidence)),
  parsers: Schema.optional(Schema.Array(DomainConstructionEvidence)),
  controlled_exports: Schema.optional(Schema.Array(DomainConstructionEvidence)),
  allow_public_constructor: Schema.optional(Schema.Boolean),
})
type DomainConstructionControl = typeof DomainConstructionControl.Type

const DomainConstructKind = Schema.Literal(
  "brand",
  "newtype",
  "value-object",
  "opaque-type",
  "wrapper",
  "domain-primitive",
)
type DomainConstructKind = typeof DomainConstructKind.Type

const DomainConstructionConstruct = Schema.Struct({
  id: Schema.String,
  symbol: Schema.String,
  kind: DomainConstructKind,
  declaration_path: Schema.String,
  source_hashes: Schema.optional(Schema.Record({ key: Schema.String, value: Schema.String })),
  control: DomainConstructionControl,
})
type DomainConstructionConstruct = typeof DomainConstructionConstruct.Type

export const DomainConstructionManifest = Schema.Struct({
  schema_version: Schema.Literal(1),
  constructs: Schema.Array(DomainConstructionConstruct),
})
export type DomainConstructionManifest = typeof DomainConstructionManifest.Type

export type DomainConstructionFactState =
  | "present"
  | "zero"
  | "not_configured"
  | "unknown"
  | "not_applicable"

export type DomainConstructionFindingKind =
  | "uncontrolled-constructor-export"
  | "missing-construction-evidence"
  | "stale-source"
  | "explicitly-open-construct"

export interface DomainConstructionFinding {
  readonly findingId: string
  readonly constructId: string
  readonly symbol: string
  readonly kind: DomainConstructionFindingKind
  readonly file: string
  readonly severity: "info" | "warn"
  readonly weight: number
  readonly evidence: ReadonlyArray<string>
}

export interface DomainConstructionEvidenceFact {
  readonly path: string
  readonly symbol?: string
  readonly present: boolean
  readonly hash?: string
  readonly matchedSymbol: boolean
}

export interface DomainConstructionConstructFact {
  readonly constructId: string
  readonly symbol: string
  readonly kind: DomainConstructKind
  readonly declarationPath: string
  readonly controlIntent: DomainConstructionControl["intent"]
  readonly reason?: string
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly expectedSourceHashes: Readonly<Record<string, string>>
  readonly exportedDeclarationDetected: boolean
  readonly publicConstructorDetected: boolean
  readonly privateConstructorDetected: boolean
  readonly allowPublicConstructor: boolean
  readonly smartConstructors: ReadonlyArray<DomainConstructionEvidenceFact>
  readonly parsers: ReadonlyArray<DomainConstructionEvidenceFact>
  readonly controlledExports: ReadonlyArray<DomainConstructionEvidenceFact>
}

export interface DomainConstructionFacts {
  readonly state: DomainConstructionFactState
  readonly sourcePath?: string
  readonly checkedPaths: ReadonlyArray<string>
  readonly constructs: ReadonlyArray<DomainConstructionConstructFact>
  readonly findings: ReadonlyArray<DomainConstructionFinding>
  readonly sourceFingerprint: string
  readonly message?: string
}

const FINDING_WEIGHT: Record<DomainConstructionFindingKind, number> = {
  "uncontrolled-constructor-export": 5,
  "missing-construction-evidence": 3,
  "stale-source": 4,
  "explicitly-open-construct": 0,
}

export const decodeDomainConstructionManifestSync =
  Schema.decodeUnknownSync(DomainConstructionManifest)

export const loadDomainConstructionFacts = async (
  repoRoot: string,
): Promise<DomainConstructionFacts> => {
  const checkedPaths = [CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH]
  const sourcePath = join(repoRoot, CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH)
  if (!existsSync(sourcePath)) return buildNotConfiguredDomainConstructionFacts(checkedPaths)

  try {
    const raw = await readFile(sourcePath, "utf8")
    const parsed = JSON.parse(raw) as unknown
    const manifest = decodeDomainConstructionManifestSync(parsed)
    return await collectDomainConstructionFacts(repoRoot, sourcePath, checkedPaths, manifest)
  } catch (cause) {
    return buildUnknownDomainConstructionFacts(
      checkedPaths,
      `Failed to load domain construction reference data: ${String(cause)}`,
      sourcePath,
    )
  }
}

export const buildNotConfiguredDomainConstructionFacts = (
  checkedPaths: ReadonlyArray<string>,
): DomainConstructionFacts => ({
  state: "not_configured",
  checkedPaths,
  constructs: [],
  findings: [],
  sourceFingerprint: fingerprint({ checkedPaths, state: "not_configured" }),
  message: "Domain construction reference data was not configured",
})

export const buildUnknownDomainConstructionFacts = (
  checkedPaths: ReadonlyArray<string>,
  message: string,
  sourcePath?: string,
): DomainConstructionFacts => ({
  state: "unknown",
  ...(sourcePath === undefined ? {} : { sourcePath }),
  checkedPaths,
  constructs: [],
  findings: [],
  sourceFingerprint: fingerprint({ checkedPaths, message, state: "unknown" }),
  message,
})

const collectDomainConstructionFacts = async (
  repoRoot: string,
  sourcePath: string,
  checkedPaths: ReadonlyArray<string>,
  manifest: DomainConstructionManifest,
): Promise<DomainConstructionFacts> => {
  const checkedPathSet = new Set(checkedPaths)
  const constructs: Array<DomainConstructionConstructFact> = []
  const findings: Array<DomainConstructionFinding> = []

  for (const construct of manifest.constructs) {
    const declarationPath = normalizePath(construct.declaration_path)
    checkedPathSet.add(declarationPath)
    const control = construct.control
    const smartConstructors = control.smart_constructors ?? []
    const parsers = control.parsers ?? []
    const controlledExports = control.controlled_exports ?? []
    for (const evidence of [...smartConstructors, ...parsers, ...controlledExports]) {
      checkedPathSet.add(normalizePath(evidence.path))
    }

    const allEvidencePaths = [
      declarationPath,
      ...smartConstructors.map((evidence) => evidence.path),
      ...parsers.map((evidence) => evidence.path),
      ...controlledExports.map((evidence) => evidence.path),
    ].map(normalizePath)
    const sourceHashes = await currentSourceHashes(repoRoot, allEvidencePaths)
    const expectedSourceHashes = normalizeHashRecord(construct.source_hashes ?? {})
    const declarationContent = await readSource(repoRoot, declarationPath)
    const declaredShape = declarationContent === undefined
      ? emptyDeclarationShape()
      : analyzeDeclarationShape(declarationContent, construct.symbol)
    const smartConstructorFacts = await collectEvidenceFacts(repoRoot, smartConstructors, sourceHashes)
    const parserFacts = await collectEvidenceFacts(repoRoot, parsers, sourceHashes)
    const controlledExportFacts = await collectEvidenceFacts(repoRoot, controlledExports, sourceHashes)
    const allowPublicConstructor = control.allow_public_constructor === true

    constructs.push({
      constructId: construct.id,
      symbol: construct.symbol,
      kind: construct.kind,
      declarationPath,
      controlIntent: control.intent,
      ...(control.reason === undefined ? {} : { reason: control.reason }),
      sourceHashes,
      expectedSourceHashes,
      exportedDeclarationDetected: declaredShape.exportedDeclarationDetected,
      publicConstructorDetected: declaredShape.publicConstructorDetected,
      privateConstructorDetected: declaredShape.privateConstructorDetected,
      allowPublicConstructor,
      smartConstructors: smartConstructorFacts,
      parsers: parserFacts,
      controlledExports: controlledExportFacts,
    })

    for (const [path, expectedHash] of Object.entries(expectedSourceHashes)) {
      const actualHash = sourceHashes[path]
      if (actualHash === undefined) {
        findings.push(makeFinding({
          constructId: construct.id,
          symbol: construct.symbol,
          kind: "stale-source",
          file: path,
          evidence: ["declared domain construction source is missing"],
        }))
      } else if (actualHash !== expectedHash) {
        findings.push(makeFinding({
          constructId: construct.id,
          symbol: construct.symbol,
          kind: "stale-source",
          file: path,
          evidence: [
            `expected source hash ${expectedHash}`,
            `current source hash ${actualHash}`,
          ],
        }))
      }
    }

    if (control.intent === "intentionally_open") {
      findings.push(makeFinding({
        constructId: construct.id,
        symbol: construct.symbol,
        kind: "explicitly-open-construct",
        file: declarationPath,
        evidence: [
          control.reason ?? "construct is declared intentionally open by repo policy",
        ],
      }))
      continue
    }

    if (declaredShape.publicConstructorDetected && !allowPublicConstructor) {
      findings.push(makeFinding({
        constructId: construct.id,
        symbol: construct.symbol,
        kind: "uncontrolled-constructor-export",
        file: declarationPath,
        evidence: [
          `${construct.symbol} appears to expose a public constructor from its declaration file`,
        ],
      }))
    }

    if (smartConstructors.length === 0 && parsers.length === 0) {
      findings.push(makeFinding({
        constructId: construct.id,
        symbol: construct.symbol,
        kind: "missing-construction-evidence",
        file: declarationPath,
        evidence: [
          "controlled construct declares no parser or smart-constructor evidence",
        ],
      }))
    }
    for (const evidence of [...smartConstructorFacts, ...parserFacts]) {
      if (!evidence.present) {
        findings.push(makeFinding({
          constructId: construct.id,
          symbol: construct.symbol,
          kind: "missing-construction-evidence",
          file: evidence.path,
          evidence: [
            "declared parser or smart-constructor evidence file is missing",
          ],
        }))
      } else if (!evidence.matchedSymbol) {
        findings.push(makeFinding({
          constructId: construct.id,
          symbol: construct.symbol,
          kind: "missing-construction-evidence",
          file: evidence.path,
          evidence: [
            `declared parser or smart-constructor symbol ${evidence.symbol ?? "<unspecified>"} was not found`,
          ],
        }))
      }
    }
  }

  findings.sort(compareFindings)
  const state =
    constructs.length === 0
      ? "not_applicable"
      : findings.length > 0
        ? "present"
        : "zero"
  const sortedCheckedPaths = [...checkedPathSet].sort()
  return {
    state,
    sourcePath,
    checkedPaths: sortedCheckedPaths,
    constructs,
    findings,
    sourceFingerprint: fingerprint({ constructs, findings, manifest, state }),
  }
}

const collectEvidenceFacts = async (
  repoRoot: string,
  evidence: ReadonlyArray<DomainConstructionEvidence>,
  sourceHashes: Readonly<Record<string, string>>,
): Promise<ReadonlyArray<DomainConstructionEvidenceFact>> =>
  Promise.all(
    evidence.map(async (item) => {
      const path = normalizePath(item.path)
      const content = await readSource(repoRoot, path)
      const matchedSymbol =
        item.symbol === undefined ||
        (content !== undefined && symbolPattern(item.symbol).test(content))
      return {
        path,
        ...(item.symbol === undefined ? {} : { symbol: item.symbol }),
        present: content !== undefined,
        ...(sourceHashes[path] === undefined ? {} : { hash: sourceHashes[path] }),
        matchedSymbol,
      }
    }),
  )

const currentSourceHashes = async (
  repoRoot: string,
  sourcePaths: ReadonlyArray<string>,
): Promise<Record<string, string>> => {
  const result: Record<string, string> = {}
  for (const sourcePath of unique(sourcePaths.map(normalizePath))) {
    const absolutePath = safeResolve(repoRoot, sourcePath)
    if (absolutePath === undefined || !existsSync(absolutePath)) continue
    result[sourcePath] = await fileHash(absolutePath)
  }
  return result
}

const readSource = async (
  repoRoot: string,
  path: string,
): Promise<string | undefined> => {
  const absolutePath = safeResolve(repoRoot, normalizePath(path))
  if (absolutePath === undefined || !existsSync(absolutePath)) return undefined
  return readFile(absolutePath, "utf8")
}

interface DeclarationShape {
  readonly exportedDeclarationDetected: boolean
  readonly publicConstructorDetected: boolean
  readonly privateConstructorDetected: boolean
}

const emptyDeclarationShape = (): DeclarationShape => ({
  exportedDeclarationDetected: false,
  publicConstructorDetected: false,
  privateConstructorDetected: false,
})

const analyzeDeclarationShape = (
  content: string,
  symbol: string,
): DeclarationShape => {
  const escaped = escapeRegExp(symbol)
  const exportedDeclarationDetected = new RegExp(
    `\\bexport\\s+(?:abstract\\s+)?(?:class|interface|type)\\s+${escaped}\\b`,
    "u",
  ).test(content)
  const classDeclarationDetected = new RegExp(
    `\\bexport\\s+(?:abstract\\s+)?class\\s+${escaped}\\b`,
    "u",
  ).test(content)
  const constructorDetected = /\bconstructor\s*\(/u.test(content)
  const privateConstructorDetected = /\b(?:private|protected)\s+constructor\s*\(/u.test(content)
  return {
    exportedDeclarationDetected,
    publicConstructorDetected:
      classDeclarationDetected && constructorDetected && !privateConstructorDetected,
    privateConstructorDetected,
  }
}

const makeFinding = (args: {
  readonly constructId: string
  readonly symbol: string
  readonly kind: DomainConstructionFindingKind
  readonly file: string
  readonly evidence: ReadonlyArray<string>
}): DomainConstructionFinding => ({
  findingId: `${args.constructId}:${args.kind}:${args.file}`,
  constructId: args.constructId,
  symbol: args.symbol,
  kind: args.kind,
  file: args.file,
  severity: args.kind === "explicitly-open-construct" ? "info" : "warn",
  weight: FINDING_WEIGHT[args.kind],
  evidence: args.evidence,
})

const normalizeHashRecord = (record: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record).map(([path, hash]) => [normalizePath(path), hash.toLowerCase()]),
  )

const safeResolve = (repoRoot: string, path: string): string | undefined => {
  const root = resolve(repoRoot)
  const resolved = resolve(root, path)
  const rel = relative(root, resolved)
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
    ? resolved
    : undefined
}

const fileHash = async (path: string): Promise<string> =>
  sha256(await readFile(path))

const sha256 = (content: string | Buffer): string =>
  createHash("sha256").update(content).digest("hex")

const fingerprint = (value: unknown): string =>
  sha256(stableStringify(value))

const stableStringify = (value: unknown): string =>
  JSON.stringify(sortJson(value))

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJson(nested)]),
    )
  }
  return value
}

const symbolPattern = (symbol: string): RegExp =>
  new RegExp(`\\b${escapeRegExp(symbol)}\\b`, "u")

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const normalizePath = (path: string): string => path.replace(/\\/gu, "/")

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)]

const compareFindings = (
  left: DomainConstructionFinding,
  right: DomainConstructionFinding,
): number => {
  const bySeverity = severityRank(right.severity) - severityRank(left.severity)
  if (bySeverity !== 0) return bySeverity
  const byWeight = right.weight - left.weight
  if (byWeight !== 0) return byWeight
  if (left.file !== right.file) return left.file.localeCompare(right.file)
  return left.kind.localeCompare(right.kind)
}

const severityRank = (severity: "info" | "warn"): number =>
  severity === "warn" ? 1 : 0
