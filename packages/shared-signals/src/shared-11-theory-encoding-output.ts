import {
  buildCompositeExplanation,
  type CompositeInputResolution,
} from "@skastr0/pulsar-core/signal"
import type { Shared11TheoryEncodingIndexConfig } from "./shared-11-theory-encoding-index.js"
import {
  buildTheoryEncodingFactors,
  clamp01,
  compareTheoryEncodingFactors,
  FACTOR_WEIGHTS,
  weightedTheoryGapPressure,
} from "./shared-11-theory-encoding-factors.js"
import type {
  Shared11TheoryEncodingIndexOutput,
  TheoryEncodingFactor,
  TheoryEncodingGap,
  TheoryEncodingIndexState,
  TheoryEncodingInputFactStates,
  TheoryEncodingInputs,
} from "./shared-11-theory-encoding-model.js"

export const THEORY_ENCODING_ENFORCEMENT_CEILING = [
  "trend",
  "review-routing",
  "dashboard",
] as const

export const DEFAULT_TOP_N_DIAGNOSTICS = 10
export const DEFAULT_WARN_THRESHOLD = 0.35
export const DEFAULT_MIN_AVAILABLE_FACTOR_WEIGHT = 0.25

export interface TheoryEncodingMeasurement {
  readonly factors: ReadonlyArray<TheoryEncodingFactor>
  readonly availableFactorWeight: number
  readonly totalDeclaredFactorWeight: number
  readonly evidenceCompleteness: number
  readonly requiredFoundationMeasured: boolean
}

export interface TheoryEncodingConfigContext {
  readonly diagnosticLimit: number
  readonly warnThreshold: number
  readonly minAvailableFactorWeight: number
}

export interface TheoryEncodingOutputContext {
  readonly factors: TheoryEncodingMeasurement["factors"]
  readonly diagnosticLimit: number
  readonly inputFactStates: TheoryEncodingInputFactStates
  readonly availableFactorWeight: number
  readonly totalDeclaredFactorWeight: number
  readonly evidenceCompleteness: number
  readonly warnThreshold: number
  readonly minAvailableFactorWeight: number
  readonly requiredFoundationMeasured: boolean
}

export const theoryEncodingConfigContext = (
  config: Shared11TheoryEncodingIndexConfig,
): TheoryEncodingConfigContext => {
  const normalizedConfig = normalizeShared11TheoryEncodingIndexConfig(config)
  return {
    diagnosticLimit: normalizedConfig.top_n_diagnostics,
    warnThreshold: normalizedConfig.warn_threshold,
    minAvailableFactorWeight: normalizedConfig.min_available_factor_weight,
  }
}

export const measureTheoryEncoding = (
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

export const needsInsufficientTheoryEncodingOutput = (
  resolution: CompositeInputResolution,
  measurement: TheoryEncodingMeasurement,
  config: TheoryEncodingConfigContext,
): boolean =>
  resolution.hasMissingRequiredInputs ||
  !measurement.requiredFoundationMeasured ||
  !hasConfiguredTheoryEvidence(measurement, config.minAvailableFactorWeight)

export const insufficientTheoryEncodingOutput = (
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

export const measuredTheoryEncodingOutput = (
  measurement: TheoryEncodingMeasurement,
  inputFactStates: TheoryEncodingInputFactStates,
  resolution: CompositeInputResolution,
  config: TheoryEncodingConfigContext,
): Shared11TheoryEncodingIndexOutput => {
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
      diagnosticLimit: config.diagnosticLimit,
      inputFactStates,
      availableFactorWeight: measurement.availableFactorWeight,
      totalDeclaredFactorWeight: measurement.totalDeclaredFactorWeight,
      evidenceCompleteness: measurement.evidenceCompleteness,
      theoryGapPressure,
      warnThreshold: config.warnThreshold,
      minAvailableFactorWeight: config.minAvailableFactorWeight,
      requiredFoundationMeasured: measurement.requiredFoundationMeasured,
    }),
    resolution,
    measuredTheoryEncodingRationale(state),
  )
}

export const theoryOutputContext = (args: {
  readonly measurement: TheoryEncodingMeasurement
  readonly diagnosticLimit: number
  readonly inputFactStates: TheoryEncodingInputFactStates
  readonly warnThreshold: number
  readonly minAvailableFactorWeight: number
}): TheoryEncodingOutputContext => ({
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

const hasConfiguredTheoryEvidence = (
  measurement: TheoryEncodingMeasurement,
  minAvailableFactorWeight: number,
): boolean => measurement.availableFactorWeight >= minAvailableFactorWeight

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
): Shared11TheoryEncodingIndexOutput => {
  const explanation = buildCompositeExplanation({
    inputs,
    finalScore: theoryEncodingScore(output),
    rationale,
    enforcementCeiling: [...THEORY_ENCODING_ENFORCEMENT_CEILING],
  })
  return { ...output, explanation }
}

const theoryEncodingScore = (
  output: Omit<Shared11TheoryEncodingIndexOutput, "explanation">,
): number => output.state === "insufficient_evidence" ? 1 : output.theoryEncodingScore

const measuredTheoryEncodingRationale = (
  state: Exclude<TheoryEncodingIndexState, "insufficient_evidence">,
): string =>
  state === "present"
    ? "Combines deterministic construction, contract, property/spec, machine feedback, coverage, boundary parsing, typed error, and churn-pressure facts into one theory-encoding pressure."
    : "Theory encoding index is measured and no configured deterministic theory gap was found."

const requiredFoundationInputsMeasured = (
  states: TheoryEncodingInputFactStates,
): boolean =>
  isMeasuredTheoryEncodingState(states.domainConstructionControl) &&
  isMeasuredTheoryEncodingState(states.contractFreshness)

const isMeasuredTheoryEncodingState = (
  state: TheoryEncodingIndexState | string,
): boolean => state === "present" || state === "zero"
