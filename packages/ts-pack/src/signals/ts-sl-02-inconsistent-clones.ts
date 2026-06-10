import { SignalContextTag, SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal, SignalFactorLedger } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import type { TsSl01Output, CloneGroup } from "./ts-sl-01-model.js"
import { DEFAULT_SCORE_BUDGET_MIN_TOKENS } from "./ts-sl-01-model.js"
import { cloneGroupImpact } from "./ts-sl-01-policy.js"
import {
  ACTIONABLE_DIVERGENCE_THRESHOLD,
  cloneMemberSummary,
  divergentClonePenalty,
} from "./ts-sl-02-evidence.js"
import {
  analyzeInconsistentClones,
} from "./ts-sl-02-analysis.js"

const TsSl02Config = Schema.Struct({
  divergence_threshold: Schema.Number,
  min_window_days: Schema.Number,
  top_n_diagnostics: Schema.Number,
  max_groups_analyzed: Schema.Number,
  max_members_per_group: Schema.Number,
  analysis_limit_score_cap: Schema.Number,
})
export type TsSl02Config = typeof TsSl02Config.Type

export const DEFAULT_TS_SL_02_DIAGNOSTIC_LIMIT = 10
export const DEFAULT_TS_SL_02_ANALYSIS_LIMIT_SCORE_CAP = 0.95

const DEFAULT_TS_SL_02_CONFIG: TsSl02Config = {
  divergence_threshold: 0.5,
  min_window_days: 30,
  top_n_diagnostics: DEFAULT_TS_SL_02_DIAGNOSTIC_LIMIT,
  max_groups_analyzed: 8,
  max_members_per_group: 16,
  analysis_limit_score_cap: DEFAULT_TS_SL_02_ANALYSIS_LIMIT_SCORE_CAP,
}

export interface CloneMember {
  readonly file: string
  readonly name?: string
  readonly startLine: number
  readonly endLine: number
  readonly lastModifiedSha: string
  readonly lastModifiedAt: string
  readonly historyStatus?: "ok" | "unknown"
}

export interface DivergentClone {
  readonly groupId: string
  readonly kind?: CloneGroup["kind"]
  readonly tokenCount?: number
  readonly members: ReadonlyArray<CloneMember>
  readonly confidence?: "high" | "medium"
  readonly evidenceKind?: "clone-drift" | "parallel-family" | "paired-variant"
  readonly sampledMemberCount?: number
  readonly totalMemberCount?: number
  readonly divergenceScore: number
  readonly lastModifiedWindow: number
  readonly comparedMemberCount?: number
  readonly contentVariantCount?: number
  readonly maxTokenDelta?: number
}

export interface TsSl02Output {
  readonly divergentGroups: ReadonlyArray<DivergentClone>
  readonly totalGroups: number
  readonly candidateGroups?: number
  readonly analyzedGroups: number
  readonly analysisLimitHit: boolean
  readonly analysisLimitScoreCap?: number
  readonly diagnosticLimit?: number
  readonly divergenceDistribution: {
    readonly min: number
    readonly max: number
    readonly mean: number
    readonly median: number
  }
}

