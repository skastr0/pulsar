import type { CompositeExplanation } from "@skastr0/pulsar-core/signal"
import type { SharedChurn02Output } from "@skastr0/pulsar-core/shared-signals"
import type { Shared07MachineFeedbackCoverageOutput } from "./shared-07-machine-feedback-coverage.js"
import type { Shared09ContractFreshnessOutput } from "./shared-09-contract-freshness.js"
import type { Shared10DomainConstructionControlOutput } from "./shared-10-domain-construction-control.js"
import type { SharedCov01CoverageFactsOutput } from "./shared-cov-01-coverage-facts.js"

export type TheoryEncodingIndexState =
  | "present"
  | "zero"
  | "insufficient_evidence"

export type TheoryEncodingInputFactState =
  | "present"
  | "zero"
  | "absent"
  | "unknown"
  | "not_configured"
  | "not_applicable"
  | "missing_required"
  | "missing_optional"

export interface TheoryEncodingInputFactStates {
  readonly domainConstructionControl: TheoryEncodingInputFactState
  readonly contractFreshness: TheoryEncodingInputFactState
  readonly machineFeedbackCoverage: TheoryEncodingInputFactState
  readonly coverageFacts: TheoryEncodingInputFactState
  readonly boundaryParserCoverage: TheoryEncodingInputFactState
  readonly errorChannelOpacity: TheoryEncodingInputFactState
  readonly recencyWeightedChurn: TheoryEncodingInputFactState
}

export interface TheoryEncodingFactor {
  readonly id:
    | "domain-construction-control"
    | "contract-freshness"
    | "machine-feedback-coverage"
    | "coverage-facts"
    | "boundary-parser-coverage"
    | "error-channel-opacity"
    | "property-spec-presence"
    | "ai-churn-pressure"
  readonly label: string
  readonly state: TheoryEncodingInputFactState
  readonly weight: number
  readonly pressure?: number | undefined
  readonly contribution?: number | undefined
  readonly evidence: Readonly<Record<string, unknown>>
  readonly claimLimit: string
  readonly nonClaimLimit: string
}

export interface TheoryEncodingGap {
  readonly rank: number
  readonly factorId: TheoryEncodingFactor["id"]
  readonly label: string
  readonly pressure: number
  readonly contribution: number
  readonly state: TheoryEncodingInputFactState
  readonly evidence: Readonly<Record<string, unknown>>
}

export interface Shared11TheoryEncodingIndexOutput {
  readonly state: TheoryEncodingIndexState
  readonly factors: ReadonlyArray<TheoryEncodingFactor>
  readonly gaps: ReadonlyArray<TheoryEncodingGap>
  readonly explanation: CompositeExplanation
  readonly diagnosticLimit: number
  readonly inputFactStates: TheoryEncodingInputFactStates
  readonly requiredFoundationMeasured: boolean
  readonly availableFactorWeight: number
  readonly totalDeclaredFactorWeight: number
  readonly evidenceCompleteness: number
  readonly theoryGapPressure: number
  readonly theoryEncodingScore: number
  readonly warnThreshold: number
  readonly minAvailableFactorWeight: number
  readonly riskModel: "theory-encoding-index-v1"
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly evidenceClass: ReadonlyArray<string>
  readonly claimLimit: string
  readonly nonClaimLimit: string
  readonly knownFailureModes: ReadonlyArray<string>
  readonly enforcementCeiling: ReadonlyArray<string>
}

export interface BoundaryParserCoverageLikeOutput {
  readonly state:
    | "present"
    | "zero"
    | "absent"
    | "not_configured"
    | "not_applicable"
  readonly boundaryFilesMatched: number
  readonly weakBoundaryFunctions: number
  readonly coveredWeakBoundaryFunctions: number
  readonly findings: ReadonlyArray<unknown>
}

export interface ErrorChannelOpacityLikeOutput {
  readonly state: "present" | "zero" | "not_applicable"
  readonly topFindings?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly totalFindings: number
  readonly boundaryFindings: number
  readonly weightedOpacity: number
  readonly boundaryWeightedOpacity: number
  readonly densityPressure: number
  readonly boundaryPressure: number
}

export interface TheoryEncodingInputs {
  readonly domainConstructionControl?: Shared10DomainConstructionControlOutput | undefined
  readonly contractFreshness?: Shared09ContractFreshnessOutput | undefined
  readonly machineFeedbackCoverage?: Shared07MachineFeedbackCoverageOutput | undefined
  readonly coverageFacts?: SharedCov01CoverageFactsOutput | undefined
  readonly boundaryParserCoverage?: BoundaryParserCoverageLikeOutput | undefined
  readonly errorChannelOpacity?: ErrorChannelOpacityLikeOutput | undefined
  readonly recencyWeightedChurn?: SharedChurn02Output | undefined
}
