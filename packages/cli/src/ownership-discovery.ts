/**
 * Detector-proposed ownership inventory from TS-SL-01 clone groups.
 *
 * Parent command supplies already-computed signal results. This module never
 * scores, never calls a model, and never writes `.pulsar/ownership.json`.
 * Completeness is the clone sample under the caller-declared scope — not every
 * domain rule in the repository.
 */
import { createHash } from "node:crypto"
import {
  collectSemanticCandidates,
  type DiscoveryLimits,
  type SemanticCandidate,
  type SignalRunResultLike,
} from "./semantic-discovery.js"

export const OWNERSHIP_INVENTORY_PROPOSAL_SCHEMA = "pulsar.ownership_inventory_proposal.v1" as const
export const CLONE_OWNERSHIP_SIGNAL_ID = "TS-SL-01-duplication"
const CLONE_SIGNAL_ALIAS = "TS-SL-01"
const NONCLONED_GAP_ID = "noncloned_shared_rules_not_inventoried"
const DETECTOR_ID_GAP_ID = "detector_ids_are_not_saved_obligations"

/** Parent CLI defaults. Callers still pass limits explicitly. */
export const DEFAULT_OWNERSHIP_DISCOVER_LIMITS = {
  maxGroups: 2_000,
  maxSnippetLines: 300,
  maxContextBytes: 64_000,
  maxContextFiles: 8,
} as const

export interface OwnershipDiscoverLimits {
  readonly maxGroups: number
  readonly maxSnippetLines: number
  readonly maxContextBytes: number
  readonly maxContextFiles?: number
  readonly maxSourceFilesScanned?: number
  readonly maxSourceFileBytes?: number
  readonly maxImportSpecifiersPerFile?: number
  readonly maxOmittedListed?: number
  readonly include?: ReadonlyArray<string>
  readonly exclude?: ReadonlyArray<string>
}

export interface OwnershipDiscoverInput {
  readonly repoRoot: string
  readonly signalResults: ReadonlyArray<SignalRunResultLike>
  readonly limits: OwnershipDiscoverLimits
}

export interface ProposedOwnershipMemberSelector {
  readonly file: string
  readonly name: string
  readonly startLine: number
  readonly endLine: number
}

export interface ProposedOwnershipGroup {
  readonly id: string
  readonly origin: "detector_proposed"
  readonly owner_paths: ReadonlyArray<string>
  readonly caller_paths: ReadonlyArray<string>
  readonly context_paths: ReadonlyArray<string>
  readonly description: string
  readonly member_selectors: ReadonlyArray<ProposedOwnershipMemberSelector>
  readonly detector: {
    readonly signalId: string
    readonly groupKind: string
    readonly structuralHash: string
    readonly tokenCount: number
    readonly memberCount: number
    readonly cloneGroupIds: ReadonlyArray<string>
  }
  readonly limitations: ReadonlyArray<string>
}

export interface OwnershipInventoryCoverage {
  readonly complete: boolean
  readonly coversWholeRepo: boolean
  readonly covers_all_domain_rules: false
  readonly declared_scope: {
    readonly include: ReadonlyArray<string>
    readonly exclude: ReadonlyArray<string>
    readonly scoped: boolean
    readonly inScopeGroups: number
    readonly outOfScopeCount: number
  }
  readonly clone: {
    readonly signalId: string
    readonly present: boolean
    readonly malformed: boolean
    readonly groupsAvailable: number | null
    readonly diagnosticLimit: number | null
    readonly groupsBeyondDiagnosticLimit: number | null
  }
  readonly selectedGroups: number
  readonly omittedCount: number
  readonly identicalMemberSetsMerged: number
  readonly overlappingDistinctGroups: number
  readonly rejected: ReadonlyArray<{ readonly id: string; readonly file: string; readonly reason: string }>
  readonly omitted: ReadonlyArray<{ readonly id: string; readonly reason: string }>
  readonly context: { readonly clippedGroups: number; readonly omittedPointers: number }
  readonly sourceScan: {
    readonly filesScanned: number
    readonly filesSkipped: number
    readonly filesSizeCapped: number
    readonly filesUnreadable: number
    readonly importSpecifierCaps: number
    readonly unresolvedImportSpecifiers: number
    readonly truncated: boolean
  }
  readonly limits: OwnershipDiscoverLimits
}

export interface OwnershipKnownGap {
  readonly id: string
  readonly detail: string
}

