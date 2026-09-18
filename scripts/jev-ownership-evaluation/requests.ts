/**
 * Provider-facing request construction. Does not import the sealed judgment file.
 */
import type { OwnershipGroupEvaluationInput, OwnershipRubric } from "../../packages/cli/src/jev/index.ts"
import { EVALUATION_CASES } from "./cases.ts"
import type { CaseSpec } from "./types.ts"
import {
  conflictRubric,
  localRubric,
  reverseAnchors,
  sharedRubric,
  stretchSharedRubric,
} from "./rubrics.ts"
import { PREFERENCE_LOCAL, PREFERENCE_SHARED, type PreferenceId } from "./types.ts"

export const MODEL = "jev-1.13.0"

export type LiveArm = {
  readonly runId: string
  readonly caseId: string
  readonly obligationId: string
  readonly arrangement: CaseSpec["arrangement"]
  readonly preference: PreferenceId | "conflict" | "stretch-shared"
  readonly perturbation: "none" | "anchor-order"
  readonly repeat: number
  readonly input: OwnershipGroupEvaluationInput
}

const rubricFor = (spec: CaseSpec, preference: LiveArm["preference"]): OwnershipRubric => {
  if (spec.rubricKind === "conflict" || preference === "conflict") return conflictRubric()
  if (spec.rubricKind === "stretch-shared" || preference === "stretch-shared") return stretchSharedRubric()
  if (preference === PREFERENCE_LOCAL) return localRubric()
  return sharedRubric()
}

const preferencesFor = (spec: CaseSpec): ReadonlyArray<LiveArm["preference"]> => {
  if (spec.rubricKind === "conflict") return ["conflict"]
  if (spec.rubricKind === "stretch-shared") return ["stretch-shared"]
  if (spec.rubricKind === "shared") return [PREFERENCE_SHARED]
  if (spec.rubricKind === "local") return [PREFERENCE_LOCAL]
  return [PREFERENCE_SHARED, PREFERENCE_LOCAL]
}

const toInput = (
  spec: CaseSpec,
  preference: LiveArm["preference"],
  rubric: OwnershipRubric,
  groupId: string,
): OwnershipGroupEvaluationInput => ({
  groupId,
  sources: spec.sources.map((source) => ({
    path: source.path,
    bytes: source.bytes,
    role: source.role,
  })),
  rubric,
  model: MODEL,
})

/**
 * Independent live matrix. Opaque group ids only. Repeats and one anchor-order
 * perturbation on copy and distinct-domain arrangements.
 */
export const buildLiveArms = (): ReadonlyArray<LiveArm> => {
  const arms: Array<LiveArm> = []
  for (const spec of EVALUATION_CASES) {
    for (const preference of preferencesFor(spec)) {
      const repeats =
        spec.arrangement === "distinct-domain-same-shape" ||
        spec.arrangement === "ambiguous-identity" ||
        spec.arrangement === "missing-implementation" ||
        spec.arrangement === "conflicting-preference-text" ||
        spec.arrangement === "extracted-over-distinct" ||
        spec.arrangement === "identical-copies" ||
        spec.arrangement === "delegated-owner"
          ? 3
          : 2
      for (let repeat = 1; repeat <= repeats; repeat++) {
        const rubric = rubricFor(spec, preference)
        arms.push({
          runId: `${spec.id}:${preference}:r${repeat}`,
          caseId: spec.id,
          obligationId: spec.obligationId,
          arrangement: spec.arrangement,
          preference,
          perturbation: "none",
          repeat,
          input: toInput(spec, preference, rubric, spec.id),
        })
      }
      if (
        spec.arrangement === "identical-copies" ||
        spec.arrangement === "distinct-domain-same-shape" ||
        spec.arrangement === "mixed-copy-and-delegate"
      ) {
        arms.push({
          runId: `${spec.id}:${preference}:anchors-reversed`,
          caseId: spec.id,
          obligationId: spec.obligationId,
          arrangement: spec.arrangement,
          preference,
          perturbation: "anchor-order",
          repeat: 1,
          input: toInput(spec, preference, reverseAnchors(rubricFor(spec, preference)), spec.id),
        })
      }
    }
  }
  return arms
}

export const FORBIDDEN_REQUEST_KEYS = [
  "reference_label",
  "referenceLabel",
  "expected_direction",
  "expectedDirection",
  "expected_answer",
  "expectedAnswer",
  "fixture_id",
  "fixtureId",
  "split",
  "proposedExpectations",
  "annotator",
  "prior_model_outputs",
  "aggregate_score",
  "api_key",
  "credentials",
] as const
