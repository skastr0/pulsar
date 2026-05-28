import type { SharedChurn02Output } from "@skastr0/pulsar-core/shared-signals"
import type { Shared07MachineFeedbackCoverageOutput } from "./shared-07-machine-feedback-coverage.js"
import type { Shared09ContractFreshnessOutput } from "./shared-09-contract-freshness.js"
import type { Shared10DomainConstructionControlOutput } from "./shared-10-domain-construction-control.js"
import type {
  BoundaryParserCoverageLikeOutput,
  ErrorChannelOpacityLikeOutput,
  TheoryEncodingFactor,
  TheoryEncodingInputFactState,
  TheoryEncodingInputFactStates,
  TheoryEncodingInputs,
} from "./shared-11-theory-encoding-index.js"
import type { SharedCov01CoverageFactsOutput } from "./shared-cov-01-coverage-facts.js"

export const FACTOR_WEIGHTS = {
  domainConstructionControl: 0.2,
  contractFreshness: 0.15,
  machineFeedbackCoverage: 0.14,
  coverageFacts: 0.1,
  boundaryParserCoverage: 0.14,
  errorChannelOpacity: 0.09,
  propertySpecPresence: 0.1,
  aiChurnPressure: 0.08,
} as const

type TheoryEncodingFactorDraft = Omit<TheoryEncodingFactor, "contribution">

interface PropertySpecEvidence {
  readonly state: TheoryEncodingInputFactState
  readonly pressure?: number | undefined
  readonly evidence: Readonly<Record<string, unknown>>
}

export const buildTheoryEncodingFactors = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): ReadonlyArray<TheoryEncodingFactor> =>
  addTheoryEncodingContributions(theoryEncodingFactorDrafts(states, inputs))

const theoryEncodingFactorDrafts = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): ReadonlyArray<TheoryEncodingFactorDraft> => [
  domainConstructionFactor(states, inputs),
  contractFreshnessFactor(states, inputs),
  machineFeedbackCoverageFactor(states, inputs),
  coverageFactsFactor(states, inputs),
  boundaryParserCoverageFactor(states, inputs),
  errorChannelOpacityFactor(states, inputs),
  propertySpecFactor(propertySpecEvidence(inputs)),
  aiChurnPressureFactor(states, inputs),
]

const addTheoryEncodingContributions = (
  drafts: ReadonlyArray<TheoryEncodingFactorDraft>,
): ReadonlyArray<TheoryEncodingFactor> => {
  const availableWeight = drafts.reduce(
    (total, factor) => total + (factor.pressure === undefined ? 0 : factor.weight),
    0,
  )
  return drafts.map((factor) => ({
    ...factor,
    ...(factor.pressure === undefined
      ? {}
      : { contribution: factor.pressure * factor.weight / Math.max(availableWeight, 1e-9) }),
  }))
}

const domainConstructionFactor = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingFactorDraft => ({
  id: "domain-construction-control",
  label: "Domain construction control",
  state: states.domainConstructionControl,
  weight: FACTOR_WEIGHTS.domainConstructionControl,
  pressure: normalizeDomainConstructionControl(inputs.domainConstructionControl),
  evidence: summarizeDomainConstructionControl(inputs.domainConstructionControl),
  claimLimit: "Declared domain constructs have current construction-control evidence.",
  nonClaimLimit: "Does not prove parser semantic completeness.",
})

const contractFreshnessFactor = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingFactorDraft => ({
  id: "contract-freshness",
  label: "Contract freshness",
  state: states.contractFreshness,
  weight: FACTOR_WEIGHTS.contractFreshness,
  pressure: normalizeContractFreshness(inputs.contractFreshness),
  evidence: summarizeContractFreshness(inputs.contractFreshness),
  claimLimit: "Declared generated artifacts are fresh against recorded hashes.",
  nonClaimLimit: "Does not prove generator or contract semantic correctness.",
})

