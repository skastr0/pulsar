import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { simpleGit } from "simple-git"
import type { TsSl01Output, CloneGroup } from "./ts-sl-01-duplication.js"
import type { SharedChurn01Output } from "./shared-churn-01.js"

export const TsSl02Config = Schema.Struct({
  divergence_threshold: Schema.Number,
  min_window_days: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsSl02Config = typeof TsSl02Config.Type

export interface CloneMember {
  readonly file: string
  readonly startLine: number
  readonly endLine: number
  readonly lastModifiedSha: string
  readonly lastModifiedAt: string
}

export interface DivergentClone {
  readonly groupId: string
  readonly members: ReadonlyArray<CloneMember>
  readonly divergenceScore: number
  readonly lastModifiedWindow: number
}

export interface TsSl02Output {
  readonly divergentGroups: ReadonlyArray<DivergentClone>
  readonly totalGroups: number
  readonly divergenceDistribution: {
    readonly min: number
    readonly max: number
    readonly mean: number
    readonly median: number
  }
}

export const TsSl02: Signal<TsSl02Config, TsSl02Output, SignalContextTag> = {
  id: "TS-SL-02",
  tier: 1.5,
  category: "generated-slop",
  kind: "compound",
  configSchema: TsSl02Config,
  defaultConfig: {
    divergence_threshold: 0.5,
    min_window_days: 30,
    top_n_diagnostics: 10,
  },
  inputs: [{ id: "TS-SL-01" }, { id: "SHARED-CHURN-01" }],
  compute: (config, inputs) =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      const tsSl01Output = inputs.get("TS-SL-01") as TsSl01Output | undefined

      if (tsSl01Output === undefined || tsSl01Output.groups.length === 0) {
        return {
          divergentGroups: [],
          totalGroups: 0,
          divergenceDistribution: { min: 0, max: 0, mean: 0, median: 0 },
        }
      }

      return yield* Effect.tryPromise({
        try: async (): Promise<TsSl02Output> => {
          const git = simpleGit(context.worktreePath)
          const divergentGroups: Array<DivergentClone> = []

          for (const group of tsSl01Output.groups) {
            const membersWithHistory: Array<CloneMember & { timestamp: number }> = []

            for (const member of group.members) {
              const history = await getLastModifiedForRange(
                git,
                member.file,
                member.startLine,
                member.endLine,
                context.worktreePath,
              )

              membersWithHistory.push({
                file: member.file,
                startLine: member.startLine,
                endLine: member.endLine,
                lastModifiedSha: history.sha,
                lastModifiedAt: history.date,
                timestamp: new Date(history.date).getTime(),
              })
            }

            const distinctShas = new Set(membersWithHistory.map((m) => m.lastModifiedSha))
            const divergenceScore = distinctShas.size / membersWithHistory.length

            const timestamps = membersWithHistory.map((m) => m.timestamp).sort((a, b) => a - b)
            const lastModifiedWindow =
              timestamps.length > 1 ? (timestamps[timestamps.length - 1]! - timestamps[0]!) / (1000 * 60 * 60 * 24) : 0

            const hasRecentModification = membersWithHistory.some(
              (m) => Date.now() - m.timestamp < config.min_window_days * 24 * 60 * 60 * 1000,
            )

            if (divergenceScore >= config.divergence_threshold && hasRecentModification) {
              divergentGroups.push({
                groupId: group.groupId,
                members: membersWithHistory.map((m) => ({
                  file: m.file,
                  startLine: m.startLine,
                  endLine: m.endLine,
                  lastModifiedSha: m.lastModifiedSha,
                  lastModifiedAt: m.lastModifiedAt,
                })),
                divergenceScore,
                lastModifiedWindow,
              })
            }
          }

          const scores = divergentGroups.map((g) => g.divergenceScore)
          const distribution = calculateDistribution(scores)

          return {
            divergentGroups: divergentGroups.sort((a, b) => b.divergenceScore - a.divergenceScore),
            totalGroups: tsSl01Output.groups.length,
            divergenceDistribution: distribution,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-02", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.totalGroups === 0) return 1
    const divergenceRatio = out.divergentGroups.length / out.totalGroups
    return 1 - Math.min(1, divergenceRatio * 5)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.divergentGroups.slice(0, 10).map((group) => ({
      severity: group.divergenceScore > 0.75 ? ("warn" as const) : ("info" as const),
      message: `Divergent clone group ${group.groupId}: ${group.members.length} members, divergence=${group.divergenceScore.toFixed(2)}`,
      location: {
        file: group.members[0]?.file ?? "unknown",
        line: group.members[0]?.startLine,
      },
      data: {
        groupId: group.groupId,
        divergenceScore: group.divergenceScore,
        lastModifiedWindow: group.lastModifiedWindow,
        members: group.members,
      },
    })),
}

const getLastModifiedForRange = async (
  git: ReturnType<typeof simpleGit>,
  filePath: string,
  startLine: number,
  endLine: number,
  worktreePath: string,
): Promise<{ sha: string; date: string }> => {
  try {
    const relPath = filePath.startsWith(worktreePath) ? filePath.slice(worktreePath.length + 1) : filePath

    const blame = await git.raw([
      "blame",
      "-L",
      `${startLine},${endLine}`,
      "--porcelain",
      "--",
      relPath,
    ])

    const shaMatch = /^([0-9a-f]{40})/m.exec(blame)
    if (shaMatch === null) {
      return { sha: "unknown", date: new Date().toISOString() }
    }

    const sha = shaMatch[1]!

    const log = await git.raw(["log", "-1", "--format=%cI", sha])
    const date = log.trim() || new Date().toISOString()

    return { sha, date }
  } catch {
    return { sha: "unknown", date: new Date().toISOString() }
  }
}

const calculateDistribution = (
  values: ReadonlyArray<number>,
): { min: number; max: number; mean: number; median: number } => {
  if (values.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!
  const mean = values.reduce((a, b) => a + b, 0) / values.length

  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!

  return { min, max, mean, median }
}