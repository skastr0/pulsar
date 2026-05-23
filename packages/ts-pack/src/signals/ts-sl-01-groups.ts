import { getFunctionName } from "./shared-function-index.js"
import { isExactCloneEligible, isStructuralCloneEligible } from "./ts-sl-01-eligibility.js"
import { countExactTokens } from "./ts-sl-01-hash.js"
import type { CloneCandidate, CloneGroup, CloneGroupMember, TsSl01Config, TsSl01Output } from "./ts-sl-01-model.js"
import { cloneGroupImpact, cloneGroupRepresentative, sortCloneMembers } from "./ts-sl-01-policy.js"

export const buildCloneGroups = (
  functions: ReadonlyArray<CloneCandidate>,
  config: TsSl01Config,
  scopeMode: TsSl01Output["scopeMode"],
): ReadonlyArray<CloneGroup> => {
  const groups: Array<CloneGroup> = []
  let groupIndex = 0
  for (const group of buildExactGroups(functions, config, scopeMode)) {
    groups.push(toCloneGroup(`exact-${groupIndex++}`, "exact", group))
  }
  for (const group of buildStructuralGroups(functions, config, scopeMode)) {
    groups.push(toCloneGroup(`structural-${groupIndex++}`, "structural", group))
  }
  return groups
}

const toCloneGroup = (
  groupId: string,
  kind: CloneGroup["kind"],
  group: {
    readonly tokenCount: number
    readonly members: ReadonlyArray<{ readonly member: CloneGroupMember }>
    readonly hash: string
  },
): CloneGroup => ({
  groupId,
  kind,
  tokenCount: group.tokenCount,
  members: sortCloneMembers(group.members.map((member) => member.member)),
  structuralHash: group.hash,
})

export const sortCloneGroups = (
  groups: ReadonlyArray<CloneGroup>,
  scopeMode: TsSl01Output["scopeMode"],
  minTokens: number,
): ReadonlyArray<CloneGroup> =>
  [...groups].sort((a, b) =>
    cloneGroupImpact(b, scopeMode, minTokens) - cloneGroupImpact(a, scopeMode, minTokens) ||
    b.members.length - a.members.length ||
    b.tokenCount - a.tokenCount ||
    compareStringAsc(a.kind, b.kind) ||
    compareStringAsc(a.structuralHash, b.structuralHash) ||
    compareCloneGroupRepresentative(a, b) ||
    compareStringAsc(a.groupId, b.groupId),
  )

type MaterializedCloneCandidate = CloneCandidate & {
  readonly member: CloneGroupMember
}

const materializeCloneCandidate = (candidate: CloneCandidate): MaterializedCloneCandidate => ({
  ...candidate,
  member: {
    file: candidate.path,
    name: getFunctionName(candidate.fn),
    startLine: candidate.startLine,
    endLine: candidate.endLine,
  },
})

const buildExactGroups = (
  functions: ReadonlyArray<CloneCandidate>,
  _config: TsSl01Config,
  scopeMode: TsSl01Output["scopeMode"],
): ReadonlyArray<{ hash: string; tokenCount: number; members: ReadonlyArray<MaterializedCloneCandidate> }> => {
  const grouped = new Map<string, Array<(typeof functions)[number]>>()
  for (const fn of functions) {
    const key = fn.exactKey
    const bucket = grouped.get(key) ?? []
    bucket.push(fn)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .map((bucket) =>
      bucket.filter((candidate) =>
        isExactCloneEligible(candidate.fn, countExactTokens(candidate.body)),
      ),
    )
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .map((bucket) => ({
      hash: bucket[0]!.exactHash,
      tokenCount: bucket[0]!.tokenCount,
      members: bucket.map(materializeCloneCandidate),
    }))
    .sort(compareMaterializedCloneGroups)
}

const buildStructuralGroups = (
  functions: ReadonlyArray<CloneCandidate>,
  _config: TsSl01Config,
  scopeMode: TsSl01Output["scopeMode"],
): ReadonlyArray<{ hash: string; tokenCount: number; members: ReadonlyArray<MaterializedCloneCandidate> }> => {
  const grouped = new Map<string, Array<(typeof functions)[number]>>()
  for (const fn of functions) {
    const key = fn.structuralHash
    const bucket = grouped.get(key) ?? []
    bucket.push(fn)
    grouped.set(key, bucket)
  }

  return [...grouped.values()]
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .map((bucket) => bucket.filter((candidate) => isStructuralCloneEligible(candidate.fn)))
    .filter((bucket) => bucket.length > 1)
    .filter((bucket) => shouldRetainCloneBucket(bucket, scopeMode))
    .filter((bucket) => new Set(bucket.map((candidate) => candidate.exactKey)).size > 1)
    .map((bucket) => ({
      hash: bucket[0]!.structuralHash,
      tokenCount: bucket[0]!.tokenCount,
      members: bucket.map(materializeCloneCandidate),
    }))
    .sort(compareMaterializedCloneGroups)
}

const shouldRetainCloneBucket = (
  bucket: ReadonlyArray<CloneCandidate>,
  scopeMode: TsSl01Output["scopeMode"],
): boolean =>
  scopeMode === "whole-tree" || bucket.some((candidate) => candidate.changed)

const compareMaterializedCloneGroups = (
  left: {
    readonly hash: string
    readonly tokenCount: number
    readonly members: ReadonlyArray<MaterializedCloneCandidate>
  },
  right: {
    readonly hash: string
    readonly tokenCount: number
    readonly members: ReadonlyArray<MaterializedCloneCandidate>
  },
): number =>
  compareStringAsc(left.hash, right.hash) ||
  right.tokenCount - left.tokenCount ||
  right.members.length - left.members.length ||
  compareCloneMembers(firstSortedMember(left.members), firstSortedMember(right.members))

const firstSortedMember = (
  members: ReadonlyArray<MaterializedCloneCandidate>,
): CloneGroupMember | undefined =>
  sortCloneMembers(members.map((candidate) => candidate.member))[0]

const compareCloneGroupRepresentative = (
  left: CloneGroup,
  right: CloneGroup,
): number =>
  compareCloneMembers(cloneGroupRepresentative(left), cloneGroupRepresentative(right))

const compareCloneMembers = (
  left: CloneGroupMember | undefined,
  right: CloneGroupMember | undefined,
): number => {
  if (left === undefined && right === undefined) return 0
  if (left === undefined) return 1
  if (right === undefined) return -1
  return (
    compareStringAsc(left.file, right.file) ||
    left.startLine - right.startLine ||
    left.endLine - right.endLine ||
    compareStringAsc(left.name, right.name)
  )
}

const compareStringAsc = (left: string, right: string): number => {
  if (left === right) return 0
  return left < right ? -1 : 1
}
