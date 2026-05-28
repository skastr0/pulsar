import type { Shared07MachineFeedbackCoverageOutput } from "./shared-07-machine-feedback-coverage.js"
import type { Shared09ContractFreshnessOutput } from "./shared-09-contract-freshness.js"
import type { Shared10DomainConstructionControlOutput } from "./shared-10-domain-construction-control.js"
import {
  FACTOR_WEIGHTS,
  normalizeBoundaryParserCoverage,
  normalizeContractFreshness,
  normalizeCoverageFacts,
  normalizeDomainConstructionControl,
  normalizeErrorChannelOpacity,
  normalizeMachineFeedbackCoverage,
  normalizeRecencyWeightedChurn,
  summarizeBoundaryParserCoverage,
  summarizeContractFreshness,
  summarizeCoverageFacts,
  summarizeDomainConstructionControl,
  summarizeErrorChannelOpacity,
  summarizeMachineFeedbackCoverage,
  summarizeRecencyWeightedChurn,
} from "./shared-11-theory-encoding-factors.js"
import type {
  BoundaryParserCoverageLikeOutput,
  ErrorChannelOpacityLikeOutput,
  TheoryEncodingInputs,
} from "./shared-11-theory-encoding-index.js"
import type { SharedCov01CoverageFactsOutput } from "./shared-cov-01-coverage-facts.js"

export const SHARED_11_COMPOSITE_INPUTS = [
  {
    id: "SHARED-10-domain-construction-control",
    aliases: ["SHARED-10"],
    factorPath: "inputs.domain_construction_control",
    weight: FACTOR_WEIGHTS.domainConstructionControl,
    cacheFingerprint: "shared-11-domain-construction-control-input-v1",
    rawValue: (value: unknown) =>
      summarizeDomainConstructionControl(
        value as Shared10DomainConstructionControlOutput,
      ),
    normalize: (value: unknown) =>
      normalizeDomainConstructionControl(
        value as Shared10DomainConstructionControlOutput,
      ),
  },
  {
    id: "SHARED-09-contract-freshness",
    aliases: ["SHARED-09"],
    factorPath: "inputs.contract_freshness",
    weight: FACTOR_WEIGHTS.contractFreshness,
    cacheFingerprint: "shared-11-contract-freshness-input-v1",
    rawValue: (value: unknown) =>
      summarizeContractFreshness(value as Shared09ContractFreshnessOutput),
    normalize: (value: unknown) =>
      normalizeContractFreshness(value as Shared09ContractFreshnessOutput),
  },
  {
    id: "SHARED-07-machine-feedback-coverage",
    aliases: ["SHARED-07"],
    optional: true,
    factorPath: "inputs.machine_feedback_coverage",
    weight: FACTOR_WEIGHTS.machineFeedbackCoverage,
    cacheFingerprint: "shared-11-machine-feedback-coverage-input-v1",
    rawValue: (value: unknown) =>
      summarizeMachineFeedbackCoverage(
        value as Shared07MachineFeedbackCoverageOutput,
      ),
    normalize: (value: unknown) =>
      normalizeMachineFeedbackCoverage(
        value as Shared07MachineFeedbackCoverageOutput,
      ),
  },
  {
    id: "SHARED-COV-01-coverage-facts",
    aliases: ["SHARED-COV-01"],
    optional: true,
    factorPath: "inputs.coverage_facts",
    weight: FACTOR_WEIGHTS.coverageFacts,
    cacheFingerprint: "shared-11-coverage-facts-input-v1",
    rawValue: (value: unknown) =>
      summarizeCoverageFacts(value as SharedCov01CoverageFactsOutput),
    normalize: (value: unknown) =>
      normalizeCoverageFacts(value as SharedCov01CoverageFactsOutput),
  },
  {
    id: "TS-AD-04-boundary-parser-coverage",
    aliases: ["TS-AD-04"],
    optional: true,
    factorPath: "inputs.boundary_parser_coverage",
    weight: FACTOR_WEIGHTS.boundaryParserCoverage,
    cacheFingerprint: "shared-11-boundary-parser-coverage-input-v1",
    rawValue: (value: unknown) =>
      summarizeBoundaryParserCoverage(value as BoundaryParserCoverageLikeOutput),
    normalize: (value: unknown) =>
      normalizeBoundaryParserCoverage(value as BoundaryParserCoverageLikeOutput),
  },
  {
    id: "TS-LD-09-error-channel-opacity",
    aliases: ["TS-LD-09"],
    optional: true,
    factorPath: "inputs.error_channel_opacity",
    weight: FACTOR_WEIGHTS.errorChannelOpacity,
    cacheFingerprint: "shared-11-error-channel-opacity-input-v1",
    rawValue: (value: unknown) =>
      summarizeErrorChannelOpacity(value as ErrorChannelOpacityLikeOutput),
    normalize: (value: unknown) =>
      normalizeErrorChannelOpacity(value as ErrorChannelOpacityLikeOutput),
  },
  {
    id: "SHARED-CHURN-02-recency-weighted-churn",
    aliases: ["SHARED-CHURN-02"],
    optional: true,
    factorPath: "inputs.recency_weighted_churn",
    weight: FACTOR_WEIGHTS.aiChurnPressure,
    cacheFingerprint: "shared-11-recency-weighted-churn-input-v1",
    rawValue: (value: unknown) =>
      summarizeRecencyWeightedChurn(
        value as NonNullable<TheoryEncodingInputs["recencyWeightedChurn"]>,
      ),
    normalize: (value: unknown) =>
      normalizeRecencyWeightedChurn(
        value as NonNullable<TheoryEncodingInputs["recencyWeightedChurn"]>,
      ),
  },
]
