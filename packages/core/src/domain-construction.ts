import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { isAbsolute, join, relative, resolve } from "node:path"
import { Schema } from "effect"
import { mapWithConcurrency } from "./concurrency.js"

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
  | "missing-source-provenance"
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
  "missing-source-provenance": 3,
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
    const collected = await collectDomainConstructionConstruct(repoRoot, construct)
    for (const path of collected.checkedPaths) checkedPathSet.add(path)
    constructs.push(collected.construct)
    findings.push(...collected.findings)
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

interface DomainConstructionConstructContext {
  readonly declarationPath: string
  readonly control: DomainConstructionControl
  readonly smartConstructors: ReadonlyArray<DomainConstructionEvidence>
  readonly parsers: ReadonlyArray<DomainConstructionEvidence>
  readonly controlledExports: ReadonlyArray<DomainConstructionEvidence>
  readonly expectedSourceHashes: Readonly<Record<string, string>>
  readonly expectedSourceHashPaths: ReadonlyArray<string>
  readonly declaredSourcePaths: ReadonlyArray<string>
  readonly allEvidencePaths: ReadonlyArray<string>
  readonly checkedPaths: ReadonlyArray<string>
  readonly allowPublicConstructor: boolean
}

interface CollectedDomainConstructionConstruct {
  readonly checkedPaths: ReadonlyArray<string>
  readonly construct: DomainConstructionConstructFact
  readonly findings: ReadonlyArray<DomainConstructionFinding>
}

const collectDomainConstructionConstruct = async (
  repoRoot: string,
  construct: DomainConstructionConstruct,
): Promise<CollectedDomainConstructionConstruct> => {
  const context = prepareDomainConstructionConstructContext(construct)
  const sourceHashes = await currentSourceHashes(repoRoot, context.allEvidencePaths)
  const declarationContent = await readSource(repoRoot, context.declarationPath)
  const declaredShape = analyzeDomainConstructDeclaration(declarationContent, construct.symbol)
  const smartConstructorFacts = await collectEvidenceFacts(
    repoRoot,
    context.smartConstructors,
    sourceHashes,
    "runtime-value",
  )
  const parserFacts = await collectEvidenceFacts(repoRoot, context.parsers, sourceHashes, "runtime-value")
  const controlledExportFacts = await collectEvidenceFacts(
    repoRoot,
    context.controlledExports,
    sourceHashes,
    "exported-value",
  )
  const findings = collectDomainConstructionFindings({
    construct,
    context,
    sourceHashes,
    declarationContent,
    declaredShape,
    smartConstructorFacts,
    parserFacts,
    controlledExportFacts,
  })
  return {
    checkedPaths: context.checkedPaths,
    construct: buildDomainConstructionConstructFact({
      construct,
      context,
      sourceHashes,
      declaredShape,
      smartConstructorFacts,
      parserFacts,
      controlledExportFacts,
    }),
    findings,
  }
}

const prepareDomainConstructionConstructContext = (
  construct: DomainConstructionConstruct,
): DomainConstructionConstructContext => {
  const declarationPath = normalizePath(construct.declaration_path)
  const control = construct.control
  const smartConstructors = control.smart_constructors ?? []
  const parsers = control.parsers ?? []
  const controlledExports = control.controlled_exports ?? []
  const expectedSourceHashes = normalizeHashRecord(construct.source_hashes ?? {})
  const expectedSourceHashPaths = Object.keys(expectedSourceHashes)
  const declaredSourcePaths = unique([
    declarationPath,
    ...smartConstructors.map((evidence) => evidence.path),
    ...parsers.map((evidence) => evidence.path),
    ...controlledExports.map((evidence) => evidence.path),
  ].map(normalizePath))
  const allEvidencePaths = unique([...declaredSourcePaths, ...expectedSourceHashPaths])
  return {
    declarationPath,
    control,
    smartConstructors,
    parsers,
    controlledExports,
    expectedSourceHashes,
    expectedSourceHashPaths,
    declaredSourcePaths,
    allEvidencePaths,
    checkedPaths: allEvidencePaths,
    allowPublicConstructor: control.allow_public_constructor === true,
  }
}

const analyzeDomainConstructDeclaration = (
  declarationContent: string | undefined,
  symbol: string,
): DeclarationShape => {
  if (declarationContent === undefined) return emptyDeclarationShape()
  return analyzeDeclarationShape(analyzeSourceSyntax(declarationContent), symbol)
}

