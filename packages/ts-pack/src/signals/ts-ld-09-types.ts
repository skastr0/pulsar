import { Schema } from "effect"

export const TsLd09Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  max_weighted_opacity_per_kloc: Schema.Number,
  max_boundary_weighted_opacity: Schema.Number,
  expected_failure_name_patterns: Schema.Array(Schema.String),
})
export type TsLd09Config = typeof TsLd09Config.Type

export type ErrorChannelOpacityState =
  | "present"
  | "zero"
  | "not_applicable"

export type ErrorChannelOpacityKind =
  | "broad-throw"
  | "catch-without-narrowing"
  | "opaque-promise-api"
  | "promise-catch-collapse"
  | "effect-unknown-exception"
  | "effect-error-collapse"

export type ErrorChannelCollapseMode =
  | "fallback"
  | "generic-error"
  | "unknown-exception"
  | "defect"
  | "promise-rejection"
  | "swallowed"
  | "success-channel"

export interface ErrorChannelOpacityFinding {
  readonly findingId: string
  readonly file: string
  readonly line: number
  readonly column: number
  readonly symbol: string
  readonly kind: ErrorChannelOpacityKind
  readonly expressionText: string
  readonly returnTypeText?: string
  readonly boundary: boolean
  readonly expectedFailureEvidence: ReadonlyArray<string>
  readonly collapseMode?: ErrorChannelCollapseMode
  readonly severity: "info" | "warn"
  readonly baseWeight: number
  readonly weight: number
}

export interface ErrorChannelOpacityFileSummary {
  readonly findings: number
  readonly boundaryFindings: number
  readonly weightedOpacity: number
  readonly boundaryWeightedOpacity: number
}

export interface TsLd09Output {
  readonly state: ErrorChannelOpacityState
  readonly findings: ReadonlyArray<ErrorChannelOpacityFinding>
  readonly topFindings: ReadonlyArray<ErrorChannelOpacityFinding>
  readonly byFile: ReadonlyMap<string, ErrorChannelOpacityFileSummary>
  readonly byKind: ReadonlyMap<ErrorChannelOpacityKind, number>
  readonly totalFindings: number
  readonly boundaryFindings: number
  readonly weightedOpacity: number
  readonly boundaryWeightedOpacity: number
  readonly analyzedFiles: number
  readonly analyzedLines: number
  readonly densityPerKloc: number
  readonly densityPressure: number
  readonly boundaryPressure: number
  readonly densityThreshold: number
  readonly boundaryThreshold: number
  readonly diagnosticLimit: number
  readonly compositeConsumers: ReadonlyArray<string>
  readonly cacheContributors: ReadonlyArray<string>
  readonly calibrationSurface: string
  readonly evidenceClass: ReadonlyArray<string>
  readonly claimLimit: string
  readonly nonClaimLimit: string
  readonly knownFailureMode: string
  readonly enforcementCeiling: ReadonlyArray<string>
}

export interface LocalErrorChannelFinding extends Omit<ErrorChannelOpacityFinding, "file"> {}

export const BUILT_IN_ERROR_NAMES = new Set([
  "AggregateError",
  "Error",
  "EvalError",
  "RangeError",
  "ReferenceError",
  "SyntaxError",
  "TypeError",
  "URIError",
])
