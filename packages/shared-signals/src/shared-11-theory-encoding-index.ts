import {
  buildCompositeExplanation,
  compositeSignalInputs,
  resolveCompositeInputs,
  type CompositeExplanation,
  type CompositeInputResolution,
  type CompositeInputSpec,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import type { SharedChurn02Output } from "@skastr0/pulsar-core/shared-signals"
import { Effect, Schema } from "effect"
import type { Shared07MachineFeedbackCoverageOutput } from "./shared-07-machine-feedback-coverage.js"
import type { Shared09ContractFreshnessOutput } from "./shared-09-contract-freshness.js"
import type { Shared10DomainConstructionControlOutput } from "./shared-10-domain-construction-control.js"
import {
  buildTheoryEncodingFactors,
  clamp01,
  compareTheoryEncodingFactors,
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
  weightedTheoryGapPressure,
} from "./shared-11-theory-encoding-factors.js"
import type { SharedCov01CoverageFactsOutput } from "./shared-cov-01-coverage-facts.js"

export const Shared11TheoryEncodingIndexConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
  warn_threshold: Schema.Number,
  min_available_factor_weight: Schema.Number,
})
export type Shared11TheoryEncodingIndexConfig =
  typeof Shared11TheoryEncodingIndexConfig.Type

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

