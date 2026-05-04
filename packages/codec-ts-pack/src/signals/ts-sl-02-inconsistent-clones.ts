import {
  SignalContextTag,
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { basename } from "node:path"
import { simpleGit } from "simple-git"
import type { TsSl01Output, CloneGroup } from "./ts-sl-01-duplication.js"

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

type CloneMemberWithHistory = Omit<CloneMember, "historyStatus"> & {
  readonly historyStatus: "ok" | "unknown"
  readonly timestamp: number
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

const ACTIONABLE_DIVERGENCE_THRESHOLD = 0.75
const MIN_STRUCTURAL_DIVERGENCE_TOKENS = 30

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
    max_groups_analyzed: 8,
    max_members_per_group: 16,
  },
  inputs: [{ id: "TS-SL-01" }],
  compute: (config, inputs) =>
    Effect.gen(function* () {
      const context = yield* SignalContextTag
      const tsSl01Output = inputs.get("TS-SL-01") as TsSl01Output | undefined

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
          const git = simpleGit(context.worktreePath)
          const divergentGroups: Array<DivergentClone> = []
          const candidateGroups = selectNonOverlappingCandidateGroups(
            tsSl01Output.groups.filter(isInconsistentCloneCandidate),
          )
          const groupsToAnalyze = candidateGroups.slice(0, config.max_groups_analyzed)
          const referenceTime = await getReferenceTime(git, context.gitSha)
          const analysisLimitHit =
            candidateGroups.length > groupsToAnalyze.length ||
            groupsToAnalyze.some((group) => group.members.length > config.max_members_per_group)
          const historyCache = new Map<string, Promise<HistoryResult>>()
          const jobs = groupsToAnalyze.flatMap((group) =>
            group.members.slice(0, config.max_members_per_group).map((member) => ({
              group,
              member,
            })),
          )
          const historyResults = await mapWithConcurrency(jobs, 4, async ({ group, member }) => {
            const cacheKey = `${member.file}:${member.startLine}:${member.endLine}`
            const history = await getOrCreate(historyCache, cacheKey, () =>
              getLastModifiedForRange(
                git,
                member.file,
                member.startLine,
                member.endLine,
                context.worktreePath,
              ),
            )

            return {
              groupId: group.groupId,
              member: {
                file: member.file,
                ...(member.name !== undefined ? { name: member.name } : {}),
                startLine: member.startLine,
                endLine: member.endLine,
                lastModifiedSha: history.sha,
                lastModifiedAt: history.date,
                historyStatus: history.status,
                timestamp: new Date(history.date).getTime(),
              },
            }
          })

          const membersByGroup = new Map<string, Array<CloneMemberWithHistory>>()
          for (const result of historyResults) {
            const existing = membersByGroup.get(result.groupId) ?? []
            existing.push(result.member)
            membersByGroup.set(result.groupId, existing)
          }

          for (const group of groupsToAnalyze) {
            const membersWithHistory = membersByGroup.get(group.groupId) ?? []

            const distinctShas = new Set(membersWithHistory.map((m) => m.lastModifiedSha))
            const divergenceScore =
              membersWithHistory.length <= 1
                ? 0
                : (distinctShas.size - 1) / (membersWithHistory.length - 1)

            const timestamps = membersWithHistory.map((m) => m.timestamp).sort((a, b) => a - b)
            const lastModifiedWindow =
              timestamps.length > 1 ? (timestamps[timestamps.length - 1]! - timestamps[0]!) / (1000 * 60 * 60 * 24) : 0

            const hasRecentModification = membersWithHistory.some(
              (m) =>
                m.historyStatus === "ok" &&
                referenceTime - m.timestamp < config.min_window_days * 24 * 60 * 60 * 1000,
            )

            if (divergenceScore >= config.divergence_threshold && hasRecentModification) {
              const members = membersWithHistory.map((m) => ({
                file: m.file,
                ...(m.name !== undefined ? { name: m.name } : {}),
                startLine: m.startLine,
                endLine: m.endLine,
                lastModifiedSha: m.lastModifiedSha,
                lastModifiedAt: m.lastModifiedAt,
                historyStatus: m.historyStatus,
              }))
              const evidence = classifyCloneEvidence(members)
              divergentGroups.push({
                groupId: group.groupId,
                kind: group.kind,
                tokenCount: group.tokenCount,
                members,
                confidence: evidence.confidence,
                evidenceKind: evidence.kind,
                sampledMemberCount: membersWithHistory.length,
                totalMemberCount: group.members.length,
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
            analyzedGroups: groupsToAnalyze.length,
            analysisLimitHit,
            diagnosticLimit: config.top_n_diagnostics,
            divergenceDistribution: distribution,
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "TS-SL-02", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.analyzedGroups === 0) return 1
    const actionableGroups = out.divergentGroups.filter(
      (group) => group.divergenceScore > ACTIONABLE_DIVERGENCE_THRESHOLD,
    )
    if (actionableGroups.length === 0) return 1
    const maxDivergence = Math.max(...actionableGroups.map((group) => group.divergenceScore))
    const worstPenalty =
      ((maxDivergence - ACTIONABLE_DIVERGENCE_THRESHOLD) /
        (1 - ACTIONABLE_DIVERGENCE_THRESHOLD)) *
      0.25
    const weightedBreadth = actionableGroups.reduce(
      (sum, group) => sum + confidenceWeight(group),
      0,
    )
    const breadthPenalty = Math.min(0.3, Math.log2(weightedBreadth + 1) * 0.12)
    return 1 - Math.min(0.75, worstPenalty + breadthPenalty)
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

const isInconsistentCloneCandidate = (group: CloneGroup): boolean =>
  group.kind === "structural" && group.tokenCount >= MIN_STRUCTURAL_DIVERGENCE_TOKENS

const selectNonOverlappingCandidateGroups = (
  groups: ReadonlyArray<CloneGroup>,
): ReadonlyArray<CloneGroup> => {
  const selected: Array<CloneGroup> = []
  for (const group of groups) {
    if (selected.some((existing) => isNestedCloneGroup(group, existing))) continue
    selected.push(group)
  }
  return selected
}

const isNestedCloneGroup = (candidate: CloneGroup, existing: CloneGroup): boolean => {
  if (candidate.members.length > existing.members.length) return false
  return candidate.members.every((candidateMember) =>
    existing.members.some((existingMember) =>
      candidateMember.file === existingMember.file &&
      candidateMember.startLine >= existingMember.startLine &&
      candidateMember.endLine <= existingMember.endLine,
    ),
  )
}

const confidenceWeight = (group: DivergentClone): number =>
  group.confidence === "medium" ? 0.5 : 1

const classifyCloneEvidence = (
  members: ReadonlyArray<CloneMember>,
): {
  readonly confidence: "high" | "medium"
  readonly kind: "clone-drift" | "parallel-family" | "paired-variant"
} => {
  if (isParallelFamilyClone(members)) {
    return { confidence: "medium", kind: "parallel-family" }
  }
  if (isPairedVariantClone(members)) {
    return { confidence: "medium", kind: "paired-variant" }
  }
  return { confidence: "high", kind: "clone-drift" }
}

const isParallelFamilyClone = (members: ReadonlyArray<CloneMember>): boolean => {
  if (members.length < 3) return false
  const basenames = new Set(members.map((member) => basename(member.file)))
  if (basenames.size !== 1) return false
  const names = new Set(members.map((member) => member.name).filter((name): name is string => name !== undefined))
  if (names.size !== 1) return false
  return new Set(members.map((member) => parentDirectory(member.file))).size === members.length
}

const isPairedVariantClone = (members: ReadonlyArray<CloneMember>): boolean => {
  if (members.length !== 2) return false
  const names = members.map((member) => member.name).filter((name): name is string => name !== undefined)
  if (names.length !== 2 || names[0] === names[1]) return false
  const left = identifierTokens(names[0]!)
  const right = identifierTokens(names[1]!)
  if (left.length < 2 || right.length < 2) return false
  const sharedTokenCount = commonOuterTokenCount(left, right)
  return sharedTokenCount >= 2 && sharedTokenCount / Math.max(left.length, right.length) >= 0.4
}

const identifierTokens = (name: string): ReadonlyArray<string> =>
  (name.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? [name]).map((token) =>
    token.toLowerCase(),
  )

const commonOuterTokenCount = (
  left: ReadonlyArray<string>,
  right: ReadonlyArray<string>,
): number => {
  let prefix = 0
  while (left[prefix] !== undefined && left[prefix] === right[prefix]) prefix++

  let suffix = 0
  while (
    suffix < left.length - prefix &&
    suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]
  ) {
    suffix++
  }

  return prefix + suffix
}

const parentDirectory = (file: string): string => {
  const normalized = file.replace(/\\/g, "/")
  const index = normalized.lastIndexOf("/")
  return index === -1 ? "" : normalized.slice(0, index)
}

const cloneMemberSummary = (members: ReadonlyArray<CloneMember>): string => {
  if (members.length === 0) return "no sampled members"
  const visible = members
    .slice(0, 3)
    .map((member) =>
      `${member.file}:${member.startLine}${member.name !== undefined ? ` ${member.name}` : ""}`,
    )
  const hidden = members.length - visible.length
  return hidden > 0 ? `${visible.join(", ")} (+${hidden} more)` : visible.join(", ")
}

const getOrCreate = <T>(
  cache: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
): Promise<T> => {
  const existing = cache.get(key)
  if (existing !== undefined) return existing
  const created = factory()
  cache.set(key, created)
  return created
}

const mapWithConcurrency = async <A, B>(
  items: ReadonlyArray<A>,
  concurrency: number,
  fn: (item: A) => Promise<B>,
): Promise<Array<B>> => {
  const results = new Array<B>(items.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        const index = nextIndex++
        if (index >= items.length) return
        results[index] = await fn(items[index]!)
      }
    }),
  )

  return results
}

const getLastModifiedForRange = async (
  git: ReturnType<typeof simpleGit>,
  filePath: string,
  startLine: number,
  endLine: number,
  worktreePath: string,
): Promise<HistoryResult> => {
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

    const latest = parseLatestBlameRecord(blame)
    if (latest === undefined) {
      return unknownHistory()
    }

    return { ...latest, status: "ok" }
  } catch {
    return unknownHistory()
  }
}

interface HistoryResult {
  readonly sha: string
  readonly date: string
  readonly status: "ok" | "unknown"
}

const unknownHistory = (): HistoryResult => ({
  sha: "unknown",
  date: "1970-01-01T00:00:00.000Z",
  status: "unknown",
})

const getReferenceTime = async (
  git: ReturnType<typeof simpleGit>,
  gitSha: string,
): Promise<number> => {
  try {
    const raw = await git.raw(["show", "-s", "--format=%ct", gitSha])
    const timestampSeconds = Number(raw.trim())
    if (Number.isFinite(timestampSeconds)) return timestampSeconds * 1000
  } catch {
    // Fall back to wall-clock time only when HEAD metadata is unavailable.
  }
  return Date.now()
}

const parseLatestBlameRecord = (blame: string): { sha: string; date: string } | undefined => {
  let currentSha: string | undefined
  let latest: { sha: string; timestampSeconds: number } | undefined

  for (const line of blame.split("\n")) {
    const shaMatch = /^([0-9a-f]{40})\s/.exec(line)
    if (shaMatch !== null) {
      currentSha = shaMatch[1]
      continue
    }

    if (!line.startsWith("committer-time ") && !line.startsWith("author-time ")) continue
    if (currentSha === undefined) continue
    const timestampSeconds = Number(line.slice(line.indexOf(" ") + 1))
    if (!Number.isFinite(timestampSeconds)) continue
    if (latest === undefined || timestampSeconds > latest.timestampSeconds) {
      latest = { sha: currentSha, timestampSeconds }
    }
  }

  if (latest === undefined) return undefined
  return {
    sha: latest.sha,
    date: new Date(latest.timestampSeconds * 1000).toISOString(),
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