export interface OwnershipInventoryProposal {
  readonly schema: typeof OWNERSHIP_INVENTORY_PROPOSAL_SCHEMA
  readonly adopted: false
  readonly policy_action: "none"
  readonly origin: "detector_proposed"
  readonly groups: ReadonlyArray<ProposedOwnershipGroup>
  readonly coverage: OwnershipInventoryCoverage
  readonly limitations: ReadonlyArray<string>
  readonly known_gaps: ReadonlyArray<OwnershipKnownGap>
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
const asArray = (value: unknown): ReadonlyArray<unknown> => (Array.isArray(value) ? value : [])
const asString = (value: unknown): string | null => (typeof value === "string" ? value : null)
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null
const asPositiveInt = (value: unknown): number | null => {
  const number = asNumber(value)
  return number === null || !Number.isInteger(number) || number < 1 ? null : number
}
const compareStrings = (left: string, right: string): number => (left === right ? 0 : left < right ? -1 : 1)
const sha16 = (value: string): string => createHash("sha256").update(value).digest("hex").slice(0, 16)
const uniqueSorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)].sort(compareStrings)

const cloneSignalOf = (signals: ReadonlyArray<SignalRunResultLike>): SignalRunResultLike | undefined =>
  signals.find((signal) => signal.signalId === CLONE_OWNERSHIP_SIGNAL_ID) ??
  signals.find((signal) => signal.signalId === CLONE_SIGNAL_ALIAS)

type RawCloneMember = {
  readonly file: string
  readonly name: string
  readonly startLine: number
  readonly endLine: number
}

const memberIdentity = (member: { readonly file: string; readonly startLine: number; readonly endLine: number }): string =>
  `${member.file}:${member.startLine}-${member.endLine}`

const memberSetKey = (
  members: ReadonlyArray<{ readonly file: string; readonly startLine: number; readonly endLine: number }>,
): string => [...members.map(memberIdentity)].sort(compareStrings).join("|")

const mergeKinds = (left: string, right: string): string =>
  uniqueSorted([...left.split("+"), ...right.split("+")].filter((part) => part.length > 0)).join("+")

const parseCloneMembers = (value: unknown): ReadonlyArray<RawCloneMember> | null => {
  const members = asArray(value).flatMap((entry) => {
    const record = asRecord(entry)
    if (record === null) return []
    const file = asString(record["file"])
    const startLine = asPositiveInt(record["startLine"])
    const endLine = asPositiveInt(record["endLine"])
    if (file === null || startLine === null || endLine === null || endLine < startLine) return []
    return [{ file, name: asString(record["name"]) ?? "", startLine, endLine }]
  })
  return members.length === asArray(value).length && members.length >= 2 ? members : null
}

type RawCloneMeta = {
  readonly groupId: string
  readonly kind: string
  readonly structuralHash: string
  readonly tokenCount: number
  readonly members: ReadonlyArray<RawCloneMember>
}

type CloneMetaIndex = {
  readonly byMemberKey: ReadonlyMap<string, RawCloneMeta>
  readonly byGroupId: ReadonlyMap<string, RawCloneMeta>
}

const indexCloneMeta = (output: unknown): CloneMetaIndex => {
  const groups = asArray(asRecord(output)?.["groups"])
  const byMemberKey = new Map<string, RawCloneMeta>()
  const byGroupId = new Map<string, RawCloneMeta>()
  for (const [index, raw] of groups.entries()) {
    const group = asRecord(raw)
    const members = group === null ? null : parseCloneMembers(group["members"])
    if (group === null || members === null) continue
    const meta: RawCloneMeta = {
      groupId: asString(group["groupId"]) ?? `index-${index}`,
      kind: asString(group["kind"]) ?? "unknown",
      structuralHash: asString(group["structuralHash"]) ?? "",
      tokenCount: asNumber(group["tokenCount"]) ?? 0,
      members,
    }
    byGroupId.set(meta.groupId, meta)
    const key = memberSetKey(members)
    const existing = byMemberKey.get(key)
    if (existing === undefined) {
      byMemberKey.set(key, meta)
      continue
    }
    byMemberKey.set(key, {
      ...existing,
      kind: mergeKinds(existing.kind, meta.kind),
      structuralHash: existing.structuralHash.length > 0 ? existing.structuralHash : meta.structuralHash,
      tokenCount: Math.max(existing.tokenCount, meta.tokenCount),
    })
  }
  return { byMemberKey, byGroupId }
}