interface TheoryEncodingMeasurement {
  readonly factors: ReadonlyArray<TheoryEncodingFactor>
  readonly availableFactorWeight: number
  readonly totalDeclaredFactorWeight: number
  readonly evidenceCompleteness: number
  readonly requiredFoundationMeasured: boolean
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

const THEORY_ENCODING_ENFORCEMENT_CEILING = [
  "trend",
  "review-routing",
  "dashboard",
] as const

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const DEFAULT_WARN_THRESHOLD = 0.35
const DEFAULT_MIN_AVAILABLE_FACTOR_WEIGHT = 0.25

export const SHARED_11_COMPOSITE_INPUTS = [
  {
    id: "SHARED-10-domain-construction-control",
    aliases: ["SHARED-10"],
    factorPath: "inputs.domain_construction_control",
    weight: FACTOR_WEIGHTS.domainConstructionControl,
    cacheFingerprint: "shared-11-domain-construction-control-input-v1",
    rawValue: (value) =>
      summarizeDomainConstructionControl(
        value as Shared10DomainConstructionControlOutput,
      ),
    normalize: (value) =>
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
    rawValue: (value) =>
      summarizeContractFreshness(value as Shared09ContractFreshnessOutput),
    normalize: (value) =>
      normalizeContractFreshness(value as Shared09ContractFreshnessOutput),
  },
  {
    id: "SHARED-07-machine-feedback-coverage",
    aliases: ["SHARED-07"],
    optional: true,
    factorPath: "inputs.machine_feedback_coverage",
    weight: FACTOR_WEIGHTS.machineFeedbackCoverage,
    cacheFingerprint: "shared-11-machine-feedback-coverage-input-v1",
    rawValue: (value) =>
      summarizeMachineFeedbackCoverage(
        value as Shared07MachineFeedbackCoverageOutput,
      ),
    normalize: (value) =>
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
    rawValue: (value) =>
      summarizeCoverageFacts(value as SharedCov01CoverageFactsOutput),
    normalize: (value) =>
      normalizeCoverageFacts(value as SharedCov01CoverageFactsOutput),
  },
  {
    id: "TS-AD-04-boundary-parser-coverage",
    aliases: ["TS-AD-04"],
    optional: true,
    factorPath: "inputs.boundary_parser_coverage",
    weight: FACTOR_WEIGHTS.boundaryParserCoverage,
    cacheFingerprint: "shared-11-boundary-parser-coverage-input-v1",
    rawValue: (value) =>
      summarizeBoundaryParserCoverage(value as BoundaryParserCoverageLikeOutput),
    normalize: (value) =>
      normalizeBoundaryParserCoverage(value as BoundaryParserCoverageLikeOutput),
  },
  {
    id: "TS-LD-09-error-channel-opacity",
    aliases: ["TS-LD-09"],
    optional: true,
    factorPath: "inputs.error_channel_opacity",
    weight: FACTOR_WEIGHTS.errorChannelOpacity,
    cacheFingerprint: "shared-11-error-channel-opacity-input-v1",
    rawValue: (value) =>
      summarizeErrorChannelOpacity(value as ErrorChannelOpacityLikeOutput),
    normalize: (value) =>
      normalizeErrorChannelOpacity(value as ErrorChannelOpacityLikeOutput),
  },
  {
    id: "SHARED-CHURN-02-recency-weighted-churn",
    aliases: ["SHARED-CHURN-02"],
    optional: true,
    factorPath: "inputs.recency_weighted_churn",
    weight: FACTOR_WEIGHTS.aiChurnPressure,
    cacheFingerprint: "shared-11-recency-weighted-churn-input-v1",
    rawValue: (value) =>
      summarizeRecencyWeightedChurn(value as SharedChurn02Output),
    normalize: (value) =>
      normalizeRecencyWeightedChurn(value as SharedChurn02Output),
  },
] satisfies ReadonlyArray<CompositeInputSpec>

export const Shared11TheoryEncodingIndex: Signal<
  Shared11TheoryEncodingIndexConfig,
  Shared11TheoryEncodingIndexOutput,
  never
> = {
  id: "SHARED-11-theory-encoding-index",
  title: "Theory encoding index",
  aliases: ["SHARED-11"],
  tier: 1.5,
  category: "architectural-drift",
  kind: "compound",
  cacheVersion: "theory-encoding-index-composite-v4-grounded-optionals",
  configSchema: Shared11TheoryEncodingIndexConfig,
  defaultConfig: {
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
    warn_threshold: DEFAULT_WARN_THRESHOLD,
    min_available_factor_weight: DEFAULT_MIN_AVAILABLE_FACTOR_WEIGHT,
  },
  configDirections: {
    top_n_diagnostics: "higher-is-looser",
    warn_threshold: "higher-is-looser",
    min_available_factor_weight: "higher-is-stricter",
  },
  factorDefinitions: [
    {
      path: "config.top_n_diagnostics",
      title: "Config top n diagnostics",
      valueKind: "number",
      scoreRole: "threshold",
      defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
    },
    {
      path: "config.warn_threshold",
      title: "Config warn threshold",
      valueKind: "number",
      scoreRole: "threshold",
      defaultValue: DEFAULT_WARN_THRESHOLD,
    },
    {
      path: "config.min_available_factor_weight",
      title: "Config min available factor weight",
      valueKind: "number",
      scoreRole: "threshold",
      defaultValue: DEFAULT_MIN_AVAILABLE_FACTOR_WEIGHT,
    },
  ],
  factorLedger: () => ({
    signalId: "SHARED-11-theory-encoding-index",
    entries: [
      {
        path: "config.top_n_diagnostics",
        title: "Config top n diagnostics",
        scoreRole: "threshold",
        value: DEFAULT_TOP_N_DIAGNOSTICS,
        source: "signal-default",
        affectsScore: true,
      },
      {
        path: "config.warn_threshold",
        title: "Config warn threshold",
        scoreRole: "threshold",
        value: DEFAULT_WARN_THRESHOLD,
        source: "signal-default",
        affectsScore: true,
      },
      {
        path: "config.min_available_factor_weight",
        title: "Config min available factor weight",
        scoreRole: "threshold",
        value: DEFAULT_MIN_AVAILABLE_FACTOR_WEIGHT,
        source: "signal-default",
        affectsScore: true,
      },
    ],
  }),
  inputs: compositeSignalInputs(SHARED_11_COMPOSITE_INPUTS),
  compute: (config, inputs) =>
    Effect.sync(() => computeTheoryEncodingIndexOutput(config, inputs)),
  score: (out) => {
    if (out.state === "insufficient_evidence") return 1
    return out.theoryEncodingScore
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.state === "insufficient_evidence") {
      return [{
        severity: "warn" as const,
        message:
          "Theory encoding index has insufficient configured evidence to measure.",
        data: {
          inputFactStates: out.inputFactStates,
          availableFactorWeight: out.availableFactorWeight,
          minAvailableFactorWeight: out.minAvailableFactorWeight,
          evidenceCompleteness: out.evidenceCompleteness,
          requiredFoundationMeasured: out.requiredFoundationMeasured,
        },
      }].slice(0, out.diagnosticLimit)
    }

    if (out.gaps.length === 0) {
      return [{
        severity: "info" as const,
        message: "Theory encoding index is measured with no theory gaps.",
        data: {
          inputFactStates: out.inputFactStates,
          theoryEncodingScore: out.theoryEncodingScore,
          availableFactorWeight: out.availableFactorWeight,
          evidenceCompleteness: out.evidenceCompleteness,
          requiredFoundationMeasured: out.requiredFoundationMeasured,
        },
      }].slice(0, out.diagnosticLimit)
    }

    return out.gaps.slice(0, out.diagnosticLimit).map((gap) => ({
      severity:
        gap.pressure >= out.warnThreshold ? ("warn" as const) : ("info" as const),
      message:
        `Theory encoding gap #${gap.rank}: ${gap.label} ` +
        `(pressure=${gap.pressure.toFixed(2)})`,
      data: {
        ...gap,
        theoryEncodingScore: out.theoryEncodingScore,
        theoryGapPressure: out.theoryGapPressure,
        warnThreshold: out.warnThreshold,
      },
    }))
  },
  outputMetadata: (out) =>
    out.state === "insufficient_evidence"
      ? { applicability: "insufficient_evidence" as const }
      : undefined,
}

