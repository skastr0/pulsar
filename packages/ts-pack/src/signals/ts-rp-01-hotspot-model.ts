import {
  buildCompositeExplanation,
  resolveCompositeInputs,
  type CompositeExplanation,
  type CompositeInputResolution,
} from "@skastr0/pulsar-core/signal"
import { normalizeHotspotConfig } from "./ts-rp-01-hotspot-config.js"
import {
  TS_RP_01_COMPOSITE_INPUTS,
  resolveHotspotInputs,
} from "./ts-rp-01-hotspot-inputs.js"
import {
  buildHotspotCandidates,
  computeSoftTopRightPressure,
  hasCandidateRiskFacts,
  riskFactorsFor,
  riskPressureFor,
  riskScoreFor,
  scoreHotspotOutput,
  stabilizationBlendWeight,
  summarizeHotspots,
} from "./ts-rp-01-hotspot-ranking.js"
import { buildRichFactIndexes } from "./ts-rp-01-hotspot-rich-facts.js"
import {
  HOTSPOT_ENFORCEMENT_CEILING,
  TS_RP_01_DEFAULT_CONFIG,
  type HotspotConfig,
  type HotspotInputFactStates,
  type HotspotOutputWithoutExplanation,
  type HotspotSummary,
} from "./ts-rp-01-hotspot-types.js"

export { TS_RP_01_COMPOSITE_INPUTS } from "./ts-rp-01-hotspot-inputs.js"
export { scoreHotspotOutput } from "./ts-rp-01-hotspot-ranking.js"
export { TS_RP_01_DEFAULT_CONFIG } from "./ts-rp-01-hotspot-types.js"
export type {
  Hotspot,
  Quadrant,
} from "./ts-rp-01-hotspot-types.js"

export interface HotspotOutput extends HotspotOutputWithoutExplanation {
  readonly explanation: CompositeExplanation
}

export const computeHotspotOutput = (
  rawConfig: HotspotConfig,
  inputs: ReadonlyMap<string, unknown>,
): HotspotOutput => {
  const config = normalizeHotspotConfig(rawConfig)
  const resolution = resolveCompositeInputs(TS_RP_01_COMPOSITE_INPUTS, inputs)
  const { complexity, churn, weightedChurn, ownership, coverage, cochange } =
    resolveHotspotInputs(resolution)
  if (complexity === undefined || churn === undefined) {
    return withHotspotExplanation(
      emptyHotspotOutput(config),
      resolution,
      "Hotspot composite is neutral because required primitive inputs are missing.",
    )
  }

  const richFacts = buildRichFactIndexes({ weightedChurn, ownership, coverage, cochange })
  const baseFiles = buildHotspotCandidates(complexity, churn, config, richFacts)
  const riskModel =
    baseFiles.some(hasCandidateRiskFacts)
      ? "risk-hotspot-v2" as const
      : "legacy-churn-complexity" as const
  const files =
    riskModel === "risk-hotspot-v2"
      ? baseFiles.map((entry) => ({
        ...entry,
        riskFactors: riskFactorsFor({
          churn: entry.churn,
          complexity: entry.complexity,
          config,
          ...(entry.weightedChurn !== undefined ? { weightedChurn: entry.weightedChurn } : {}),
          ...(entry.ownershipRisk !== undefined ? { ownershipRisk: entry.ownershipRisk } : {}),
          ...(entry.coverageGap !== undefined ? { coverageGap: entry.coverageGap } : {}),
          ...(entry.cochangeRisk !== undefined ? { cochangeRisk: entry.cochangeRisk } : {}),
        }),
      }))
      : baseFiles
  const legacyEntries = files.filter((entry) =>
    entry.churn >= config.min_churn && entry.complexity >= config.min_complexity,
  )
  const softEntries = files.filter((entry) => entry.thresholdWeight > 0)
  const legacy = summarizeHotspots(legacyEntries, (entry) => entry.churn * entry.complexity)
  const soft = summarizeHotspots(
    softEntries,
    (entry) =>
      riskModel === "risk-hotspot-v2"
        ? riskScoreFor(entry)
        : entry.churn * entry.complexity * entry.thresholdWeight,
  )
  const softTopRightPressure = computeSoftTopRightPressure(
    softEntries,
    config.min_churn,
    config.min_complexity,
    config.threshold_softness,
    config.peer_percentile_floor,
  )

  return withHotspotExplanation(
    assembleHotspotOutput(
      config,
      legacy,
      soft,
      softTopRightPressure,
      riskModel,
      richFacts.states,
    ),
    resolution,
    riskModel === "risk-hotspot-v2"
      ? "Ranks files by deterministic review risk from recency-weighted churn, complexity, ownership, coverage, and logical coupling facts."
      : "Ranks files by the composite pressure of recent churn and cyclomatic complexity.",
  )
}

const emptyHotspotOutput = (config: HotspotConfig): HotspotOutputWithoutExplanation => ({
  hotspots: [],
  totalFilesConsidered: 0,
  topRightShare: 0,
  topRightPressure: 0,
  medianChurn: 0,
  medianComplexity: 0,
  legacyFilesConsidered: 0,
  legacyTopRightShare: 0,
  softFilesConsidered: 0,
  softTopRightShare: 0,
  softTopRightPressure: 0,
  stabilizationWeight: 0,
  riskModel: "legacy-churn-complexity",
  riskFilesConsidered: 0,
  riskPressure: 0,
  inputFactStates: {
    recencyWeightedChurn: "not_configured",
    ownership: "not_configured",
    coverage: "not_configured",
    cochange: "not_configured",
  },
  diagnosticLimit: config.top_n,
})

const assembleHotspotOutput = (
  config: HotspotConfig,
  legacy: HotspotSummary,
  soft: HotspotSummary,
  softTopRightPressure: number,
  riskModel: HotspotOutputWithoutExplanation["riskModel"],
  inputFactStates: HotspotInputFactStates,
): HotspotOutputWithoutExplanation => {
  const legacyFilesConsidered = legacy.ranked.length
  const softFilesConsidered = soft.ranked.length
  const stabilizationWeight = stabilizationBlendWeight(
    legacyFilesConsidered === 0 ? softFilesConsidered : legacyFilesConsidered,
  )
  const useSoftShape = riskModel === "risk-hotspot-v2" || stabilizationWeight >= 0.5
  const chosen = useSoftShape ? soft : legacy

  return {
    hotspots: chosen.ranked,
    diagnosticLimit: config.top_n,
    totalFilesConsidered: chosen.ranked.length,
    topRightShare: chosen.topRightShare,
    topRightPressure: useSoftShape ? softTopRightPressure : 0,
    medianChurn: chosen.medianChurn,
    medianComplexity: chosen.medianComplexity,
    legacyFilesConsidered,
    legacyTopRightShare: legacy.topRightShare,
    softFilesConsidered,
    softTopRightShare: soft.topRightShare,
    softTopRightPressure,
    stabilizationWeight,
    riskModel,
    riskFilesConsidered: riskModel === "risk-hotspot-v2" ? softFilesConsidered : 0,
    riskPressure:
      riskModel === "risk-hotspot-v2" ? riskPressureFor(soft.ranked) : 0,
    inputFactStates,
  }
}

const withHotspotExplanation = (
  output: HotspotOutputWithoutExplanation,
  inputs: CompositeInputResolution,
  rationale: string,
): HotspotOutput => ({
  ...output,
  explanation: buildCompositeExplanation({
    inputs,
    finalScore: scoreHotspotOutput(output),
    rationale,
    enforcementCeiling: [...HOTSPOT_ENFORCEMENT_CEILING],
  }),
})