interface DomainConstructionFindingContext {
  readonly construct: DomainConstructionConstruct
  readonly context: DomainConstructionConstructContext
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly declarationContent: string | undefined
  readonly declaredShape: DeclarationShape
  readonly smartConstructorFacts: ReadonlyArray<DomainConstructionEvidenceFact>
  readonly parserFacts: ReadonlyArray<DomainConstructionEvidenceFact>
  readonly controlledExportFacts: ReadonlyArray<DomainConstructionEvidenceFact>
}

const collectDomainConstructionFindings = (
  input: DomainConstructionFindingContext,
): ReadonlyArray<DomainConstructionFinding> => {
  const findings = [
    ...collectDomainConstructionProvenanceFindings(input),
    ...collectDomainConstructionDeclarationFindings(input),
  ]
  if (input.context.control.intent === "intentionally_open") {
    return [...findings, makeOpenConstructFinding(input.construct, input.context)]
  }
  return [
    ...findings,
    ...collectDomainConstructionControlFindings(input),
    ...collectDomainConstructionEvidenceFindings(input),
  ]
}

const buildDomainConstructionConstructFact = (
  input: Omit<DomainConstructionFindingContext, "declarationContent">,
): DomainConstructionConstructFact => ({
  constructId: input.construct.id,
  symbol: input.construct.symbol,
  kind: input.construct.kind,
  declarationPath: input.context.declarationPath,
  controlIntent: input.context.control.intent,
  ...(input.context.control.reason === undefined ? {} : { reason: input.context.control.reason }),
  sourceHashes: input.sourceHashes,
  expectedSourceHashes: input.context.expectedSourceHashes,
  exportedDeclarationDetected: input.declaredShape.exportedDeclarationDetected,
  publicConstructorDetected: input.declaredShape.publicConstructorDetected,
  privateConstructorDetected: input.declaredShape.privateConstructorDetected,
  allowPublicConstructor: input.context.allowPublicConstructor,
  smartConstructors: input.smartConstructorFacts,
  parsers: input.parserFacts,
  controlledExports: input.controlledExportFacts,
})

const collectDomainConstructionProvenanceFindings = (
  input: DomainConstructionFindingContext,
): ReadonlyArray<DomainConstructionFinding> => {
  const { construct, context, sourceHashes, declarationContent } = input
  const findings: Array<DomainConstructionFinding> = []
  const expectedSourceHashPathSet = new Set(context.expectedSourceHashPaths)
  const declaredSourcePathSet = new Set(context.declaredSourcePaths)

  for (const path of context.declaredSourcePaths.filter((item) => !expectedSourceHashPathSet.has(item))) {
    findings.push(makeFinding({
      constructId: construct.id,
      symbol: construct.symbol,
      kind: "missing-source-provenance",
      file: path,
      evidence: [`declared domain construction source ${path} has no recorded hash provenance`],
    }))
  }
  for (const path of context.expectedSourceHashPaths.filter((item) => !declaredSourcePathSet.has(item))) {
    findings.push(makeFinding({
      constructId: construct.id,
      symbol: construct.symbol,
      kind: "missing-source-provenance",
      file: path,
      evidence: [`recorded source hash ${path} is not declared as construction evidence`],
    }))
  }
  for (const [path, expectedHash] of Object.entries(context.expectedSourceHashes)) {
    const actualHash = sourceHashes[path]
    if (actualHash === undefined) {
      if (path === context.declarationPath && declarationContent === undefined) continue
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
        evidence: [`expected source hash ${expectedHash}`, `current source hash ${actualHash}`],
      }))
    }
  }
  return findings
}

const collectDomainConstructionDeclarationFindings = (
  input: DomainConstructionFindingContext,
): ReadonlyArray<DomainConstructionFinding> => {
  const { construct, context, declarationContent, declaredShape } = input
  if (declarationContent === undefined) {
    return [makeFinding({
      constructId: construct.id,
      symbol: construct.symbol,
      kind: "stale-source",
      file: context.declarationPath,
      evidence: ["declared domain construct declaration is missing"],
    })]
  }
  if (declaredShape.exportedDeclarationDetected) return []
  return [makeFinding({
    constructId: construct.id,
    symbol: construct.symbol,
    kind: "missing-construction-evidence",
    file: context.declarationPath,
    evidence: [`declared domain construct symbol ${construct.symbol} was not found`],
  })]
}

const makeOpenConstructFinding = (
  construct: DomainConstructionConstruct,
  context: DomainConstructionConstructContext,
): DomainConstructionFinding =>
  makeFinding({
    constructId: construct.id,
    symbol: construct.symbol,
    kind: "explicitly-open-construct",
    file: context.declarationPath,
    evidence: [context.control.reason ?? "construct is declared intentionally open by repo policy"],
  })