export const computeTheoryEncodingIndexOutput = (
  config: Shared11TheoryEncodingIndexConfig,
  inputOutputs: ReadonlyMap<string, unknown>,
): Shared11TheoryEncodingIndexOutput => {
  const normalizedConfig = normalizeShared11TheoryEncodingIndexConfig(config)
  const resolution = resolveCompositeInputs(SHARED_11_COMPOSITE_INPUTS, inputOutputs)
  const inputs = resolveTheoryEncodingInputs(resolution)
  const inputFactStates = theoryEncodingInputFactStates(resolution, inputs)
  const diagnosticLimit = normalizedConfig.top_n_diagnostics
  const warnThreshold = normalizedConfig.warn_threshold
  const minAvailableFactorWeight = normalizedConfig.min_available_factor_weight
  const measurement = measureTheoryEncoding(inputFactStates, inputs)

  if (
    resolution.hasMissingRequiredInputs ||
    !measurement.requiredFoundationMeasured ||
    !hasConfiguredTheoryEvidence(measurement, minAvailableFactorWeight)
  ) {
    return insufficientTheoryEncodingOutput(
      theoryOutputContext({
        measurement,
        diagnosticLimit,
        inputFactStates,
        warnThreshold,
        minAvailableFactorWeight,
      }),
      resolution,
    )
  }

  const theoryGapPressure = weightedTheoryGapPressure(
    measurement.factors,
    measurement.availableFactorWeight,
  )
  const gaps = theoryEncodingGaps(measurement.factors)
  const state = theoryGapPressure === 0 ? "zero" as const : "present" as const

  return withTheoryEncodingExplanation(
    baseTheoryEncodingOutput({
      state,
      factors: measurement.factors,
      gaps,
      diagnosticLimit,
      inputFactStates,
      availableFactorWeight: measurement.availableFactorWeight,
      totalDeclaredFactorWeight: measurement.totalDeclaredFactorWeight,
      evidenceCompleteness: measurement.evidenceCompleteness,
      theoryGapPressure,
      warnThreshold,
      minAvailableFactorWeight,
      requiredFoundationMeasured: measurement.requiredFoundationMeasured,
    }),
    resolution,
    state === "present"
      ? "Combines deterministic construction, contract, property/spec, machine feedback, coverage, boundary parsing, typed error, and churn-pressure facts into one theory-encoding pressure."
      : "Theory encoding index is measured and no configured deterministic theory gap was found.",
  )
}

const measureTheoryEncoding = (
  inputFactStates: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): TheoryEncodingMeasurement => {
  const factors = buildTheoryEncodingFactors(inputFactStates, inputs)
  const availableFactorWeight = factors.reduce(
    (total, factor) => total + (factor.pressure === undefined ? 0 : factor.weight),
    0,
  )
  const totalDeclaredFactorWeight = Object.values(FACTOR_WEIGHTS).reduce(
    (total, weight) => total + weight,
    0,
  )
  return {
    factors,
    availableFactorWeight,
    totalDeclaredFactorWeight,
    evidenceCompleteness: clamp01(availableFactorWeight / totalDeclaredFactorWeight),
    requiredFoundationMeasured: requiredFoundationInputsMeasured(inputFactStates),
  }
}

const hasConfiguredTheoryEvidence = (
  measurement: TheoryEncodingMeasurement,
  minAvailableFactorWeight: number,
): boolean => measurement.availableFactorWeight >= minAvailableFactorWeight

const insufficientTheoryEncodingOutput = (
  context: ReturnType<typeof theoryOutputContext>,
  resolution: CompositeInputResolution,
): Shared11TheoryEncodingIndexOutput =>
  withTheoryEncodingExplanation(
    baseTheoryEncodingOutput({
      ...context,
      state: "insufficient_evidence",
      gaps: [],
      theoryGapPressure: 0,
    }),
    resolution,
    resolution.hasMissingRequiredInputs || !context.requiredFoundationMeasured
      ? "Theory encoding index is not measured because required shared theory facts are missing or not measured."
      : "Theory encoding index is not measured because configured deterministic evidence is below the minimum available factor weight.",
  )