const machineFeedbackCoverageFactor = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingFactorDraft => ({
  id: "machine-feedback-coverage",
  label: "Machine feedback coverage",
  state: states.machineFeedbackCoverage,
  weight: FACTOR_WEIGHTS.machineFeedbackCoverage,
  pressure: normalizeMachineFeedbackCoverage(inputs.machineFeedbackCoverage),
  evidence: summarizeMachineFeedbackCoverage(inputs.machineFeedbackCoverage),
  claimLimit:
    "Required build/typecheck/test/static-analysis feedback classes are discoverable locally or in CI.",
  nonClaimLimit: "Does not prove the feedback is exhaustive or meaningful.",
})

const coverageFactsFactor = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingFactorDraft => ({
  id: "coverage-facts",
  label: "Coverage facts",
  state: states.coverageFacts,
  weight: FACTOR_WEIGHTS.coverageFacts,
  pressure: normalizeCoverageFacts(inputs.coverageFacts),
  evidence: summarizeCoverageFacts(inputs.coverageFacts),
  claimLimit: "Loaded coverage reports expose measured statement/function/branch coverage.",
  nonClaimLimit: "Does not prove covered code has meaningful assertions.",
})

const boundaryParserCoverageFactor = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingFactorDraft => ({
  id: "boundary-parser-coverage",
  label: "Boundary parser coverage",
  state: states.boundaryParserCoverage,
  weight: FACTOR_WEIGHTS.boundaryParserCoverage,
  pressure: normalizeBoundaryParserCoverage(inputs.boundaryParserCoverage),
  evidence: summarizeBoundaryParserCoverage(inputs.boundaryParserCoverage),
  claimLimit: "Weak external-input boundaries have syntactic parser/decode evidence.",
  nonClaimLimit: "Does not prove parser semantics or authorization correctness.",
})

const errorChannelOpacityFactor = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingFactorDraft => ({
  id: "error-channel-opacity",
  label: "Error channel opacity",
  state: states.errorChannelOpacity,
  weight: FACTOR_WEIGHTS.errorChannelOpacity,
  pressure: normalizeErrorChannelOpacity(inputs.errorChannelOpacity),
  evidence: summarizeErrorChannelOpacity(inputs.errorChannelOpacity),
  claimLimit:
    "Expected failure channels are not hidden behind broad exceptions or collapsed typed errors.",
  nonClaimLimit: "Does not prove every possible failure is modeled.",
})

const propertySpecFactor = (
  propertySpec: PropertySpecEvidence,
): TheoryEncodingFactorDraft => ({
  id: "property-spec-presence",
  label: "Property/spec presence",
  state: propertySpec.state,
  weight: FACTOR_WEIGHTS.propertySpecPresence,
  pressure: propertySpec.pressure,
  evidence: propertySpec.evidence,
  claimLimit:
    "Declared theory surfaces have adjacent machine-checkable property, spec, contract, parser, or construction evidence identifiers.",
  nonClaimLimit:
    "Does not prove those properties are strong, complete, or semantically aligned with the domain.",
})

const aiChurnPressureFactor = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingFactorDraft => ({
  id: "ai-churn-pressure",
  label: "AI/churn pressure",
  state: states.recencyWeightedChurn,
  weight: FACTOR_WEIGHTS.aiChurnPressure,
  pressure: normalizeRecencyWeightedChurn(inputs.recencyWeightedChurn),
  evidence: summarizeRecencyWeightedChurn(inputs.recencyWeightedChurn),
  claimLimit:
    "Recency-weighted file churn identifies where generated-or-fast-moving code may be outrunning encoded theory.",
  nonClaimLimit:
    "Does not attribute churn to AI unless a separate committed AI fact source exists.",
})

export const weightedTheoryGapPressure = (
  factors: ReadonlyArray<TheoryEncodingFactor>,
  availableFactorWeight: number,
): number => {
  if (availableFactorWeight <= 0) return 0
  return clamp01(
    factors.reduce(
      (total, factor) => total + (factor.pressure ?? 0) * factor.weight,
      0,
    ) / availableFactorWeight,
  )
}

export const compareTheoryEncodingFactors = (
  left: TheoryEncodingFactor & { readonly contribution: number },
  right: TheoryEncodingFactor & { readonly contribution: number },
): number =>
  right.contribution - left.contribution ||
  right.pressure! - left.pressure! ||
  left.label.localeCompare(right.label)

