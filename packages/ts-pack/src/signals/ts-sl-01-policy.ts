import type { Diagnostic } from "@skastr0/pulsar-core/signal"
import type { CloneGroup, CloneGroupMember, TsSl01Output } from "./ts-sl-01-model.js"
import { DEFAULT_SCORE_BUDGET_MIN_TOKENS } from "./ts-sl-01-model.js"

export const cloneMemberSummary = (members: ReadonlyArray<CloneGroupMember>): string => {
  const visible = sortCloneMembers(members)
    .slice(0, 3)
    .map((member) => `${member.file}:${member.startLine} ${member.name}`)
  const hidden = members.length - visible.length
  return hidden > 0 ? `${visible.join(", ")} (+${hidden} more)` : visible.join(", ")
}

export const sortCloneMembers = (
  members: ReadonlyArray<CloneGroupMember>,
): ReadonlyArray<CloneGroupMember> =>
  [...members].sort(compareCloneMembers)

export const cloneGroupRepresentative = (
  group: CloneGroup,
): CloneGroupMember | undefined =>
  sortCloneMembers(group.members)[0]

const compareCloneMembers = (
  left: CloneGroupMember,
  right: CloneGroupMember,
): number =>
  compareStringAsc(left.file, right.file) ||
  left.startLine - right.startLine ||
  left.endLine - right.endLine ||
  compareStringAsc(left.name, right.name)

export const cloneGroupImpact = (
  group: CloneGroup,
  scopeMode: TsSl01Output["scopeMode"],
  minTokens: number,
): number => {
  if (group.policy?.visible === false || group.policy?.action === "exclude") return 0
  const extraMembers = Math.max(0, group.members.length - 1)
  if (extraMembers === 0) return 0

  const factor = cloneGroupPolicyFactor(group)
  if (group.kind === "exact") {
    if (group.tokenCount < 20 && minTokens >= DEFAULT_SCORE_BUDGET_MIN_TOKENS) return 0
    if (scopeMode === "whole-tree" && group.tokenCount < 20) return 0
    const memberPressure = scopeMode === "whole-tree" && group.tokenCount < 50
      ? Math.log2(group.members.length) * 0.5
      : extraMembers
    return memberPressure * 1.2 * Math.min(3, Math.max(0.3, group.tokenCount / 30)) * factor
  }

  if (scopeMode === "changed-hunks") {
    return extraMembers * Math.min(1.5, Math.max(0.1, group.tokenCount / 60)) * factor
  }

  if (group.tokenCount < 30) return 0
  return extraMembers * Math.min(0.35, (group.tokenCount - 30) / 120) * factor
}

const cloneGroupPolicyFactor = (group: CloneGroup): number => {
  if (group.policy === undefined) return 1
  const actionFactor = group.policy.action === "deweight" ? group.policy.factor : 1
  return Math.max(0, actionFactor * group.policy.penaltyWeight)
}

export const cloneGroupSeverity = (
  group: CloneGroup,
  scopeMode: TsSl01Output["scopeMode"],
  minTokens: number,
): Diagnostic["severity"] => {
  if (group.policy?.severity !== undefined) return group.policy.severity
  if (group.kind === "exact") return group.tokenCount < 30 ? "info" : "warn"
  return cloneGroupImpact(group, scopeMode, minTokens) >= 5 ? "warn" : "info"
}

const compareStringAsc = (left: string, right: string): number => {
  if (left === right) return 0
  return left < right ? -1 : 1
}