const theoryOutputContext = (args: {
  readonly measurement: TheoryEncodingMeasurement
  readonly diagnosticLimit: number
  readonly inputFactStates: TheoryEncodingInputFactStates
  readonly warnThreshold: number
  readonly minAvailableFactorWeight: number
}) => ({
  factors: args.measurement.factors,
  diagnosticLimit: args.diagnosticLimit,
  inputFactStates: args.inputFactStates,
  availableFactorWeight: args.measurement.availableFactorWeight,
  totalDeclaredFactorWeight: args.measurement.totalDeclaredFactorWeight,
  evidenceCompleteness: args.measurement.evidenceCompleteness,
  warnThreshold: args.warnThreshold,
  minAvailableFactorWeight: args.minAvailableFactorWeight,
  requiredFoundationMeasured: args.measurement.requiredFoundationMeasured,
})

const theoryEncodingGaps = (
  factors: ReadonlyArray<TheoryEncodingFactor>,
): ReadonlyArray<TheoryEncodingGap> =>
  factors
    .filter((factor): factor is TheoryEncodingFactor & {
      readonly pressure: number
      readonly contribution: number
    } => factor.pressure !== undefined && factor.contribution !== undefined)
    .filter((factor) => factor.pressure > 0)
    .sort(compareTheoryEncodingFactors)
    .map((factor, index) => ({
      rank: index + 1,
      factorId: factor.id,
      label: factor.label,
      pressure: factor.pressure,
      contribution: factor.contribution,
      state: factor.state,
      evidence: factor.evidence,
    }))

const resolveTheoryEncodingInputs = (
  inputs: CompositeInputResolution,
): TheoryEncodingInputs => ({
  domainConstructionControl:
    inputs.valueOf<Shared10DomainConstructionControlOutput>(
      "SHARED-10-domain-construction-control",
    ),
  contractFreshness:
    inputs.valueOf<Shared09ContractFreshnessOutput>(
      "SHARED-09-contract-freshness",
    ),
  machineFeedbackCoverage:
    inputs.valueOf<Shared07MachineFeedbackCoverageOutput>(
      "SHARED-07-machine-feedback-coverage",
    ),
  coverageFacts:
    inputs.valueOf<SharedCov01CoverageFactsOutput>(
      "SHARED-COV-01-coverage-facts",
    ),
  boundaryParserCoverage:
    inputs.valueOf<BoundaryParserCoverageLikeOutput>(
      "TS-AD-04-boundary-parser-coverage",
    ),
  errorChannelOpacity:
    inputs.valueOf<ErrorChannelOpacityLikeOutput>(
      "TS-LD-09-error-channel-opacity",
    ),
  recencyWeightedChurn:
    inputs.valueOf<SharedChurn02Output>(
      "SHARED-CHURN-02-recency-weighted-churn",
    ),
})

const normalizeShared11TheoryEncodingIndexConfig = (
  config: Shared11TheoryEncodingIndexConfig,
): Shared11TheoryEncodingIndexConfig => ({
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
  warn_threshold: Number.isFinite(config.warn_threshold)
    ? clamp01(config.warn_threshold)
    : DEFAULT_WARN_THRESHOLD,
  min_available_factor_weight: Number.isFinite(config.min_available_factor_weight)
    ? clamp01(config.min_available_factor_weight)
    : DEFAULT_MIN_AVAILABLE_FACTOR_WEIGHT,
})