export const summarizeDomainConstructionControl = (
  input: Shared10DomainConstructionControlOutput | undefined,
): Readonly<Record<string, unknown>> =>
  input === undefined
    ? { state: "missing_optional" }
    : {
        state: input.state,
        configuredConstructCount: input.configuredConstructCount,
        controlledConstructCount: input.controlledConstructCount,
        explicitlyOpenConstructCount: input.explicitlyOpenConstructCount,
        totalFindings: input.totalFindings,
        weightedFindings: input.weightedFindings,
        scorePressure: input.scorePressure,
        checkedPaths: input.checkedPaths,
        constructs: input.constructs.slice(0, 8).map((construct) => ({
          constructId: construct.constructId,
          symbol: construct.symbol,
          declarationPath: construct.declarationPath,
          controlIntent: construct.controlIntent,
          evidencePaths: uniqueStrings([
            ...construct.smartConstructors.map((evidence) => evidence.path),
            ...construct.parsers.map((evidence) => evidence.path),
            ...construct.controlledExports.map((evidence) => evidence.path),
          ]),
        })),
        topFindings: input.topFindings.slice(0, 8).map((finding) => ({
          findingId: finding.findingId,
          constructId: finding.constructId,
          symbol: finding.symbol,
          kind: finding.kind,
          file: finding.file,
        })),
      }

export const normalizeDomainConstructionControl = (
  input: Shared10DomainConstructionControlOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state !== "present" && input.state !== "zero") return undefined
  return clamp01(input.scorePressure)
}

export const summarizeContractFreshness = (
  input: Shared09ContractFreshnessOutput | undefined,
): Readonly<Record<string, unknown>> =>
  input === undefined
    ? { state: "missing_optional" }
    : {
        state: input.state,
        configuredContractCount: input.configuredContractCount,
        sourceFileCount: input.sourceFileCount,
        artifactFileCount: input.artifactFileCount,
        totalFindings: input.totalFindings,
        weightedFindings: input.weightedFindings,
        scorePressure: input.scorePressure,
        checkedPaths: input.checkedPaths,
        contracts: input.contracts.slice(0, 8).map((contract) => ({
          contractId: contract.contractId,
          groupId: contract.groupId,
          artifactPath: contract.artifactPath,
          sourcePaths: contract.sourcePaths,
        })),
        topFindings: input.topFindings.slice(0, 8).map((finding) => ({
          findingId: finding.findingId,
          contractId: finding.contractId,
          groupId: finding.groupId,
          kind: finding.kind,
          file: finding.file,
          sourceFile: finding.sourceFile,
          artifactFile: finding.artifactFile,
        })),
      }

export const normalizeContractFreshness = (
  input: Shared09ContractFreshnessOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state !== "present" && input.state !== "zero") return undefined
  return clamp01(input.scorePressure)
}

export const summarizeMachineFeedbackCoverage = (
  input: Shared07MachineFeedbackCoverageOutput | undefined,
): Readonly<Record<string, unknown>> =>
  input === undefined
    ? { state: "missing_optional" }
    : {
        state: input.state,
        requiredClasses: input.requiredClasses,
        configuredClassCount: input.configuredClassCount,
        ciReachableClassCount: input.ciReachableClassCount,
        missingClassCount: input.missingClassCount,
        unknownClassCount: input.unknownClassCount,
        classes: input.classes.map((entry) => ({
          class: entry.class,
          state: entry.state,
          localCommands: entry.localCommands,
          ciReachable: entry.ciReachable,
          evidence: entry.evidence.slice(0, 4).map((evidence) => ({
            kind: evidence.kind,
            path: evidence.path,
            command: evidence.command,
          })),
        })),
      }

export const normalizeMachineFeedbackCoverage = (
  input: Shared07MachineFeedbackCoverageOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state === "unknown") return undefined
  const requiredClassCount = input.requiredClasses.length
  if (requiredClassCount === 0) return 0
  return clamp01(
    (input.missingClassCount + input.unknownClassCount * 0.5) /
      requiredClassCount,
  )
}

