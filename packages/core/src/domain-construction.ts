import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { Schema } from "effect"
import { mapWithConcurrency } from "./concurrency.js"
import {
  compareFindings,
  currentSourceHashes,
  fingerprint,
  normalizeHashRecord,
  normalizePath,
  readSource,
  unique,
} from "./domain-construction-io.js"
import {
  CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
  DomainConstructionManifest as DomainConstructionManifestSchema,
  type DomainConstructionConstruct,
  type DomainConstructionConstructFact,
  type DomainConstructionEvidence,
  type DomainConstructionEvidenceFact,
  type DomainConstructionFacts,
  type DomainConstructionFinding,
  type DomainConstructionManifest as DomainConstructionManifestData,
} from "./domain-construction-model.js"
import {
  buildDomainConstructionConstructFact,
  collectDomainConstructionFindings,
  type DomainConstructionConstructContext,
} from "./domain-construction-findings.js"
import {
  analyzeDomainConstructDeclaration,
  analyzeSourceSyntax,
  type EvidenceSymbolMode,
  matchesEvidenceSymbol,
} from "./domain-construction-syntax.js"

export {
  CANONICAL_DOMAIN_CONSTRUCTION_RELATIVE_PATH,
  DOMAIN_CONSTRUCTION_REFERENCE_DATA_KEY,
} from "./domain-construction-model.js"
export type {
  DomainConstructionConstructFact,
  DomainConstructionEvidenceFact,
  DomainConstructionFactState,
  DomainConstructionFacts,
  DomainConstructionFinding,
  DomainConstructionFindingKind,
} from "./domain-construction-model.js"

export const DomainConstructionManifest = DomainConstructionManifestSchema
export type DomainConstructionManifest = DomainConstructionManifestData

export const decodeDomainConstructionManifestSync =
  Schema.decodeUnknownSync(DomainConstructionManifestSchema)

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
  manifest: DomainConstructionManifestData,
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
