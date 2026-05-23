import { Schema } from "effect"
import type { CalibrationDecision, TypeScriptCloneGroupPolicyValue } from "@skastr0/pulsar-core/calibration"
import type { TsFunctionLike as FnLike } from "./shared-function-index.js"

export const TsSl01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  test_globs: Schema.Array(Schema.String),
  min_tokens: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsSl01Config = typeof TsSl01Config.Type

export interface CloneGroupMember {
  readonly file: string
  readonly name: string
  readonly startLine: number
  readonly endLine: number
}

export interface CloneGroup {
  readonly groupId: string
  readonly kind: "exact" | "structural"
  readonly tokenCount: number
  readonly members: ReadonlyArray<CloneGroupMember>
  readonly structuralHash: string
  readonly policy?: Pick<
    TypeScriptCloneGroupPolicyValue,
    "action" | "factor" | "visible" | "severity" | "penaltyWeight" | "metadata"
  >
}

export interface TsSl01Output {
  readonly groups: ReadonlyArray<CloneGroup>
  readonly totalFunctionsAnalyzed: number
  readonly scoreBudgetFunctions: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly detectionMinTokens?: number
  readonly diagnosticLimit?: number
  readonly calibrationDecisions?: ReadonlyArray<CalibrationDecision>
}

export const DEFAULT_SCORE_BUDGET_MIN_TOKENS = 12
export const DEFAULT_TS_SL_01_DIAGNOSTIC_LIMIT = 10

export const normalizeTsSl01Config = (config: TsSl01Config): TsSl01Config => ({
  ...config,
  min_tokens: normalizeTsSl01MinTokens(config.min_tokens),
  top_n_diagnostics: normalizeTsSl01DiagnosticLimit(config.top_n_diagnostics),
})

export const normalizeTsSl01MinTokens = (value: number): number =>
  Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : DEFAULT_SCORE_BUDGET_MIN_TOKENS

export const normalizeTsSl01DiagnosticLimit = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

export type CloneCandidate = {
  readonly fn: FnLike
  readonly path: string
  readonly body: string
  readonly startLine: number
  readonly endLine: number
  readonly exactKey: string
  readonly exactHash: string
  readonly structuralHash: string
  readonly changed: boolean
  readonly tokenCount: number
}

export interface TsSl01Context {
  readonly worktreePath: string
  readonly changedHunks: ReadonlyArray<{
    readonly file: string
    readonly oldStart: number
    readonly oldLines: number
    readonly newStart: number
    readonly newLines: number
  }>
}

export interface CloneCandidateCollection {
  readonly functions: ReadonlyArray<CloneCandidate>
  readonly scoreBudgetFunctions: number
  readonly totalFunctionsAnalyzed: number
  readonly scopeMode: TsSl01Output["scopeMode"]
}

export interface CloneSourceFileCollection {
  readonly functions: ReadonlyArray<CloneCandidate>
  readonly scoreBudgetFunctions: number
  readonly totalFunctionsAnalyzed: number
}

export type StructuralAnalysisCache = Map<
  string,
  { readonly tokenCount: number; readonly structuralHash: string }
>