export const summarizeCoverageFacts = (
  input: SharedCov01CoverageFactsOutput | undefined,
): Readonly<Record<string, unknown>> =>
  input === undefined
    ? { state: "missing_optional" }
    : {
        state: input.state,
        files: input.files.length,
        lineCoverage: input.summary.lines.pct,
        functionCoverage: input.summary.functions.pct,
        branchCoverage: input.summary.branches.pct,
        sourcePath: input.sourcePath,
        checkedPaths: input.checkedPaths,
        lowestCoverageFiles: input.files
          .slice()
          .sort((left, right) =>
            coverageFileScore(left) - coverageFileScore(right) ||
            left.file.localeCompare(right.file)
          )
          .slice(0, 8)
          .map((file) => ({
            file: file.file,
            lines: file.lines.pct,
            functions: file.functions.pct,
            branches: file.branches.pct,
          })),
        specLikeFiles: specLikeFiles(input.files.map((file) => file.file)).slice(0, 8),
      }

export const normalizeCoverageFacts = (
  input: SharedCov01CoverageFactsOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state !== "present" && input.state !== "zero") return undefined
  const metrics = [
    input.summary.lines,
    input.summary.functions,
    input.summary.branches,
  ].filter((metric) => metric.total > 0)
  if (metrics.length === 0) return undefined
  return clamp01(
    metrics.reduce((total, metric) => total + (1 - metric.pct), 0) /
      metrics.length,
  )
}

export const summarizeBoundaryParserCoverage = (
  input: BoundaryParserCoverageLikeOutput | undefined,
): Readonly<Record<string, unknown>> =>
  input === undefined
    ? { state: "missing_optional" }
    : {
        state: input.state,
        boundaryFilesMatched: input.boundaryFilesMatched,
        weakBoundaryFunctions: input.weakBoundaryFunctions,
        coveredWeakBoundaryFunctions: input.coveredWeakBoundaryFunctions,
        findings: input.findings.length,
        topFindings: input.findings.slice(0, 8).map(actionableRecord),
      }

export const normalizeBoundaryParserCoverage = (
  input: BoundaryParserCoverageLikeOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state === "absent" || input.state === "not_configured") return undefined
  if (input.weakBoundaryFunctions === 0) return 0
  return clamp01(input.findings.length / input.weakBoundaryFunctions)
}

export const summarizeErrorChannelOpacity = (
  input: ErrorChannelOpacityLikeOutput | undefined,
): Readonly<Record<string, unknown>> =>
  input === undefined
    ? { state: "missing_optional" }
    : {
        state: input.state,
        totalFindings: input.totalFindings,
        boundaryFindings: input.boundaryFindings,
        weightedOpacity: input.weightedOpacity,
        boundaryWeightedOpacity: input.boundaryWeightedOpacity,
        densityPressure: input.densityPressure,
        boundaryPressure: input.boundaryPressure,
        topFindings: (input.topFindings ?? []).slice(0, 8).map(actionableRecord),
      }

export const normalizeErrorChannelOpacity = (
  input: ErrorChannelOpacityLikeOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state === "not_applicable") return undefined
  return clamp01(Math.max(input.densityPressure, input.boundaryPressure))
}

