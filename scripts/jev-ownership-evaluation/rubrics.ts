import type { OwnershipAnchorSpec, OwnershipRubric } from "../../packages/cli/src/jev/index.ts"
import { PREFERENCE_LOCAL, PREFERENCE_SHARED, type PreferenceId } from "./types.ts"

/**
 * ADVERSARIAL / CONFLICTING RUBRIC INPUT — NOT PRODUCTION WORDING.
 *
 * These option descriptions name both policies' defects in one contrary
 * string and a preference-agnostic meets string. The frozen 101-call
 * series (receipts-1789721468958.json) used this input to measure what
 * happens when the host supplies mixed contrary/meets text.
 *
 * Production judge / `.pulsar/ownership.json` anchors must be
 * preference-conditioned (see followup.ts). Do not copy STANDARD_ANCHORS
 * into shipped policy. Do not bump Jev promptId for this; compile already
 * forwards rubric.anchors verbatim.
 */
const contrary: OwnershipAnchorSpec = {
  id: "contrary",
  value: 0,
  description:
    "The snapshots implement the opposite of the repository preference: a shared rule is independently copied, or a caller-local rule is extracted to a shared owner.",
}

const mixed: OwnershipAnchorSpec = {
  id: "mixed",
  value: 0.5,
  description:
    "Some sites follow the preference and some do not. One caller delegates while another copies, or ownership is only partial.",
}

const meets: OwnershipAnchorSpec = {
  id: "meets",
  value: 1,
  description:
    "Every supplied implementation site follows the repository preference for this obligation.",
}

const exceeds: OwnershipAnchorSpec = {
  id: "exceeds",
  value: 1.2,
  description:
    "The snapshots positively evidence the separately declared stretch requirement, not merely the absence of violations.",
}

export const STANDARD_ANCHORS: ReadonlyArray<OwnershipAnchorSpec> = [contrary, mixed, meets]

export const STRETCH_ANCHORS: ReadonlyArray<OwnershipAnchorSpec> = [contrary, mixed, meets, exceeds]

export const PREFERENCE_DESCRIPTION: Record<PreferenceId, string> = {
  [PREFERENCE_SHARED]:
    "When two or more sites implement the same domain rule, this repository requires one authoritative owner. Independently copied implementations of that rule are contrary. Distinct domain rules with similar shape are a different obligation, not a shared-rule violation.",
  [PREFERENCE_LOCAL]:
    "A caller may implement its own rule. Duplication is tolerated. Extracting a shared owner when callers already own the rule is contrary. Distinct domain rules remain separately owned.",
}

export const CONFLICT_DESCRIPTION =
  "This repository requires one exclusive shared owner for any similar predicate, and it also requires that every caller keep an exclusive local copy and never delegate. Both requirements apply at once."

export const STRETCH_REQUIREMENT =
  "Stretch requires a documented extraction note in the owner module plus an independent behavioral test that names both former copy sites. Absence of copies is not stretch."

export const sharedRubric = (anchors = STANDARD_ANCHORS): OwnershipRubric => ({
  preference: PREFERENCE_SHARED,
  preferenceDescription: PREFERENCE_DESCRIPTION[PREFERENCE_SHARED],
  anchors: [...anchors],
})

export const localRubric = (anchors = STANDARD_ANCHORS): OwnershipRubric => ({
  preference: PREFERENCE_LOCAL,
  preferenceDescription: PREFERENCE_DESCRIPTION[PREFERENCE_LOCAL],
  anchors: [...anchors],
})

export const conflictRubric = (): OwnershipRubric => ({
  preference: "conflicted_exclusive_rules",
  preferenceDescription: CONFLICT_DESCRIPTION,
  anchors: [...STANDARD_ANCHORS],
})

export const stretchSharedRubric = (): OwnershipRubric => ({
  preference: PREFERENCE_SHARED,
  preferenceDescription: PREFERENCE_DESCRIPTION[PREFERENCE_SHARED],
  anchors: [...STRETCH_ANCHORS],
  stretchRequirement: STRETCH_REQUIREMENT,
})

export const reverseAnchors = (
  rubric: OwnershipRubric,
): OwnershipRubric => ({
  ...rubric,
  anchors: [...rubric.anchors].reverse(),
})
