import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core"
import { Effect, Schema } from "effect"
import type { TsSl01Output, CloneGroup } from "./ts-sl-01-duplication.js"
import {
  ACTIONABLE_DIVERGENCE_THRESHOLD,
  cloneMemberSummary,
  divergentClonePenalty,
} from "./ts-sl-02-evidence.js"
import {
  analyzeInconsistentClones,
} from "./ts-sl-02-analysis.js"

export const TsSl02Config = Schema.Struct({
  divergence_threshold: Schema.Number,
  min_window_days: Schema.Number,
  top_n_diagnostics: Schema.Number,
  max_groups_analyzed: Schema.Number,
  max_members_per_group: Schema.Number,
})
export type TsSl02Config = typeof TsSl02Config.Type

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
}

export interface TsSl02Output {
  readonly divergentGroups: ReadonlyArray<DivergentClone>
  readonly totalGroups: number
  readonly analyzedGroups: number
  readonly analysisLimitHit: boolean
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
  cacheVersion: "analysis-limit-uncertainty-v1",
  configSchema: TsSl02Config,
  defaultConfig: {
    divergence_threshold: 0.5,
    min_window_days: 30,
    top_n_diagnostics: 10,
    max_groups_analyzed: 8,
    max_members_per_group: 16,
  },
  inputs: [{ id: "TS-SL-01-duplication" }],
  compute: (config, inputs) =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      const tsSl01Output = (inputs.get("TS-SL-01-duplication") ??
        inputs.get("TS-SL-01")) as TsSl01Output | undefined

      if (tsSl01Output === undefined || tsSl01Output.groups.length === 0) {
        return {
          divergentGroups: [],
          totalGroups: 0,
          analyzedGroups: 0,
          analysisLimitHit: false,
          diagnosticLimit: config.top_n_diagnostics,
          divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
        }
      }

      return yield* Effect.tryPromise({
        try: async (): Promise<TsSl02Output> => {
          return analyzeInconsistentClones(
            config,
            tsSl01Output,
            context.worktreePath,
            context.gitSha,
          )
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-02-inconsistent-clones", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.analyzedGroups === 0) return 1
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
    return Math.min(analysisLimitScoreCap(out), 1 - Math.min(0.75, worstPenalty))
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.divergentGroups.slice(0, out.diagnosticLimit ?? 10).map((group) => ({
      severity:
        group.divergenceScore > ACTIONABLE_DIVERGENCE_THRESHOLD &&
        (group.confidence ?? "high") === "high"
          ? ("warn" as const)
          : ("info" as const),
      message:
        `Divergent ${group.kind ?? "structural"} clone group` +
        `${group.tokenCount !== undefined ? ` (${group.tokenCount} tokens)` : ""}: ` +
        `${group.sampledMemberCount ?? group.members.length}/${group.totalMemberCount ?? group.members.length} members, ` +
        `divergence=${group.divergenceScore.toFixed(2)}, ` +
        `confidence=${group.confidence ?? "high"}` +
        `${group.evidenceKind !== undefined ? `, evidence=${group.evidenceKind}` : ""}` +
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
        members: group.members,
      },
    })),
}

const analysisLimitScoreCap = (out: TsSl02Output): number =>
  out.analysisLimitHit ? 0.95 : 1