const nameFor = (meta: RawCloneMeta | undefined, file: string, startLine: number, endLine: number): string =>
  meta?.members.find((member) => member.file === file && member.startLine === startLine && member.endLine === endLine)?.name ??
  ""

const toSelector = (
  member: { readonly file: string; readonly startLine: number; readonly endLine: number },
  meta: RawCloneMeta | undefined,
): ProposedOwnershipMemberSelector => ({
  file: member.file,
  name: nameFor(meta, member.file, member.startLine, member.endLine),
  startLine: member.startLine,
  endLine: member.endLine,
})

const proposedId = (memberKey: string): string => `own:${sha16(memberKey)}`

const describeGroup = (kind: string, memberCount: number): string =>
  `Detector-proposed clone obligation (${kind || "unknown"}) with ${memberCount} candidate implementations. ` +
  "owner_paths is empty; caller_paths are unresolved candidate implementations, not confirmed callers or a shared rule. " +
  "Adoption copies id, owner_paths, caller_paths, context_paths, description, and origin:\"declared\" into .pulsar/ownership.json; the rest of this object is detector evidence, not policy."

const KNOWN_GAPS: ReadonlyArray<OwnershipKnownGap> = [
  {
    id: NONCLONED_GAP_ID,
    detail:
      "Automatic clone scan cannot propose already-shared non-cloned rules. Completeness is this detector sample under the declared scope, not every domain obligation in the repository.",
  },
  {
    id: DETECTOR_ID_GAP_ID,
    detail:
      "Proposal ids hash the current member set. They are stable across checkouts of the same members, but rediscovery after extraction or edits may omit or re-key the group. Reassessment after adoption uses the saved ownership.json group id and its caller_paths, not a freshly regenerated detector id.",
  },
]

const isContextLimitation = (entry: string): boolean => entry.startsWith("context_")

const overlappingCount = (keys: ReadonlyArray<string>): number => {
  const tokenSets = keys.map((key) => new Set(key.split("|").filter((part) => part.length > 0)))
  let count = 0
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) {
      const other = tokenSets[right]!
      if ([...tokenSets[left]!].some((token) => other.has(token))) count += 1
    }
  }
  return count
}

const toDiscoveryLimits = (limits: OwnershipDiscoverLimits): DiscoveryLimits => ({
  maxCandidates: limits.maxGroups,
  maxSnippetLines: limits.maxSnippetLines,
  maxContextBytes: limits.maxContextBytes,
  ...(limits.maxContextFiles === undefined ? {} : { maxContextFiles: limits.maxContextFiles }),
  ...(limits.maxSourceFilesScanned === undefined ? {} : { maxSourceFilesScanned: limits.maxSourceFilesScanned }),
  ...(limits.maxSourceFileBytes === undefined ? {} : { maxSourceFileBytes: limits.maxSourceFileBytes }),
  ...(limits.maxImportSpecifiersPerFile === undefined ? {} : { maxImportSpecifiersPerFile: limits.maxImportSpecifiersPerFile }),
  ...(limits.maxOmittedListed === undefined ? {} : { maxOmittedListed: limits.maxOmittedListed }),
  ...(limits.include === undefined ? {} : { include: limits.include }),
  ...(limits.exclude === undefined ? {} : { exclude: limits.exclude }),
})

type DraftGroup = {
  readonly memberKey: string
  readonly group: ProposedOwnershipGroup
}

const metaFor = (candidate: SemanticCandidate, index: CloneMetaIndex): RawCloneMeta | undefined => {
  const byMembers = index.byMemberKey.get(memberSetKey(candidate.members))
  if (byMembers !== undefined) return byMembers
  const groupId = typeof candidate.facts["groupId"] === "string" ? candidate.facts["groupId"] : null
  return groupId === null ? undefined : index.byGroupId.get(groupId)
}

