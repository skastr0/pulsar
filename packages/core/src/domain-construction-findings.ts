import {
  FINDING_WEIGHT,
  type DomainConstructionConstruct,
  type DomainConstructionConstructFact,
  type DomainConstructionControl,
  type DomainConstructionEvidence,
  type DomainConstructionEvidenceFact,
  type DomainConstructionFinding,
  type DomainConstructionFindingKind,
} from "./domain-construction-model.js"
import type { DeclarationShape } from "./domain-construction-syntax.js"

export interface DomainConstructionConstructContext {
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

export const collectDomainConstructionFindings = (
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

export const buildDomainConstructionConstructFact = (
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
