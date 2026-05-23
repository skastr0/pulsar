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

interface BoundaryParserCoverageLikeOutput {
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

interface ErrorChannelOpacityLikeOutput {
  readonly state: "present" | "zero" | "not_applicable"
  readonly topFindings?: ReadonlyArray<Readonly<Record<string, unknown>>>
  readonly totalFindings: number
  readonly boundaryFindings: number
  readonly weightedOpacity: number
  readonly boundaryWeightedOpacity: number
  readonly densityPressure: number
  readonly boundaryPressure: number
}

interface TheoryEncodingInputs {
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

const FACTOR_WEIGHTS = {
  domainConstructionControl: 0.2,
  contractFreshness: 0.15,
  machineFeedbackCoverage: 0.14,
  coverageFacts: 0.1,
  boundaryParserCoverage: 0.14,
  errorChannelOpacity: 0.09,
  propertySpecPresence: 0.1,
  aiChurnPressure: 0.08,
} as const

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
  const factors = buildTheoryEncodingFactors(inputFactStates, inputs)
  const availableFactorWeight = factors.reduce(
    (total, factor) => total + (factor.pressure === undefined ? 0 : factor.weight),
    0,
  )
  const totalDeclaredFactorWeight = Object.values(FACTOR_WEIGHTS).reduce(
    (total, weight) => total + weight,
    0,
  )
  const evidenceCompleteness = clamp01(availableFactorWeight / totalDeclaredFactorWeight)
  const hasConfiguredEvidence = availableFactorWeight >= minAvailableFactorWeight
  const requiredFoundationMeasured = requiredFoundationInputsMeasured(inputFactStates)

  if (
    resolution.hasMissingRequiredInputs ||
    !requiredFoundationMeasured ||
    !hasConfiguredEvidence
  ) {
    return withTheoryEncodingExplanation(
      baseTheoryEncodingOutput({
        state: "insufficient_evidence",
        factors,
        gaps: [],
        diagnosticLimit,
        inputFactStates,
        availableFactorWeight,
        totalDeclaredFactorWeight,
        evidenceCompleteness,
        theoryGapPressure: 0,
        warnThreshold,
        minAvailableFactorWeight,
        requiredFoundationMeasured,
      }),
      resolution,
      resolution.hasMissingRequiredInputs || !requiredFoundationMeasured
        ? "Theory encoding index is not measured because required shared theory facts are missing or not measured."
        : "Theory encoding index is not measured because configured deterministic evidence is below the minimum available factor weight.",
    )
  }

  const theoryGapPressure = weightedTheoryGapPressure(factors, availableFactorWeight)
  const gaps = factors
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
  const state = theoryGapPressure === 0 ? "zero" as const : "present" as const

