import { basename } from "node:path"
import type { CloneMember, DivergentClone } from "./ts-sl-02-inconsistent-clones.js"

export const ACTIONABLE_DIVERGENCE_THRESHOLD = 0.75

export const divergentClonePenalty = (
  groups: ReadonlyArray<DivergentClone>,
  opts: {
    readonly maxDivergencePenalty: number
    readonly breadthScale: number
    readonly maxBreadthPenalty: number
  },
): number => {
  if (groups.length === 0) return 0
  const maxDivergence = Math.max(...groups.map((group) => group.divergenceScore))
  const worstPenalty =
    ((maxDivergence - ACTIONABLE_DIVERGENCE_THRESHOLD) /
      (1 - ACTIONABLE_DIVERGENCE_THRESHOLD)) *
    opts.maxDivergencePenalty
  const weightedBreadth = groups.reduce((sum, group) => sum + confidenceWeight(group), 0)
  const breadthPenalty = Math.min(
    opts.maxBreadthPenalty,
    Math.log2(weightedBreadth + 1) * opts.breadthScale,
  )
  return worstPenalty + breadthPenalty
}

export const classifyCloneEvidence = (
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

export const cloneMemberSummary = (members: ReadonlyArray<CloneMember>): string => {
  if (members.length === 0) return "no sampled members"
  const visible = members
    .slice(0, 3)
    .map((member) =>
      `${member.file}:${member.startLine}${member.name !== undefined ? ` ${member.name}` : ""}`,
    )
  const hidden = members.length - visible.length
  return hidden > 0 ? `${visible.join(", ")} (+${hidden} more)` : visible.join(", ")
}

const confidenceWeight = (group: DivergentClone): number =>
  group.confidence === "medium" ? 0.5 : 1

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
