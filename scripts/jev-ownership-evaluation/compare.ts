import type { OwnershipGroupAssessment } from "../../packages/cli/src/jev/index.ts"
import { expectationOf } from "./expectations.ts"
import { ANCHOR_VALUES, aggregateOwnershipAttainment, comparisonVersusTarget } from "./host-score.ts"
import type { LiveArm } from "./requests.ts"
import type { HostGroupLabel, SealedExpectation } from "./types.ts"

export interface CallOutcome {
  readonly runId: string
  readonly caseId: string
  readonly obligationId: string
  readonly arrangement: string
  readonly preference: LiveArm["preference"]
  readonly perturbation: LiveArm["perturbation"]
  readonly repeat: number
  readonly status: OwnershipGroupAssessment["status"]
  readonly selectedAnchorId: string
  readonly rawSelectedAnchorId: string
  readonly gatePassed: boolean
  readonly winnerProbability: number
  readonly margin: number
  readonly modelConfidence: number
  readonly distribution: ReadonlyArray<{ readonly anchorId: string; readonly probability: number }>
  readonly inputTokens: number
  readonly outputTokens: number
  readonly elapsedMs: number
  readonly requestId: string | null
  readonly requestSha256: string
  readonly modelId: string
  readonly promptId: string
  readonly promptFingerprint: string
  readonly expected: Pick<SealedExpectation, "status" | "anchor" | "hostValue">
  readonly match: boolean
  readonly mismatchKind: "none" | "status" | "anchor" | "host_value"
}

const hostValueOf = (assessment: OwnershipGroupAssessment): number | null => {
  if (assessment.status !== "resolved") return null
  if (assessment.selectedAnchorId === "contrary") return ANCHOR_VALUES.contrary
  if (assessment.selectedAnchorId === "mixed") return ANCHOR_VALUES.mixed
  if (assessment.selectedAnchorId === "meets") return ANCHOR_VALUES.meets
  if (assessment.selectedAnchorId === "exceeds") return 1.2
  return null
}

export const toHostLabel = (assessment: OwnershipGroupAssessment): HostGroupLabel => {
  if (assessment.status === "not_applicable") {
    return { groupId: assessment.groupId, status: "not_applicable" }
  }
  if (assessment.status !== "resolved") {
    return { groupId: assessment.groupId, status: "unresolved" }
  }
  const value = hostValueOf(assessment)
  if (value === null) return { groupId: assessment.groupId, status: "unresolved" }
  return {
    groupId: assessment.groupId,
    status: "resolved",
    anchorId: assessment.selectedAnchorId,
    anchorValue: value,
  }
}

export const outcomeOf = (arm: LiveArm, assessment: OwnershipGroupAssessment): CallOutcome => {
  const expected = expectationOf(arm.caseId, arm.preference)
  const actualValue = hostValueOf(assessment)
  let mismatchKind: CallOutcome["mismatchKind"] = "none"
  if (assessment.status !== expected.status) mismatchKind = "status"
  else if (expected.status === "resolved" && assessment.selectedAnchorId !== expected.anchor) {
    mismatchKind = "anchor"
  } else if (expected.status === "resolved" && actualValue !== expected.hostValue) {
    mismatchKind = "host_value"
  } else if (expected.status === "not_applicable" && assessment.status !== "not_applicable") {
    mismatchKind = "status"
  } else if (expected.status === "unresolved" && assessment.status !== "unresolved") {
    mismatchKind = "status"
  }
  return {
    runId: arm.runId,
    caseId: arm.caseId,
    obligationId: arm.obligationId,
    arrangement: arm.arrangement,
    preference: arm.preference,
    perturbation: arm.perturbation,
    repeat: arm.repeat,
    status: assessment.status,
    selectedAnchorId: assessment.selectedAnchorId,
    rawSelectedAnchorId: assessment.rawSelectedAnchorId,
    gatePassed: assessment.selectionGate.passed,
    winnerProbability: assessment.selectionGate.winnerProbability,
    margin: assessment.selectionGate.margin,
    modelConfidence: assessment.modelConfidence,
    distribution: assessment.distribution.map((entry) => ({
      anchorId: entry.anchorId,
      probability: entry.probability,
    })),
    inputTokens: assessment.usage.inputTokens,
    outputTokens: assessment.usage.outputTokens,
    elapsedMs: assessment.elapsedMs,
    requestId: assessment.requestId,
    requestSha256: assessment.requestSha256,
    modelId: assessment.modelId,
    promptId: assessment.promptId,
    promptFingerprint: assessment.promptFingerprint,
    expected: {
      status: expected.status,
      anchor: expected.anchor,
      hostValue: expected.hostValue,
    },
    match: mismatchKind === "none",
    mismatchKind,
  }
}

export const oppositePolicyPairs = (
  outcomes: ReadonlyArray<CallOutcome>,
): ReadonlyArray<{
  readonly caseId: string
  readonly arrangement: string
  readonly shared: CallOutcome | undefined
  readonly local: CallOutcome | undefined
  readonly flipped: boolean
}> => {
  const primary = outcomes.filter((row) => row.perturbation === "none" && row.repeat === 1)
  const ids = [...new Set(primary.map((row) => row.caseId))]
  return ids.map((caseId) => {
    const shared = primary.find((row) => row.caseId === caseId && row.preference === "shared_domain_rule")
    const local = primary.find((row) => row.caseId === caseId && row.preference === "caller_local")
    const flipped =
      shared !== undefined &&
      local !== undefined &&
      (shared.selectedAnchorId !== local.selectedAnchorId || shared.status !== local.status)
    return {
      caseId,
      arrangement: shared?.arrangement ?? local?.arrangement ?? "",
      shared,
      local,
      flipped,
    }
  })
}

export const hostFromOutcomes = (
  declaredGroupIds: ReadonlyArray<string>,
  outcomes: ReadonlyArray<CallOutcome>,
  policyPresent = true,
) => {
  const seen = new Set<string>()
  const uniqueOutcomes = outcomes.filter((row) => {
    if (seen.has(row.caseId)) return false
    seen.add(row.caseId)
    return true
  })
  const labels = uniqueOutcomes.map((row) => {
    if (row.status === "not_applicable") return { groupId: row.caseId, status: "not_applicable" as const }
    if (row.status !== "resolved") return { groupId: row.caseId, status: "unresolved" as const }
    const value =
      row.selectedAnchorId === "contrary"
        ? 0
        : row.selectedAnchorId === "mixed"
          ? 0.5
          : row.selectedAnchorId === "meets"
            ? 1
            : row.selectedAnchorId === "exceeds"
              ? 1.2
              : undefined
    if (value === undefined) return { groupId: row.caseId, status: "unresolved" as const }
    return {
      groupId: row.caseId,
      status: "resolved" as const,
      anchorId: row.selectedAnchorId,
      anchorValue: value,
    }
  })
  const aggregate = aggregateOwnershipAttainment({
    policyPresent,
    declaredGroupIds,
    labels,
    stretchDeclared: outcomes.some((row) => row.preference === "stretch-shared"),
  })
  return { aggregate, comparison: comparisonVersusTarget(aggregate) }
}