  return withTheoryEncodingExplanation(
    baseTheoryEncodingOutput({
      state,
      factors,
      gaps,
      diagnosticLimit,
      inputFactStates,
      availableFactorWeight,
      totalDeclaredFactorWeight,
      evidenceCompleteness,
      theoryGapPressure,
      warnThreshold,
      minAvailableFactorWeight,
      requiredFoundationMeasured,
    }),
    resolution,
    state === "present"
      ? "Combines deterministic construction, contract, property/spec, machine feedback, coverage, boundary parsing, typed error, and churn-pressure facts into one theory-encoding pressure."
      : "Theory encoding index is measured and no configured deterministic theory gap was found.",
  )
}

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

const buildTheoryEncodingFactors = (
  states: TheoryEncodingInputFactStates,
  inputs: TheoryEncodingInputs,
): ReadonlyArray<TheoryEncodingFactor> => {
  const propertySpec = propertySpecEvidence(inputs)
  const drafts: ReadonlyArray<Omit<TheoryEncodingFactor, "contribution">> = [
    {
      id: "domain-construction-control",
      label: "Domain construction control",
      state: states.domainConstructionControl,
      weight: FACTOR_WEIGHTS.domainConstructionControl,
      pressure: normalizeDomainConstructionControl(inputs.domainConstructionControl),
      evidence: summarizeDomainConstructionControl(inputs.domainConstructionControl),
      claimLimit:
        "Declared domain constructs have current construction-control evidence.",
      nonClaimLimit: "Does not prove parser semantic completeness.",
    },
    {
      id: "contract-freshness",
      label: "Contract freshness",
      state: states.contractFreshness,
      weight: FACTOR_WEIGHTS.contractFreshness,
      pressure: normalizeContractFreshness(inputs.contractFreshness),
      evidence: summarizeContractFreshness(inputs.contractFreshness),
      claimLimit: "Declared generated artifacts are fresh against recorded hashes.",
      nonClaimLimit: "Does not prove generator or contract semantic correctness.",
    },
    {
      id: "machine-feedback-coverage",
      label: "Machine feedback coverage",
      state: states.machineFeedbackCoverage,
      weight: FACTOR_WEIGHTS.machineFeedbackCoverage,
      pressure: normalizeMachineFeedbackCoverage(inputs.machineFeedbackCoverage),
      evidence: summarizeMachineFeedbackCoverage(inputs.machineFeedbackCoverage),
      claimLimit:
        "Required build/typecheck/test/static-analysis feedback classes are discoverable locally or in CI.",
      nonClaimLimit: "Does not prove the feedback is exhaustive or meaningful.",
    },
    {
      id: "coverage-facts",
      label: "Coverage facts",
      state: states.coverageFacts,
      weight: FACTOR_WEIGHTS.coverageFacts,
      pressure: normalizeCoverageFacts(inputs.coverageFacts),
      evidence: summarizeCoverageFacts(inputs.coverageFacts),
      claimLimit: "Loaded coverage reports expose measured statement/function/branch coverage.",
      nonClaimLimit: "Does not prove covered code has meaningful assertions.",
    },
    {
      id: "boundary-parser-coverage",
      label: "Boundary parser coverage",
      state: states.boundaryParserCoverage,
      weight: FACTOR_WEIGHTS.boundaryParserCoverage,
      pressure: normalizeBoundaryParserCoverage(inputs.boundaryParserCoverage),
      evidence: summarizeBoundaryParserCoverage(inputs.boundaryParserCoverage),
      claimLimit:
        "Weak external-input boundaries have syntactic parser/decode evidence.",
      nonClaimLimit: "Does not prove parser semantics or authorization correctness.",
    },
    {
      id: "error-channel-opacity",
      label: "Error channel opacity",
      state: states.errorChannelOpacity,
      weight: FACTOR_WEIGHTS.errorChannelOpacity,
      pressure: normalizeErrorChannelOpacity(inputs.errorChannelOpacity),
      evidence: summarizeErrorChannelOpacity(inputs.errorChannelOpacity),
      claimLimit:
        "Expected failure channels are not hidden behind broad exceptions or collapsed typed errors.",
      nonClaimLimit: "Does not prove every possible failure is modeled.",
    },
    {
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
    },
    {
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
    },
  ]
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

const weightedTheoryGapPressure = (
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

const compareTheoryEncodingFactors = (
  left: TheoryEncodingFactor & { readonly contribution: number },
  right: TheoryEncodingFactor & { readonly contribution: number },
): number =>
  right.contribution - left.contribution ||
  right.pressure! - left.pressure! ||
  left.label.localeCompare(right.label)

const summarizeDomainConstructionControl = (
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

const normalizeDomainConstructionControl = (
  input: Shared10DomainConstructionControlOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state !== "present" && input.state !== "zero") return undefined
  return clamp01(input.scorePressure)
}

const summarizeContractFreshness = (
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

const normalizeContractFreshness = (
  input: Shared09ContractFreshnessOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state !== "present" && input.state !== "zero") return undefined
  return clamp01(input.scorePressure)
}

const summarizeMachineFeedbackCoverage = (
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

const normalizeMachineFeedbackCoverage = (
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

const summarizeCoverageFacts = (
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

const normalizeCoverageFacts = (
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

const summarizeBoundaryParserCoverage = (
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

const normalizeBoundaryParserCoverage = (
  input: BoundaryParserCoverageLikeOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state === "absent" || input.state === "not_configured") return undefined
  if (input.weakBoundaryFunctions === 0) return 0
  return clamp01(input.findings.length / input.weakBoundaryFunctions)
}

const summarizeErrorChannelOpacity = (
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

const normalizeErrorChannelOpacity = (
  input: ErrorChannelOpacityLikeOutput | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.state === "not_applicable") return undefined
  return clamp01(Math.max(input.densityPressure, input.boundaryPressure))
}

const propertySpecEvidence = (
  inputs: TheoryEncodingInputs,
): {
  readonly state: TheoryEncodingInputFactState
  readonly pressure?: number | undefined
  readonly evidence: Readonly<Record<string, unknown>>
} => {
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

const summarizeRecencyWeightedChurn = (
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

const normalizeRecencyWeightedChurn = (
  input: SharedChurn02Output | undefined,
): number | undefined => {
  if (input === undefined) return undefined
  if (input.byFile.size === 0) return undefined
  const topWeightedChurn = topWeightedChurnFiles(input)[0]?.weightedChurn ?? 0
  return clamp01(topWeightedChurn / 5)
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

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