const collectDomainConstructionControlFindings = (
  input: DomainConstructionFindingContext,
): ReadonlyArray<DomainConstructionFinding> => {
  const { construct, context, declaredShape } = input
  const findings: Array<DomainConstructionFinding> = []
  if (declaredShape.publicConstructorDetected && !context.allowPublicConstructor) {
    findings.push(makeFinding({
      constructId: construct.id,
      symbol: construct.symbol,
      kind: "uncontrolled-constructor-export",
      file: context.declarationPath,
      evidence: [
        `${construct.symbol} appears to expose a public constructor from its declaration file`,
      ],
    }))
  }
  if (context.smartConstructors.length === 0 && context.parsers.length === 0) {
    findings.push(makeFinding({
      constructId: construct.id,
      symbol: construct.symbol,
      kind: "missing-construction-evidence",
      file: context.declarationPath,
      evidence: ["controlled construct declares no parser or smart-constructor evidence"],
    }))
  }
  return findings
}

const collectDomainConstructionEvidenceFindings = (
  input: DomainConstructionFindingContext,
): ReadonlyArray<DomainConstructionFinding> => [
  ...collectEvidenceMissingSymbolFindings(
    input.construct,
    [...input.smartConstructorFacts, ...input.parserFacts],
    "declared parser or smart-constructor",
  ),
  ...collectEvidenceMissingSymbolFindings(
    input.construct,
    input.controlledExportFacts,
    "declared controlled-export",
  ),
]

const collectEvidenceMissingSymbolFindings = (
  construct: DomainConstructionConstruct,
  facts: ReadonlyArray<DomainConstructionEvidenceFact>,
  label: string,
): ReadonlyArray<DomainConstructionFinding> =>
  facts.flatMap((evidence) => {
    if (!evidence.present) {
      return [makeFinding({
        constructId: construct.id,
        symbol: construct.symbol,
        kind: "missing-construction-evidence",
        file: evidence.path,
        evidence: [`${label} evidence file is missing`],
      })]
    }
    if (evidence.matchedSymbol) return []
    return [makeFinding({
      constructId: construct.id,
      symbol: construct.symbol,
      kind: "missing-construction-evidence",
      file: evidence.path,
      evidence: [`${label} symbol ${evidence.symbol ?? "<unspecified>"} was not found`],
    })]
  })

const collectEvidenceFacts = async (
  repoRoot: string,
  evidence: ReadonlyArray<DomainConstructionEvidence>,
  sourceHashes: Readonly<Record<string, string>>,
  symbolMode: EvidenceSymbolMode,
): Promise<ReadonlyArray<DomainConstructionEvidenceFact>> =>
  mapWithConcurrency(
    evidence,
    8,
    async (item) => {
      const path = normalizePath(item.path)
      const content = await readSource(repoRoot, path)
      const syntax = content === undefined ? undefined : analyzeSourceSyntax(content)
      const matchedSymbol =
        item.symbol === undefined ||
        (syntax !== undefined && matchesEvidenceSymbol(syntax, item.symbol, symbolMode))
      return {
        path,
        ...(item.symbol === undefined ? {} : { symbol: item.symbol }),
        present: content !== undefined,
        ...(sourceHashes[path] === undefined ? {} : { hash: sourceHashes[path] }),
        matchedSymbol,
      }
    },
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

type EvidenceSymbolMode = "runtime-value" | "exported-value"

const analyzeDeclarationShape = (
  syntax: SourceSyntax,
  symbol: string,
): DeclarationShape => {
  const exportedDeclarationDetected = hasExportedDeclaration(syntax, symbol)
  const classShape = exportedClassShape(syntax, symbol)
  const topLevelClassBody = classShape === undefined
    ? undefined
    : topLevelClassMemberText(classShape.body)
  const privateConstructorDetected =
    topLevelClassBody !== undefined &&
    /\b(?:private|protected)\s+constructor\s*\(/u.test(topLevelClassBody)
  return {
    exportedDeclarationDetected,
    publicConstructorDetected:
      classShape !== undefined && !classShape.isAbstract && !privateConstructorDetected,
    privateConstructorDetected,
  }
}

interface SourceSyntax {
  readonly code: string
}

const analyzeSourceSyntax = (content: string): SourceSyntax => ({
  code: maskAmbientBlocks(maskCommentsAndStrings(content)),
})

const hasExportedDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  return new RegExp(
    `\\bexport\\s+(?:default\\s+)?(?:abstract\\s+)?(?:class|interface|type)\\s+${escaped}\\b`,
    "u",
  ).test(syntax.code)
}

const matchesEvidenceSymbol = (
  syntax: SourceSyntax,
  symbol: string,
  mode: EvidenceSymbolMode,
): boolean =>
  mode === "exported-value"
    ? hasExportedValueDeclaration(syntax, symbol)
    : hasRuntimeValueDeclaration(syntax, symbol)

const hasRuntimeValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  const pattern = new RegExp(
    runtimeValueDeclarationPattern(escaped, "(?:export\\s+(?:default\\s+)?)?"),
    "gu",
  )
  for (const match of syntax.code.matchAll(pattern)) {
    if (!hasAmbientDeclarePrefix(syntax.code, match.index ?? 0)) return true
  }
  return false
}

const hasExportedValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean =>
  hasDirectExportedValueDeclaration(syntax, symbol) ||
  hasNamedExportedValueDeclaration(syntax, symbol)

const hasDirectExportedValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  return new RegExp(
    runtimeValueDeclarationPattern(escaped, "export\\s+(?:default\\s+)?"),
    "u",
  ).test(syntax.code)
}

const runtimeValueDeclarationPattern = (
  escapedSymbol: string,
  exportPrefixPattern: string,
): string =>
  [
    `\\b(?!declare\\s)${exportPrefixPattern}(?!declare\\s)(?:`,
    `(?:const|let|var|class|enum)\\s+${escapedSymbol}\\b`,
    "|",
    `(?:async\\s+)?function\\s*\\*?\\s+${escapedSymbol}\\b`,
    ")",
  ].join("")

const hasAmbientDeclarePrefix = (content: string, matchIndex: number): boolean =>
  /\bdeclare$/u.test(content.slice(0, matchIndex).trimEnd())

const hasNamedExportedValueDeclaration = (syntax: SourceSyntax, symbol: string): boolean => {
  const exportListPattern = /\bexport\s*\{([^}]*)\}/gu
  for (const match of syntax.code.matchAll(exportListPattern)) {
    const members = (match[1] ?? "").split(",")
    for (const member of members) {
      const parsed = parseExportMember(member)
      if (parsed === undefined) continue
      if (parsed.exported !== symbol && parsed.local !== symbol) continue
      if (hasRuntimeValueDeclaration(syntax, parsed.local)) return true
    }
  }
  return hasDefaultExportedLocalValue(syntax, symbol)
}

const parseExportMember = (
  member: string,
): { readonly local: string; readonly exported: string } | undefined => {
  const normalized = member.trim()
  if (/^type\s+/u.test(normalized)) return undefined
  const aliased = /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/u.exec(normalized)
  if (aliased !== null) return { local: aliased[1]!, exported: aliased[2]! }
  const direct = /^([A-Za-z_$][\w$]*)$/u.exec(normalized)
  if (direct !== null) return { local: direct[1]!, exported: direct[1]! }
  return undefined
}

const hasDefaultExportedLocalValue = (syntax: SourceSyntax, symbol: string): boolean => {
  const escaped = escapeRegExp(symbol)
  return new RegExp(`\\bexport\\s+default\\s+${escaped}\\b`, "u").test(syntax.code) &&
    hasRuntimeValueDeclaration(syntax, symbol)
}

interface ExportedClassShape {
  readonly body: string
  readonly isAbstract: boolean
}

const exportedClassShape = (
  syntax: SourceSyntax,
  symbol: string,
): ExportedClassShape | undefined => {
  const escaped = escapeRegExp(symbol)
  const pattern = new RegExp(
    `\\bexport\\s+(?:default\\s+)?(abstract\\s+)?class\\s+${escaped}\\b`,
    "u",
  )
  const match = pattern.exec(syntax.code)
  if (match === null) return undefined
  const openBrace = findClassBodyOpenBrace(syntax.code, match.index + match[0].length)
  if (openBrace === undefined) return undefined
  const closeBrace = matchingBraceIndex(syntax.code, openBrace)
  const body = closeBrace === undefined
    ? syntax.code.slice(openBrace + 1)
    : syntax.code.slice(openBrace + 1, closeBrace)
  return { body, isAbstract: match[1] !== undefined }
}

