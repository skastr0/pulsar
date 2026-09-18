import type { HostAggregate, HostApplicability, HostGroupLabel } from "./types.ts"

export const ANCHOR_VALUES = {
  contrary: 0,
  mixed: 0.5,
  meets: 1,
} as const

export interface HostScoreInput {
  readonly policyPresent: boolean
  readonly declaredGroupIds: ReadonlyArray<string>
  readonly labels: ReadonlyArray<HostGroupLabel>
  readonly stretchDeclared?: boolean
}

const unique = (ids: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const out: Array<string> = []
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`duplicate group_id ${id}`)
    seen.add(id)
    out.push(id)
  }
  return out
}

export const aggregateOwnershipAttainment = (input: HostScoreInput): HostAggregate => {
  const declared = unique(input.declaredGroupIds)
  const labelsById = new Map<string, HostGroupLabel>()
  for (const label of input.labels) {
    if (labelsById.has(label.groupId)) throw new Error(`duplicate group_id ${label.groupId}`)
    labelsById.set(label.groupId, label)
  }
  if (!input.policyPresent) {
    return {
      applicability: "not_configured",
      attainment: undefined,
      observedAttainment: undefined,
      target: 1,
      score: undefined,
      histogram: {},
      resolvedGroupIds: [],
      unresolvedGroupIds: [],
      notApplicableGroupIds: [],
      missingGroupIds: declared,
    }
  }

  const resolvedGroupIds: Array<string> = []
  const unresolvedGroupIds: Array<string> = []
  const notApplicableGroupIds: Array<string> = []
  const missingGroupIds: Array<string> = []
  const histogram: Record<string, number> = {}
  const resolvedValues: Array<number> = []

  for (const groupId of declared) {
    const label = labelsById.get(groupId)
    if (label === undefined) {
      missingGroupIds.push(groupId)
      continue
    }
    if (label.status === "not_applicable") {
      notApplicableGroupIds.push(groupId)
      histogram.not_applicable = (histogram.not_applicable ?? 0) + 1
      continue
    }
    if (label.status === "unresolved") {
      unresolvedGroupIds.push(groupId)
      histogram.unresolved = (histogram.unresolved ?? 0) + 1
      continue
    }
    if (label.anchorValue === undefined || label.anchorId === undefined) {
      unresolvedGroupIds.push(groupId)
      histogram.unresolved = (histogram.unresolved ?? 0) + 1
      continue
    }
    if (label.anchorId === "exceeds" && input.stretchDeclared !== true) {
      unresolvedGroupIds.push(groupId)
      histogram.unresolved = (histogram.unresolved ?? 0) + 1
      continue
    }
    resolvedGroupIds.push(groupId)
    resolvedValues.push(label.anchorValue)
    histogram[label.anchorId] = (histogram[label.anchorId] ?? 0) + 1
  }

  const observedAttainment = resolvedValues.length === 0 ? undefined : Math.min(...resolvedValues)
  const incomplete =
    missingGroupIds.length > 0 || unresolvedGroupIds.length > 0
  const applicableCount = resolvedGroupIds.length + unresolvedGroupIds.length

  let applicability: HostApplicability
  if (incomplete) applicability = "insufficient_evidence"
  else if (applicableCount === 0) applicability = "not_applicable"
  else applicability = "applicable"

  if (applicability === "applicable" && observedAttainment !== undefined) {
    return {
      applicability,
      attainment: observedAttainment,
      observedAttainment,
      target: 1,
      score: Math.min(1, observedAttainment),
      histogram,
      resolvedGroupIds,
      unresolvedGroupIds,
      notApplicableGroupIds,
      missingGroupIds,
    }
  }
  return {
    applicability,
    attainment: undefined,
    observedAttainment,
    target: 1,
    score: undefined,
    histogram,
    resolvedGroupIds,
    unresolvedGroupIds,
    notApplicableGroupIds,
    missingGroupIds,
  }
}

export const comparisonVersusTarget = (
  aggregate: HostAggregate,
): "below" | "meets" | "exceeds" | "abstain" => {
  if (aggregate.applicability !== "applicable" || aggregate.attainment === undefined) return "abstain"
  if (aggregate.attainment < aggregate.target) return "below"
  if (aggregate.attainment > aggregate.target) return "exceeds"
  return "meets"
}
