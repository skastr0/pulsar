import { simpleGit } from "simple-git"
import type { TsSl01Output, CloneGroup } from "./ts-sl-01-model.js"
import { compareCloneMemberContent } from "./ts-sl-02-content.js"
import { classifyCloneEvidence } from "./ts-sl-02-evidence.js"
import {
  calculateDistribution,
  getReferenceTime,
  loadCloneHistoryByGroup,
  type CloneMemberWithHistory,
} from "./ts-sl-02-history.js"
import type {
  CloneMember,
  DivergentClone,
  TsSl02Config,
  TsSl02Output,
} from "./ts-sl-02-inconsistent-clones.js"

const MIN_STRUCTURAL_DIVERGENCE_TOKENS = 30

export const analyzeInconsistentClones = async (
  config: TsSl02Config,
  tsSl01Output: TsSl01Output,
  worktreePath: string,
  gitSha: string,
): Promise<TsSl02Output> => {
  const git = simpleGit(worktreePath)
  const candidateGroups = selectNonOverlappingCandidateGroups(
    tsSl01Output.groups.filter(isInconsistentCloneCandidate),
  )
  const groupsToAnalyze = candidateGroups.slice(0, config.max_groups_analyzed)
  const referenceTime = await getReferenceTime(git, gitSha)
  const membersByGroup = await loadCloneHistoryByGroup(
    git,
    worktreePath,
    groupsToAnalyze,
    config.max_members_per_group,
  )
  const divergentGroups: Array<DivergentClone> = []

  for (const group of groupsToAnalyze) {
    const divergentGroup = await buildDivergentCloneGroup(
      group,
      membersByGroup.get(group.groupId) ?? [],
      referenceTime,
      config,
      worktreePath,
    )
    if (divergentGroup !== undefined) divergentGroups.push(divergentGroup)
  }

  const sortedGroups = divergentGroups.sort(compareDivergentClones)
  return {
    divergentGroups: sortedGroups,
    totalGroups: tsSl01Output.groups.length,
    candidateGroups: candidateGroups.length,
    analyzedGroups: groupsToAnalyze.length,
    analysisLimitHit:
      candidateGroups.length > groupsToAnalyze.length ||
      groupsToAnalyze.some((group) => group.members.length > config.max_members_per_group),
    analysisLimitScoreCap: config.analysis_limit_score_cap,
    diagnosticLimit: config.top_n_diagnostics,
    divergenceDistribution: calculateDistribution(sortedGroups.map((group) => group.divergenceScore)),
  }
}


const buildDivergentCloneGroup = async (
  group: CloneGroup,
  membersWithHistory: ReadonlyArray<CloneMemberWithHistory>,
  referenceTime: number,
  config: TsSl02Config,
  worktreePath: string,
): Promise<DivergentClone | undefined> => {
  const content = await compareCloneMemberContent(worktreePath, membersWithHistory)
  // Fewer than two readable members means no content claim is possible in
  // either direction — distinct from "compared and found consistent".
  if (content.comparedMemberCount < 2) return undefined
  if (content.contentVariantCount <= 1) return undefined

  const membersWithKnownHistory = membersWithHistory.filter((member) => member.historyStatus === "ok")
  const lastModifiedWindow = cloneLastModifiedWindow(membersWithKnownHistory)
  const hasRecentModification = membersWithKnownHistory.some(
    (member) => referenceTime - member.timestamp < config.min_window_days * 24 * 60 * 60 * 1000,
  )
  if (content.divergenceScore < config.divergence_threshold || !hasRecentModification) return undefined

  const members = membersWithHistory.map(toCloneMember)
  const evidence = classifyCloneEvidence(members)
  return {
    groupId: group.groupId,
    kind: group.kind,
    tokenCount: group.tokenCount,
    members,
    confidence: historyCorroboratesIndependentEdits(membersWithKnownHistory)
      ? evidence.confidence
      : "medium",
    evidenceKind: evidence.kind,
    sampledMemberCount: membersWithHistory.length,
    totalMemberCount: group.members.length,
    divergenceScore: content.divergenceScore,
    lastModifiedWindow,
    comparedMemberCount: content.comparedMemberCount,
    contentVariantCount: content.contentVariantCount,
    maxTokenDelta: content.maxTokenDelta,
  }
}

const historyCorroboratesIndependentEdits = (
  members: ReadonlyArray<CloneMemberWithHistory>,
): boolean => new Set(members.map((member) => member.lastModifiedSha)).size > 1

const cloneLastModifiedWindow = (members: ReadonlyArray<CloneMemberWithHistory>): number => {
  const timestamps = members.map((member) => member.timestamp).sort((left, right) => left - right)
  if (timestamps.length <= 1) return 0
  return (timestamps[timestamps.length - 1]! - timestamps[0]!) / (1000 * 60 * 60 * 24)
}

const toCloneMember = (member: CloneMemberWithHistory): CloneMember => ({
  file: member.file,
  ...(member.name !== undefined ? { name: member.name } : {}),
  startLine: member.startLine,
  endLine: member.endLine,
  lastModifiedSha: member.lastModifiedSha,
  lastModifiedAt: member.lastModifiedAt,
  historyStatus: member.historyStatus,
})

const isInconsistentCloneCandidate = (group: CloneGroup): boolean =>
  group.kind === "structural" && group.tokenCount >= MIN_STRUCTURAL_DIVERGENCE_TOKENS

const selectNonOverlappingCandidateGroups = (
  groups: ReadonlyArray<CloneGroup>,
): ReadonlyArray<CloneGroup> => {
  const selected: Array<CloneGroup> = []
  for (const group of [...groups].sort(compareCandidateCloneGroups)) {
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

const compareDivergentClones = (left: DivergentClone, right: DivergentClone): number =>
  right.divergenceScore - left.divergenceScore ||
  right.lastModifiedWindow - left.lastModifiedWindow ||
  left.groupId.localeCompare(right.groupId)

const compareCandidateCloneGroups = (left: CloneGroup, right: CloneGroup): number =>
  (right.tokenCount ?? 0) - (left.tokenCount ?? 0) ||
  totalMemberSpan(right) - totalMemberSpan(left) ||
  right.members.length - left.members.length ||
  left.groupId.localeCompare(right.groupId)

const totalMemberSpan = (group: CloneGroup): number =>
  group.members.reduce(
    (total, member) => total + Math.max(0, member.endLine - member.startLine + 1),
    0,
  )
