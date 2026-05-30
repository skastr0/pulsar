import {
  compositeSignalInputs,
  resolveCompositeInputs,
  type CompositeInputResolution,
  type Diagnostic,
  type Signal,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  DEFAULT_MIN_AVAILABLE_FACTOR_WEIGHT,
  DEFAULT_TOP_N_DIAGNOSTICS,
  DEFAULT_WARN_THRESHOLD,
  insufficientTheoryEncodingOutput,
  measureTheoryEncoding,
  measuredTheoryEncodingOutput,
  needsInsufficientTheoryEncodingOutput,
  THEORY_ENCODING_ENFORCEMENT_CEILING,
  theoryEncodingConfigContext,
  theoryOutputContext,
} from "./shared-11-theory-encoding-output.js"
import { SHARED_11_COMPOSITE_INPUTS } from "./shared-11-theory-encoding-inputs.js"
import type {
  Shared11TheoryEncodingIndexOutput,
  TheoryEncodingInputFactState,
  TheoryEncodingInputFactStates,
  TheoryEncodingInputs,
} from "./shared-11-theory-encoding-model.js"

export const Shared11TheoryEncodingIndexConfig = Schema.Struct({
  top_n_diagnostics: Schema.Number,
  warn_threshold: Schema.Number,
  min_available_factor_weight: Schema.Number,
})
export type Shared11TheoryEncodingIndexConfig =
  typeof Shared11TheoryEncodingIndexConfig.Type

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

const computeTheoryEncodingIndexOutput = (
  config: Shared11TheoryEncodingIndexConfig,
  inputOutputs: ReadonlyMap<string, unknown>,
): Shared11TheoryEncodingIndexOutput => {
  const configContext = theoryEncodingConfigContext(config)
  const resolution = resolveCompositeInputs(SHARED_11_COMPOSITE_INPUTS, inputOutputs)
  const inputs = resolveTheoryEncodingInputs(resolution)
  const inputFactStates = theoryEncodingInputFactStates(resolution, inputs)
  const measurement = measureTheoryEncoding(inputFactStates, inputs)

  if (needsInsufficientTheoryEncodingOutput(resolution, measurement, configContext)) {
    return insufficientTheoryEncodingOutput(
      theoryOutputContext({
        measurement,
        diagnosticLimit: configContext.diagnosticLimit,
        inputFactStates,
        warnThreshold: configContext.warnThreshold,
        minAvailableFactorWeight: configContext.minAvailableFactorWeight,
      }),
      resolution,
    )
  }

  return measuredTheoryEncodingOutput(
    measurement,
    inputFactStates,
    resolution,
    configContext,
  )
}

const resolveTheoryEncodingInputs = (
  inputs: CompositeInputResolution,
): TheoryEncodingInputs => ({
  domainConstructionControl:
    inputs.valueOf<NonNullable<TheoryEncodingInputs["domainConstructionControl"]>>(
      "SHARED-10-domain-construction-control",
    ),
  contractFreshness:
    inputs.valueOf<NonNullable<TheoryEncodingInputs["contractFreshness"]>>(
      "SHARED-09-contract-freshness",
    ),
  machineFeedbackCoverage:
    inputs.valueOf<NonNullable<TheoryEncodingInputs["machineFeedbackCoverage"]>>(
      "SHARED-07-machine-feedback-coverage",
    ),
  coverageFacts:
    inputs.valueOf<NonNullable<TheoryEncodingInputs["coverageFacts"]>>(
      "SHARED-COV-01-coverage-facts",
    ),
  boundaryParserCoverage:
    inputs.valueOf<NonNullable<TheoryEncodingInputs["boundaryParserCoverage"]>>(
      "TS-AD-04-boundary-parser-coverage",
    ),
  errorChannelOpacity:
    inputs.valueOf<NonNullable<TheoryEncodingInputs["errorChannelOpacity"]>>(
      "TS-LD-09-error-channel-opacity",
    ),
  recencyWeightedChurn:
    inputs.valueOf<NonNullable<TheoryEncodingInputs["recencyWeightedChurn"]>>(
      "SHARED-CHURN-02-recency-weighted-churn",
    ),
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

const recencyWeightedChurnState = (
  input: TheoryEncodingInputs["recencyWeightedChurn"],
): TheoryEncodingInputFactState | undefined => {
  if (input === undefined) return undefined
  return input.byFile.size === 0 ? "absent" : "present"
}