const draftFromCandidate = (
  candidate: SemanticCandidate,
  meta: RawCloneMeta | undefined,
  signalId: string,
): DraftGroup => {
  const selectors = [...candidate.members.map((member) => toSelector(member, meta))]
    .sort((left, right) => compareStrings(left.file, right.file) || left.startLine - right.startLine || compareStrings(left.name, right.name))
  const memberKey = memberSetKey(selectors)
  const caller_paths = uniqueSorted(selectors.map((selector) => selector.file))
  const context_paths = uniqueSorted(
    candidate.context.map((pointer) => pointer.file).filter((file) => !caller_paths.includes(file)),
  )
  const kind = typeof candidate.facts["groupKind"] === "string" ? candidate.facts["groupKind"] : meta?.kind ?? "unknown"
  const structuralHash = meta?.structuralHash ?? ""
  const tokenCount = typeof candidate.facts["tokenCount"] === "number" ? candidate.facts["tokenCount"] : meta?.tokenCount ?? 0
  const cloneGroupId = typeof candidate.facts["groupId"] === "string" ? candidate.facts["groupId"] : meta?.groupId
  return {
    memberKey,
    group: {
      id: proposedId(memberKey),
      origin: "detector_proposed",
      owner_paths: [],
      caller_paths,
      context_paths,
      description: describeGroup(kind, selectors.length),
      member_selectors: selectors,
      detector: {
        signalId,
        groupKind: kind,
        structuralHash,
        tokenCount,
        memberCount: selectors.length,
        cloneGroupIds: cloneGroupId === undefined ? [] : [cloneGroupId],
      },
      limitations: [...candidate.limitations],
    },
  }
}

const mergeDrafts = (left: DraftGroup, right: DraftGroup): DraftGroup => {
  const kinds = mergeKinds(left.group.detector.groupKind, right.group.detector.groupKind)
  const selectors = left.group.member_selectors
  return {
    memberKey: left.memberKey,
    group: {
      ...left.group,
      context_paths: uniqueSorted([...left.group.context_paths, ...right.group.context_paths]),
      description: describeGroup(kinds, selectors.length),
      detector: {
        ...left.group.detector,
        groupKind: kinds,
        structuralHash: left.group.detector.structuralHash.length > 0
          ? left.group.detector.structuralHash
          : right.group.detector.structuralHash,
        tokenCount: Math.max(left.group.detector.tokenCount, right.group.detector.tokenCount),
        cloneGroupIds: uniqueSorted([...left.group.detector.cloneGroupIds, ...right.group.detector.cloneGroupIds]),
      },
      limitations: uniqueSorted([...left.group.limitations, ...right.group.limitations]),
    },
  }
}

/** Core policy fields only. Detector evidence stays off the adopted group. */
export const adoptableOwnershipGroup = (group: ProposedOwnershipGroup): {
  readonly id: string
  readonly owner_paths: ReadonlyArray<string>
  readonly caller_paths: ReadonlyArray<string>
  readonly context_paths: ReadonlyArray<string>
  readonly description: string
  readonly origin: "declared"
} => ({
  id: group.id,
  owner_paths: group.owner_paths,
  caller_paths: group.caller_paths,
  context_paths: group.context_paths,
  description: group.description,
  origin: "declared",
})

/**
 * Build a detector-proposed ownership inventory. Does not adopt policy, declare a
 * shared rule, or infer owners from imports.
 */
