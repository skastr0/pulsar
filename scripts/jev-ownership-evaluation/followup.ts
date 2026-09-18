/**
 * Follow-up ablation: preference-conditioned anchor wording.
 * Does not change sealed expectations. Isolates whether mixed contrary text
 * (copies always described as contrary) caused caller_local gate failures.
 */
import type { OwnershipGroupEvaluationInput, OwnershipRubric } from "../../packages/cli/src/jev/index.ts"
import { EVALUATION_CASES } from "./cases.ts"
import { MODEL } from "./requests.ts"
import { PREFERENCE_DESCRIPTION } from "./rubrics.ts"
import { PREFERENCE_LOCAL, PREFERENCE_SHARED, type PreferenceId } from "./types.ts"

const sharedAnchors = [
  {
    id: "contrary",
    value: 0,
    description:
      "The same domain rule is independently implemented at more than one site. Callers do not share one owner.",
  },
  {
    id: "mixed",
    value: 0.5,
    description: "At least one site copies the rule and at least one site delegates to a shared owner.",
  },
  {
    id: "meets",
    value: 1,
    description: "One owner implements the rule; every supplied caller imports that owner.",
  },
] as const

const localAnchors = [
  {
    id: "contrary",
    value: 0,
    description:
      "Callers delegate the rule to a shared owner instead of implementing it themselves. Extraction is the opposite of caller-local ownership.",
  },
  {
    id: "mixed",
    value: 0.5,
    description: "At least one caller implements the rule locally and at least one caller delegates.",
  },
  {
    id: "meets",
    value: 1,
    description:
      "Each caller implements the rule in its own module. Independent copies are allowed and are not a defect.",
  },
] as const

const rubric = (preference: PreferenceId): OwnershipRubric =>
  preference === PREFERENCE_SHARED
    ? {
        preference,
        preferenceDescription: PREFERENCE_DESCRIPTION[preference],
        anchors: [...sharedAnchors],
      }
    : {
        preference,
        preferenceDescription: PREFERENCE_DESCRIPTION[preference],
        anchors: [...localAnchors],
      }

const FOLLOWUP_ARRANGEMENTS = [
  "identical-copies",
  "delegated-owner",
  "extracted-owner",
  "three-site-copies",
  "role-tags-swapped",
] as const

export const buildConditionedAnchorArms = (): ReadonlyArray<{
  readonly runId: string
  readonly caseId: string
  readonly arrangement: string
  readonly preference: PreferenceId
  readonly input: OwnershipGroupEvaluationInput
}> => {
  const arms: Array<{
    readonly runId: string
    readonly caseId: string
    readonly arrangement: string
    readonly preference: PreferenceId
    readonly input: OwnershipGroupEvaluationInput
  }> = []
  for (const spec of EVALUATION_CASES) {
    if (!FOLLOWUP_ARRANGEMENTS.includes(spec.arrangement as (typeof FOLLOWUP_ARRANGEMENTS)[number])) continue
    for (const preference of [PREFERENCE_SHARED, PREFERENCE_LOCAL] as const) {
      for (const repeat of [1, 2] as const) {
        arms.push({
          runId: `cond:${spec.id}:${preference}:r${repeat}`,
          caseId: spec.id,
          arrangement: spec.arrangement,
          preference,
          input: {
            groupId: spec.id,
            sources: spec.sources.map((source) => ({
              path: source.path,
              bytes: source.bytes,
              role: source.role,
            })),
            rubric: rubric(preference),
            model: MODEL,
          },
        })
      }
    }
  }
  return arms
}