const findClassBodyOpenBrace = (
  content: string,
  start: number,
): number | undefined => {
  let angleDepth = 0
  let parenDepth = 0
  let bracketDepth = 0
  for (let index = start; index < content.length; index += 1) {
    const char = content[index]
    if (char === "<") {
      angleDepth += 1
      continue
    }
    if (char === ">" && angleDepth > 0) {
      angleDepth -= 1
      continue
    }
    if (angleDepth === 0) {
      if (char === "(") {
        parenDepth += 1
        continue
      }
      if (char === ")" && parenDepth > 0) {
        parenDepth -= 1
        continue
      }
      if (char === "[") {
        bracketDepth += 1
        continue
      }
      if (char === "]" && bracketDepth > 0) {
        bracketDepth -= 1
        continue
      }
      if (char === "{" && parenDepth === 0 && bracketDepth === 0) return index
    }
    if (char === ";" && angleDepth === 0 && parenDepth === 0 && bracketDepth === 0) {
      return undefined
    }
  }
  return undefined
}

const topLevelClassMemberText = (body: string): string => {
  let result = ""
  let braceDepth = 0
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index]
    if (char === "{") {
      result += " "
      braceDepth += 1
      continue
    }
    if (char === "}") {
      if (braceDepth > 0) braceDepth -= 1
      result += " "
      continue
    }
    result += braceDepth === 0 ? char : " "
  }
  return result
}

const matchingBraceIndex = (content: string, openBrace: number): number | undefined => {
  let depth = 0
  for (let index = openBrace; index < content.length; index += 1) {
    const char = content[index]
    if (char === "{") depth += 1
    if (char === "}") {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return undefined
}

const maskAmbientBlocks = (content: string): string => {
  const result = content.split("")
  const ambientBlockPattern = /\b(?:export\s+)?declare\s+(?:global|module|namespace)\b/gu
  for (const match of content.matchAll(ambientBlockPattern)) {
    const start = match.index ?? 0
    const openBrace = content.indexOf("{", start + match[0].length)
    if (openBrace === -1) continue
    const closeBrace = matchingBraceIndex(content, openBrace)
    const stop = closeBrace === undefined ? content.length : closeBrace + 1
    for (let index = start; index < stop; index += 1) result[index] = " "
  }
  return result.join("")
}

const maskCommentsAndStrings = (content: string): string => {
  let result = ""
  for (let index = 0; index < content.length;) {
    const char = content[index]
    const next = content[index + 1]
    if (char === "/" && next === "/") {
      const end = content.indexOf("\n", index + 2)
      const stop = end === -1 ? content.length : end
      result += " ".repeat(stop - index)
      index = stop
      continue
    }
    if (char === "/" && next === "*") {
      const end = content.indexOf("*/", index + 2)
      const stop = end === -1 ? content.length : end + 2
      result += " ".repeat(stop - index)
      index = stop
      continue
    }
    if (char === "\"" || char === "'" || char === "`") {
      const stop = quotedLiteralEnd(content, index, char)
      result += " ".repeat(stop - index)
      index = stop
      continue
    }
    if (char === "/" && isRegexLiteralStart(result)) {
      const stop = regexLiteralEnd(content, index)
      if (stop !== undefined) {
        result += " ".repeat(stop - index)
        index = stop
        continue
      }
    }
    result += char
    index += 1
  }
  return result
}

const quotedLiteralEnd = (content: string, start: number, quote: string): number => {
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index]
    if (char === "\\") {
      index += 1
      continue
    }
    if (char === quote) return index + 1
  }
  return content.length
}

const regexLiteralEnd = (content: string, start: number): number | undefined => {
  let inCharacterClass = false
  for (let index = start + 1; index < content.length; index += 1) {
    const char = content[index]
    if (char === "\n" || char === "\r") return undefined
    if (char === "\\") {
      index += 1
      continue
    }
    if (char === "[") {
      inCharacterClass = true
      continue
    }
    if (char === "]") {
      inCharacterClass = false
      continue
    }
    if (char === "/" && !inCharacterClass) {
      let stop = index + 1
      while (/[A-Za-z]/u.test(content[stop] ?? "")) stop += 1
      return stop
    }
  }
  return undefined
}

const isRegexLiteralStart = (maskedPrefix: string): boolean => {
  const trimmed = maskedPrefix.trimEnd()
  if (trimmed.length === 0) return true
  const previous = trimmed.at(-1)
  if (previous === undefined) return true
  if ("([{=,:;!&|?+-*%^~<>".includes(previous)) return true
  const match = /([A-Za-z_$][\w$]*)$/u.exec(trimmed)
  return match !== null && REGEX_PREFIX_KEYWORDS.has(match[1]!)
}

const REGEX_PREFIX_KEYWORDS = new Set([
  "case",
  "delete",
  "do",
  "else",
  "in",
  "instanceof",
  "of",
  "return",
  "throw",
  "typeof",
  "void",
  "yield",
])

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