export const proposeOwnershipInventory = (input: OwnershipDiscoverInput): OwnershipInventoryProposal => {
  const cloneSignal = cloneSignalOf(input.signalResults)
  const normalizedClone = cloneSignal === undefined
    ? undefined
    : { ...cloneSignal, signalId: CLONE_OWNERSHIP_SIGNAL_ID }
  const discovery = collectSemanticCandidates(
    input.repoRoot,
    normalizedClone === undefined ? [] : [normalizedClone],
    toDiscoveryLimits(input.limits),
  )
  const metaIndex = indexCloneMeta(cloneSignal?.output)
  const drafts: Array<DraftGroup> = []
  let identicalMemberSetsMerged = discovery.coverage.duplicatesRemoved
  for (const candidate of discovery.candidates.filter((entry) => entry.kind === "clone-group")) {
    const draft = draftFromCandidate(
      candidate,
      metaFor(candidate, metaIndex),
      CLONE_OWNERSHIP_SIGNAL_ID,
    )
    const index = drafts.findIndex((entry) => entry.memberKey === draft.memberKey)
    if (index === -1) {
      drafts.push(draft)
      continue
    }
    identicalMemberSetsMerged += 1
    drafts[index] = mergeDrafts(drafts[index]!, draft)
  }
  const groups = drafts
    .map((entry) => entry.group)
    .sort((left, right) =>
      compareStrings(left.caller_paths[0] ?? "", right.caller_paths[0] ?? "") ||
      (left.member_selectors[0]?.startLine ?? 0) - (right.member_selectors[0]?.startLine ?? 0) ||
      compareStrings(left.id, right.id)
    )

  const cloneOutput = asRecord(cloneSignal?.output)
  const groupsAvailable = cloneSignal === undefined ? null : asArray(cloneOutput?.["groups"]).length
  const diagnosticLimit = cloneOutput === null ? null : asNumber(cloneOutput["diagnosticLimit"])
  const cloneEntry = discovery.coverage.signals.find((entry) => entry.signalId === CLONE_OWNERSHIP_SIGNAL_ID)
  const present = cloneSignal !== undefined
  const malformed = cloneEntry?.malformed === true || (present && cloneOutput === null)
  const contextClipped = groups.filter((group) => group.limitations.some(isContextLimitation)).length
  const contextOmitted = groups.reduce(
    (total, group) =>
      total + group.limitations.reduce((inner, entry) => {
        const omitted = /^context_clipped_by_\w+:omitted=(\d+)$/u.exec(entry)
        return inner + (omitted === null ? 0 : Number(omitted[1]))
      }, 0),
    0,
  )
  const scan = discovery.coverage.sourceScan
  const emptyCloneInventory = present && !malformed && groupsAvailable === 0
  const limitations = [
    ...discovery.coverage.limitations.filter((entry) =>
      !entry.includes("TS-LD-01-cyclomatic-complexity") &&
      !entry.startsWith("function_extent") &&
      entry !== "no_in_scope_candidate_evidence"
    ),
    ...(identicalMemberSetsMerged > 0 ? [`identical_member_sets_merged=${identicalMemberSetsMerged}`] : []),
    ...(emptyCloneInventory ? ["empty_clone_inventory"] : []),
  ]
  const complete = present && !malformed &&
    !emptyCloneInventory &&
    discovery.coverage.omittedCount === 0 &&
    discovery.coverage.rejected.length === 0 &&
    !scan.truncated &&
    scan.filesSizeCapped === 0 &&
    scan.filesUnreadable === 0 &&
    scan.importSpecifierCaps === 0 &&
    !discovery.coverage.limitations.some((entry) => entry.startsWith("workspace_package_index_truncated_at=")) &&
    groups.every((group) => group.limitations.length === 0)

  return {
    schema: OWNERSHIP_INVENTORY_PROPOSAL_SCHEMA,
    adopted: false,
    policy_action: "none",
    origin: "detector_proposed",
    groups,
    coverage: {
      complete,
      coversWholeRepo: complete && !discovery.coverage.scope.scoped,
      covers_all_domain_rules: false,
      declared_scope: {
        include: input.limits.include ?? [],
        exclude: input.limits.exclude ?? [],
        scoped: discovery.coverage.scope.scoped,
        inScopeGroups: drafts.length + identicalMemberSetsMerged,
        outOfScopeCount: discovery.coverage.scope.outOfScopeCount,
      },
      clone: {
        signalId: CLONE_OWNERSHIP_SIGNAL_ID,
        present,
        malformed,
        groupsAvailable,
        diagnosticLimit,
        groupsBeyondDiagnosticLimit: diagnosticLimit === null || groupsAvailable === null
          ? null
          : Math.max(0, groupsAvailable - diagnosticLimit),
      },
      selectedGroups: groups.length,
      omittedCount: discovery.coverage.omittedCount,
      identicalMemberSetsMerged,
      overlappingDistinctGroups: overlappingCount(drafts.map((entry) => entry.memberKey)),
      rejected: discovery.coverage.rejected.map((entry) => ({ id: entry.id, file: entry.file, reason: entry.reason })),
      omitted: discovery.coverage.omitted.map((entry) => ({ id: entry.id, reason: entry.reason })),
      context: { clippedGroups: contextClipped, omittedPointers: contextOmitted },
      sourceScan: {
        filesScanned: scan.filesScanned,
        filesSkipped: scan.filesSkipped,
        filesSizeCapped: scan.filesSizeCapped,
        filesUnreadable: scan.filesUnreadable,
        importSpecifierCaps: scan.importSpecifierCaps,
        unresolvedImportSpecifiers: scan.unresolvedImportSpecifiers,
        truncated: scan.truncated,
      },
      limits: input.limits,
    },
    limitations,
    known_gaps: KNOWN_GAPS,
  }
}
