/**
 * Evaluation host scoring is the canonical core aggregator.
 * Do not reimplement min-attainment here.
 */
import {
  aggregateOwnershipAttainment,
  type OwnershipAggregate,
  type OwnershipGroup,
  type OwnershipLabelValue,
  type OwnershipPolicy,
} from "../../packages/core/src/ownership.ts"
import { PREFERENCE_SHARED, type PreferenceId } from "./types.ts"

export const ANCHOR_VALUES = {
  contrary: 0,
  mixed: 0.5,
  meets: 1,
  exceeds: 1.2,
} as const

export const CORE_ANCHORS: OwnershipPolicy["anchors"] = [
  { id: "contrary", value: 0, description: "Contrary to the declared preference." },
  { id: "mixed", value: 0.5, description: "Partial alignment with the declared preference." },
  { id: "meets", value: 1, description: "Meets the declared preference." },
]

export const CORE_STRETCH_ANCHORS: OwnershipPolicy["anchors"] = [
  ...CORE_ANCHORS,
  { id: "exceeds", value: 1.2, description: "Positively evidenced stretch requirement." },
]

export type EvaluationHostLabel = {
  readonly groupId: string
  readonly status: "resolved" | "unresolved" | "not_applicable"
  readonly anchorId?: string
  readonly anchorValue?: number
}

const placeholderGroup = (id: string): OwnershipGroup => ({
  id,
  owner_paths: [`src/${id}-owner.ts`],
  caller_paths: [`src/${id}-caller.ts`],
})

const distributionFor = (label: EvaluationHostLabel): OwnershipLabelValue["distribution"] => {
  if (label.status === "unresolved") {
    return [{ anchor_id: "unknown", probability: 1, selected: true }]
  }
  if (label.status === "not_applicable") {
    return [{ anchor_id: "not_applicable", probability: 1, selected: true }]
  }
  const anchorId = label.anchorId
  if (anchorId === undefined) {
    return [{ anchor_id: "unknown", probability: 1, selected: true }]
  }
  return [{ anchor_id: anchorId, anchor_value: label.anchorValue, probability: 1, selected: true }]
}

export const toOwnershipLabelValue = (label: EvaluationHostLabel): OwnershipLabelValue => ({
  schema_version: "pulsar.ownership_label.v1",
  group_id: label.groupId,
  policy_fingerprint: "sha256:evaluation-fixture",
  rubric_fingerprint: "sha256:evaluation-fixture",
  status: label.status,
  distribution: distributionFor(label),
  ...(label.status === "resolved" && label.anchorId !== undefined && label.anchorValue !== undefined
    ? { anchor_id: label.anchorId as "contrary" | "mixed" | "meets" | "exceeds", anchor_value: label.anchorValue }
    : {}),
})

export const coreAggregateInput = (input: {
  readonly preference?: PreferenceId
  readonly declaredGroupIds: ReadonlyArray<string>
  readonly labels: ReadonlyArray<EvaluationHostLabel>
  readonly stretchDeclared?: boolean
  readonly inventoryComplete?: boolean
  readonly validityState?: "fresh" | "expired"
}): Parameters<typeof aggregateOwnershipAttainment>[0] => ({
  preference: input.preference ?? PREFERENCE_SHARED,
  target: 1,
  anchors: input.stretchDeclared === true ? CORE_STRETCH_ANCHORS : CORE_ANCHORS,
  groups: input.declaredGroupIds.map(placeholderGroup),
  labels: input.labels.map(toOwnershipLabelValue),
  inventoryComplete: input.inventoryComplete ?? true,
  validityState: input.validityState ?? "fresh",
})

/** Canonical product arithmetic. Thin mapping only. */
export const aggregateEvaluationLabels = (
  input: Parameters<typeof coreAggregateInput>[0],
): OwnershipAggregate => aggregateOwnershipAttainment(coreAggregateInput(input))

export const comparisonVersusTarget = (
  aggregate: OwnershipAggregate,
): "below" | "meets" | "exceeds" | "abstain" => {
  if (aggregate.applicability !== "applicable" || aggregate.attainment === undefined) return "abstain"
  if (aggregate.attainment < aggregate.target) return "below"
  if (aggregate.attainment > aggregate.target) return "exceeds"
  return "meets"
}

export { aggregateOwnershipAttainment }
export type { OwnershipAggregate }