const baseTheoryEncodingOutput = (args: {
  readonly state: TheoryEncodingIndexState
  readonly factors: ReadonlyArray<TheoryEncodingFactor>
  readonly gaps: ReadonlyArray<TheoryEncodingGap>
  readonly diagnosticLimit: number
  readonly inputFactStates: TheoryEncodingInputFactStates
  readonly requiredFoundationMeasured: boolean
  readonly availableFactorWeight: number
  readonly totalDeclaredFactorWeight: number
  readonly evidenceCompleteness: number
  readonly theoryGapPressure: number
  readonly warnThreshold: number
  readonly minAvailableFactorWeight: number
}): Omit<Shared11TheoryEncodingIndexOutput, "explanation"> => {
  const theoryEncodingScore = Math.max(0, 1 - Math.min(1, args.theoryGapPressure))
  return {
    ...args,
    theoryEncodingScore,
    riskModel: "theory-encoding-index-v1",
    compositeConsumers: [
      "constraint ecosystem overview",
      "architecture review routing",
      "AI code triage",
    ],
    cacheContributors: [
      "input.SHARED-10-domain-construction-control",
      "input.SHARED-09-contract-freshness",
      "input.SHARED-07-machine-feedback-coverage",
      "input.SHARED-COV-01-coverage-facts",
      "input.TS-AD-04-boundary-parser-coverage",
      "input.TS-LD-09-error-channel-opacity",
      "input.SHARED-CHURN-02-recency-weighted-churn",
      "derived.property-spec-presence",
      "config.top_n_diagnostics",
      "config.warn_threshold",
      "config.min_available_factor_weight",
    ],
    calibrationSurface:
      "input signal calibration and repo-owned reference data; future shared.theory-encoding-policy can tune factor weights by repository taste",
    evidenceClass: [
      "repo-owned manifest",
      "machine feedback discovery",
      "coverage report",
      "runtime boundary",
      "type",
      "generated artifact freshness",
      "property/spec evidence",
      "temporal history",
    ],
    claimLimit:
      "Summarizes how much declared domain theory, generated contracts, property/spec artifacts, validation feedback, boundary parsing, typed failure evidence, and churn pressure are present in deterministic facts.",
    nonClaimLimit:
      "Does not prove semantic correctness, invariant completeness, test meaningfulness, or that undeclared theory is absent.",
    knownFailureModes: [
      "missing manifests can hide theory that lives only in code or prose",
      "coverage percentages do not prove behavioral assertions",
      "syntactic parser and error-channel evidence can miss project-specific conventions",
      "churn can be human or agent-authored unless a committed AI fact source is present",
      "repositories without declared construction or contract artifacts may be correctly outside this signal's scope",
    ],
    enforcementCeiling: [...THEORY_ENCODING_ENFORCEMENT_CEILING],
  }
}

const withTheoryEncodingExplanation = (
  output: Omit<Shared11TheoryEncodingIndexOutput, "explanation">,
  inputs: CompositeInputResolution,
  rationale: string,
): Shared11TheoryEncodingIndexOutput => ({
  ...output,
  explanation: buildCompositeExplanation({
    inputs,
    finalScore: Shared11TheoryEncodingIndex.score(
      output as Shared11TheoryEncodingIndexOutput,
    ),
    rationale,
    enforcementCeiling: [...THEORY_ENCODING_ENFORCEMENT_CEILING],
  }),
})

const theoryEncodingInputFactStates = (
  resolution: CompositeInputResolution,
  inputs: TheoryEncodingInputs,
): TheoryEncodingInputFactStates => ({
  domainConstructionControl: inputFactState(
    resolution,
    "SHARED-10-domain-construction-control",
    inputs.domainConstructionControl?.state,
  ),
  contractFreshness: inputFactState(
    resolution,
    "SHARED-09-contract-freshness",
    inputs.contractFreshness?.state,
  ),
  machineFeedbackCoverage: inputFactState(
    resolution,
    "SHARED-07-machine-feedback-coverage",
    inputs.machineFeedbackCoverage?.state,
  ),
  coverageFacts: inputFactState(
    resolution,
    "SHARED-COV-01-coverage-facts",
    inputs.coverageFacts?.state,
  ),
  boundaryParserCoverage: inputFactState(
    resolution,
    "TS-AD-04-boundary-parser-coverage",
    inputs.boundaryParserCoverage?.state,
  ),
  errorChannelOpacity: inputFactState(
    resolution,
    "TS-LD-09-error-channel-opacity",
    inputs.errorChannelOpacity?.state,
  ),
  recencyWeightedChurn: inputFactState(
    resolution,
    "SHARED-CHURN-02-recency-weighted-churn",
    recencyWeightedChurnState(inputs.recencyWeightedChurn),
  ),
})

const inputFactState = (
  resolution: CompositeInputResolution,
  id: string,
  state: TheoryEncodingInputFactState | undefined,
): TheoryEncodingInputFactState =>
  resolution.missingRequiredInputs.includes(id)
    ? "missing_required"
    : resolution.missingInputs.includes(id)
      ? "missing_optional"
      : state ?? "unknown"

const requiredFoundationInputsMeasured = (
  states: TheoryEncodingInputFactStates,
): boolean =>
  isMeasuredTheoryEncodingState(states.domainConstructionControl) &&
  isMeasuredTheoryEncodingState(states.contractFreshness)

const isMeasuredTheoryEncodingState = (
  state: TheoryEncodingInputFactState,
): boolean => state === "present" || state === "zero"

const recencyWeightedChurnState = (
  input: SharedChurn02Output | undefined,
): TheoryEncodingInputFactState | undefined => {
  if (input === undefined) return undefined
  return input.byFile.size === 0 ? "absent" : "present"
}
