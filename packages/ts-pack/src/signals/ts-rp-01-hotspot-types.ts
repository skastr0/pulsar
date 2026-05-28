export interface HotspotConfig {
  readonly top_n: number
  readonly min_churn: number
  readonly min_complexity: number
  readonly threshold_softness: number
  readonly peer_percentile_floor: number
}

export const TS_RP_01_DEFAULT_CONFIG = {
  top_n: 10,
  min_churn: 2,
  min_complexity: 5,
  threshold_softness: 0.5,
  peer_percentile_floor: 0.5,
} satisfies HotspotConfig

export type Quadrant = "top-right" | "top-left" | "bottom-right" | "bottom-left"

export interface Hotspot {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly hotspotScore: number
  readonly quadrant: Quadrant
  readonly rank: number
  readonly weightedChurn?: number
  readonly ownershipRisk?: number
  readonly coverageGap?: number
  readonly cochangeRisk?: number
  readonly riskFactors?: HotspotRiskFactors
}

export interface HotspotOutputWithoutExplanation {
  readonly hotspots: ReadonlyArray<Hotspot>
  readonly diagnosticLimit?: number
  readonly totalFilesConsidered: number
  readonly topRightShare: number
  readonly topRightPressure: number
  readonly medianChurn: number
  readonly medianComplexity: number
  readonly legacyFilesConsidered: number
  readonly legacyTopRightShare: number
  readonly softFilesConsidered: number
  readonly softTopRightShare: number
  readonly softTopRightPressure: number
  readonly stabilizationWeight: number
  readonly riskModel: "legacy-churn-complexity" | "risk-hotspot-v2"
  readonly riskFilesConsidered: number
  readonly riskPressure: number
  readonly inputFactStates: HotspotInputFactStates
}

export interface HotspotCandidate {
  readonly file: string
  readonly churn: number
  readonly complexity: number
  readonly thresholdWeight: number
  readonly weightedChurn?: number
  readonly ownershipRisk?: number
  readonly coverageGap?: number
  readonly cochangeRisk?: number
  readonly riskFactors?: HotspotRiskFactors
}

export interface HotspotSummary {
  readonly ranked: ReadonlyArray<Hotspot>
  readonly topRightShare: number
  readonly medianChurn: number
  readonly medianComplexity: number
}

export type HotspotFactState =
  | "present"
  | "zero"
  | "absent"
  | "unknown"
  | "not_configured"
  | "not_applicable"

export interface HotspotInputFactStates {
  readonly recencyWeightedChurn: HotspotFactState
  readonly ownership: HotspotFactState
  readonly coverage: HotspotFactState
  readonly cochange: HotspotFactState
}

export interface HotspotRiskFactors {
  readonly complexity: number
  readonly churn: number
  readonly ownership?: number
  readonly coverage?: number
  readonly cochange?: number
}

export const HOTSPOT_ENFORCEMENT_CEILING = [
  "trend",
  "review-routing",
  "dashboard",
] as const