const propertySpecEvidence = (
  inputs: TheoryEncodingInputs,
): PropertySpecEvidence => {
  const measurable =
    isMeasuredState(inputs.domainConstructionControl?.state) ||
    isMeasuredState(inputs.contractFreshness?.state) ||
    isMeasuredState(inputs.coverageFacts?.state)
  if (!measurable) {
    return {
      state: "missing_optional",
      evidence: { state: "missing_optional" },
    }
  }

  const constructionEvidence = (inputs.domainConstructionControl?.constructs ?? [])
    .flatMap((construct) => [
      ...construct.smartConstructors,
      ...construct.parsers,
      ...construct.controlledExports,
    ])
    .filter((evidence) => evidence.present && evidence.matchedSymbol)
    .map((evidence) => ({
      path: evidence.path,
      symbol: evidence.symbol,
    }))
  const contractContext = (inputs.contractFreshness?.contracts ?? []).map((contract) => ({
    contractId: contract.contractId,
    groupId: contract.groupId,
    artifactPath: contract.artifactPath,
    sourcePaths: contract.sourcePaths,
  }))
  const specFiles = specLikeFiles(inputs.coverageFacts?.files.map((file) => file.file) ?? [])
  const declaredTheorySurfaces = inputs.domainConstructionControl?.constructs.length ?? 0
  const coverageFileCount = inputs.coverageFacts?.files.length ?? 0
  if (declaredTheorySurfaces === 0) {
    return {
      state: "missing_optional",
      evidence: {
        state: "missing_optional",
        declaredTheorySurfaces,
        coverageFileCount,
        contractContext: contractContext.slice(0, 8),
        specLikeFiles: specFiles.slice(0, 8),
      },
    }
  }
  const expectedEvidence = declaredTheorySurfaces
  const evidenceCount = Math.min(
    expectedEvidence,
    constructionEvidence.length + specFiles.length,
  )
  const pressure = expectedEvidence === 0
    ? 0
    : clamp01(1 - Math.min(1, evidenceCount / expectedEvidence))
  return {
    state: pressure === 0 ? "zero" : "present",
    pressure,
    evidence: {
      state: pressure === 0 ? "zero" : "present",
      declaredTheorySurfaces,
      coverageFileCount,
      evidenceCount,
      constructionEvidence: constructionEvidence.slice(0, 8),
      contractContext: contractContext.slice(0, 8),
      specLikeFiles: specFiles.slice(0, 8),
      checkedCoveragePaths: inputs.coverageFacts?.checkedPaths ?? [],
    },
  }
}

const isMeasuredState = (
  state: { readonly toString: () => string } | string | undefined,
): boolean => state === "present" || state === "zero"

export const summarizeRecencyWeightedChurn = (
  input: SharedChurn02Output | undefined,
): Readonly<Record<string, unknown>> =>
  input === undefined
    ? { state: "missing_optional" }
    : {
        state: recencyWeightedChurnState(input),
        totalCommits: input.totalCommits,
        sampled: input.sampled,
        windowDays: input.windowDays,
        halfLifeDays: input.halfLifeDays,
        topChurnFiles: topWeightedChurnFiles(input),
      }

export const normalizeRecencyWeightedChurn = (
  input: SharedChurn02Output | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.byFile.size === 0) return undefined
  const topWeightedChurn = topWeightedChurnFiles(input)[0]?.weightedChurn ?? 0
  return clamp01(topWeightedChurn / 5)
}

export const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

const recencyWeightedChurnState = (
  input: SharedChurn02Output,
): TheoryEncodingInputFactState =>
  input.byFile.size === 0 ? "absent" : "present"

const topWeightedChurnFiles = (
  input: SharedChurn02Output,
): ReadonlyArray<{
  readonly file: string
  readonly touchCount: number
  readonly rawWindowChurn: number
  readonly weightedChurn: number
  readonly lastTouchedAt: string
}> =>
  [...input.byFile.entries()]
    .sort((left, right) =>
      right[1].weightedChurn - left[1].weightedChurn ||
      right[1].rawWindowChurn - left[1].rawWindowChurn ||
      left[0].localeCompare(right[0])
    )
    .slice(0, 8)
    .map(([file, churn]) => ({
      file,
      touchCount: churn.touchCount,
      rawWindowChurn: churn.rawWindowChurn,
      weightedChurn: churn.weightedChurn,
      lastTouchedAt: churn.lastTouchedAt,
    }))

const coverageFileScore = (file: {
  readonly lines: { readonly pct: number }
  readonly functions: { readonly pct: number }
  readonly branches: { readonly pct: number }
}): number => (file.lines.pct + file.functions.pct + file.branches.pct) / 3

const specLikeFiles = (files: ReadonlyArray<string>): ReadonlyArray<string> =>
  uniqueStrings(
    files.filter((file) =>
      /(?:^|[/._-])(?:test|tests|spec|specs|property|properties|prop|check)(?:[/._-]|$)/iu
        .test(file)
    ),
  )

const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(values)].sort()

const actionableRecord = (value: unknown): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null) return {}
  const record = value as Readonly<Record<string, unknown>>
  return Object.fromEntries(
    [
      "findingId",
      "file",
      "line",
      "symbol",
      "kind",
      "boundary",
      "missingEvidence",
      "expressionText",
      "returnTypeText",
    ]
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]]),
  )
}