export const TsSl02: Signal<TsSl02Config, TsSl02Output, SignalContextTag> = {
  id: "TS-SL-02-inconsistent-clones",
  title: "Inconsistent clones",
  aliases: ["TS-SL-02"],
  tier: 1.5,
  category: "generated-slop",
  kind: "compound",
  cacheVersion: "content-grounded-divergence-v2",
  cacheDependencies: ["git-revision-context"],
  configSchema: TsSl02Config,
  defaultConfig: DEFAULT_TS_SL_02_CONFIG,
  configDirections: {
    max_groups_analyzed: "higher-is-looser",
    max_members_per_group: "higher-is-looser",
    analysis_limit_score_cap: "higher-is-looser",
  },
  factorDefinitions: [
    {
      path: "config.analysis_limit_score_cap",
      title: "Analysis limit score cap",
      valueKind: "number",
      scoreRole: "score-cap",
      defaultValue: 0.95,
    },
  ],
  inputs: [
    {
      id: "TS-SL-01-duplication",
      cacheFingerprint: "ts-sl-02-duplication-input-v1",
    },
  ],
  compute: (config, inputs) =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      const normalizedConfig = normalizeTsSl02Config(config)
      const tsSl01Output = (inputs.get("TS-SL-01-duplication") ??
        inputs.get("TS-SL-01")) as TsSl01Output | undefined

      if (tsSl01Output === undefined || tsSl01Output.groups.length === 0) {
        return {
          divergentGroups: [],
          totalGroups: 0,
          candidateGroups: 0,
          analyzedGroups: 0,
          analysisLimitHit: false,
          analysisLimitScoreCap: normalizedConfig.analysis_limit_score_cap,
          diagnosticLimit: normalizedConfig.top_n_diagnostics,
          divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
        }
      }

      return yield* Effect.tryPromise({
        try: async (): Promise<TsSl02Output> => {
          return analyzeInconsistentClones(
            normalizedConfig,
            effectiveCloneOutput(tsSl01Output),
            context.worktreePath,
            context.gitSha,
          )
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-02-inconsistent-clones", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.analyzedGroups === 0) return out.analysisLimitHit ? analysisLimitScoreCap(out) : 1
    const actionableGroups = out.divergentGroups.filter(
      (group) => group.divergenceScore > ACTIONABLE_DIVERGENCE_THRESHOLD,
    )
    if (actionableGroups.length === 0) return analysisLimitScoreCap(out)
    const highConfidenceGroups = actionableGroups.filter(
      (group) => (group.confidence ?? "high") === "high",
    )
    const mediumConfidenceGroups = actionableGroups.filter(
      (group) => group.confidence === "medium",
    )
    const worstPenalty =
      divergentClonePenalty(highConfidenceGroups, {
        maxDivergencePenalty: 0.25,
        breadthScale: 0.12,
        maxBreadthPenalty: 0.3,
      }) +
      divergentClonePenalty(mediumConfidenceGroups, {
        maxDivergencePenalty: 0.04,
        breadthScale: 0.03,
        maxBreadthPenalty: 0.06,
      })
    return clamp01(Math.min(analysisLimitScoreCap(out), 1 - Math.min(0.75, worstPenalty)))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    const diagnosticLimit = normalizeTsSl02DiagnosticLimit(
      out.diagnosticLimit ?? DEFAULT_TS_SL_02_DIAGNOSTIC_LIMIT,
    )
    if (diagnosticLimit <= 0) return []
    return [
      ...out.divergentGroups.map(divergentCloneDiagnostic),
      ...analysisLimitOnlyDiagnostics(out),
    ].slice(0, diagnosticLimit)
  },
  outputMetadata: (out) =>
    (out.candidateGroups ?? out.totalGroups) === 0
      ? { applicability: "not_applicable" as const }
      : undefined,
  factorLedger: tsSl02FactorLedger,
}

const effectiveCloneOutput = (output: TsSl01Output): TsSl01Output => ({
  ...output,
  groups: output.groups.filter((group) =>
    cloneGroupImpact(
      group,
      output.scopeMode,
      output.detectionMinTokens ?? DEFAULT_SCORE_BUDGET_MIN_TOKENS,
    ) > 0,
  ),
})

const analysisLimitScoreCap = (out: TsSl02Output): number =>
  out.analysisLimitHit
    ? normalizeAnalysisLimitScoreCap(out.analysisLimitScoreCap)
    : 1

const divergentCloneDiagnostic = (group: DivergentClone): Diagnostic => ({
  severity:
    group.divergenceScore > ACTIONABLE_DIVERGENCE_THRESHOLD &&
    (group.confidence ?? "high") === "high"
      ? ("warn" as const)
      : ("info" as const),
  message:
    `Divergent ${group.kind ?? "structural"} clone group` +
    `${group.tokenCount !== undefined ? ` (${group.tokenCount} tokens)` : ""}: ` +
    `${group.sampledMemberCount ?? group.members.length}/${group.totalMemberCount ?? group.members.length} members, ` +
    contentDeltaFragment(group) +
    `divergence=${group.divergenceScore.toFixed(2)}, ` +
    `confidence=${group.confidence ?? "high"}` +
    `${group.evidenceKind !== undefined ? `, evidence=${group.evidenceKind}` : ""}` +
    `, last edits ${group.lastModifiedWindow.toFixed(0)} days apart` +
    ` — ${cloneMemberSummary(group.members)}`,
  location: {
    file: group.members[0]?.file ?? "unknown",
    line: group.members[0]?.startLine,
  },
  data: {
    groupId: group.groupId,
    kind: group.kind,
    tokenCount: group.tokenCount,
    divergenceScore: group.divergenceScore,
    confidence: group.confidence ?? "high",
    evidenceKind: group.evidenceKind ?? "clone-drift",
    lastModifiedWindow: group.lastModifiedWindow,
    comparedMemberCount: group.comparedMemberCount,
    contentVariantCount: group.contentVariantCount,
    maxTokenDelta: group.maxTokenDelta,
    members: group.members,
  },
})

const contentDeltaFragment = (group: DivergentClone): string =>
  group.contentVariantCount !== undefined && group.maxTokenDelta !== undefined
    ? `${group.contentVariantCount} content variants differing by up to ` +
      `${group.maxTokenDelta} normalized tokens, `
    : ""

const analysisLimitOnlyDiagnostics = (out: TsSl02Output): ReadonlyArray<Diagnostic> => {
  if (!out.analysisLimitHit || out.divergentGroups.length > 0) return []
  const candidateGroups = out.candidateGroups ?? out.totalGroups
  return [{
    severity: "info",
    message:
      `Clone drift analysis reached its configured budget without actionable divergence: ` +
      `analyzed ${out.analyzedGroups}/${candidateGroups} candidate groups; ` +
      `score capped at ${analysisLimitScoreCap(out).toFixed(2)} until coverage is complete`,
    data: {
      totalGroups: out.totalGroups,
      candidateGroups,
      analyzedGroups: out.analyzedGroups,
      analysisLimitScoreCap: analysisLimitScoreCap(out),
    },
  }]
}

function tsSl02FactorLedger(out: TsSl02Output): SignalFactorLedger {
  return {
    signalId: "TS-SL-02-inconsistent-clones",
    entries: [
      {
        path: "analysis.limit_hit",
        title: "Analysis limit hit",
        value: out.analysisLimitHit,
        source: "computed",
        affectsScore: out.analysisLimitHit,
        scoreRole: "score-cap",
      },
      {
        path: "analysis.candidate_groups",
        title: "Candidate groups",
        value: out.candidateGroups ?? out.totalGroups,
        source: "computed",
        affectsScore: out.analysisLimitHit,
        scoreRole: "evidence",
      },
      {
        path: "analysis.analyzed_groups",
        title: "Analyzed groups",
        value: out.analyzedGroups,
        source: "computed",
        affectsScore: out.analysisLimitHit,
        scoreRole: "evidence",
      },
      {
        path: "config.analysis_limit_score_cap",
        title: "Analysis limit score cap",
        value: normalizeAnalysisLimitScoreCap(out.analysisLimitScoreCap),
        source:
          normalizeAnalysisLimitScoreCap(out.analysisLimitScoreCap) ===
            DEFAULT_TS_SL_02_ANALYSIS_LIMIT_SCORE_CAP
            ? "signal-default"
            : "vector",
        affectsScore: out.analysisLimitHit,
        scoreRole: "score-cap",
      },
    ],
  }
}

export const normalizeTsSl02Config = (config: TsSl02Config): TsSl02Config => ({
  divergence_threshold: clamp01Finite(
    config.divergence_threshold,
    DEFAULT_TS_SL_02_CONFIG.divergence_threshold,
  ),
  min_window_days: normalizeNonNegativeFiniteNumber(
    config.min_window_days,
    DEFAULT_TS_SL_02_CONFIG.min_window_days,
  ),
  top_n_diagnostics: normalizeTsSl02DiagnosticLimit(config.top_n_diagnostics),
  max_groups_analyzed: normalizeNonNegativeInteger(
    config.max_groups_analyzed,
    DEFAULT_TS_SL_02_CONFIG.max_groups_analyzed,
  ),
  max_members_per_group: normalizePositiveInteger(
    config.max_members_per_group,
    DEFAULT_TS_SL_02_CONFIG.max_members_per_group,
  ),
  analysis_limit_score_cap: normalizeAnalysisLimitScoreCap(config.analysis_limit_score_cap),
})

export const normalizeTsSl02DiagnosticLimit = (value: number): number =>
  normalizeNonNegativeInteger(value, 0)

const normalizeAnalysisLimitScoreCap = (value: number | undefined): number =>
  clamp01Finite(value ?? DEFAULT_TS_SL_02_ANALYSIS_LIMIT_SCORE_CAP, DEFAULT_TS_SL_02_ANALYSIS_LIMIT_SCORE_CAP)

const normalizePositiveInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback

const normalizeNonNegativeInteger = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback

const normalizeNonNegativeFiniteNumber = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? value : fallback

const clamp01Finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? clamp01(value) : fallback

const clamp01 = (value: number): number =>
  Math.max(0, Math.min(1, value))
