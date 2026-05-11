import { Schema } from "effect"
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
}

export interface TsSl01Output {
  readonly groups: ReadonlyArray<CloneGroup>
  readonly totalFunctionsAnalyzed: number
  readonly scoreBudgetFunctions: number
  readonly scopeMode: "whole-tree" | "changed-hunks"
  readonly detectionMinTokens?: number
  readonly diagnosticLimit?: number
}

export const DEFAULT_SCORE_BUDGET_MIN_TOKENS = 12

export type CloneCandidate = {
  readonly fn: FnLike
  readonly path: string
  readonly body: string
  readonly startLine: number
  readonly endLine: number
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
