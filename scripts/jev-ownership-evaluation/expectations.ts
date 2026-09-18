/**
 * Sealed judgments. Never imported by compile or request construction.
 * Each justification cites mechanical source facts from sources.ts, not model taste.
 */
import { PUBLISH_PREDICATE, SAMPLE_PREDICATE } from "./sources.ts"
import type { ExpectedAnchor, ExpectedStatus, PreferenceId, SealedExpectation } from "./types.ts"
import { PREFERENCE_LOCAL, PREFERENCE_SHARED } from "./types.ts"

const row = (
  caseId: string,
  preference: SealedExpectation["preference"],
  status: ExpectedStatus,
  anchor: ExpectedAnchor,
  hostValue: number | null,
  justification: string,
): SealedExpectation => ({ caseId, preference, status, anchor, hostValue, justification })

const copiesShared =
  `preview.ts and submit.ts each embed the identical predicate ${PUBLISH_PREDICATE}. Under shared_domain_rule that is contrary (0): two independent owners of one rule.`

const copiesLocal =
  `The same two independent copies of ${PUBLISH_PREDICATE} satisfy caller_local (meets=1): each caller may own the rule.`

const delegatedShared =
  "publish-rule.ts defines mayPublish; preview.ts and submit.ts import and call it. Under shared_domain_rule this meets (1): one owner, no second implementation."

const delegatedLocal =
  "Delegation to mayPublish is not caller-local ownership. Under caller_local this is contrary (0): callers do not implement the rule themselves."

const mixedShared =
  "preview.ts delegates to mayPublish while submit.ts embeds the same predicate. Under shared_domain_rule that is mixed (0.5): one site owns, one site clones."

const mixedLocal =
  "The same mixed arrangement under caller_local is mixed (0.5): submit.ts is local, preview.ts still delegates."

const distinctNote =
  `preview.ts embeds ${PUBLISH_PREDICATE}; sample.ts embeds a different table and ${SAMPLE_PREDICATE}. These are distinct domain rules with similar if-shape.`

export const SEALED_EXPECTATIONS: ReadonlyArray<SealedExpectation> = [
  row("g1", PREFERENCE_SHARED, "resolved", "contrary", 0, copiesShared),
  row("g1", PREFERENCE_LOCAL, "resolved", "meets", 1, copiesLocal),
  row("g2", PREFERENCE_SHARED, "resolved", "meets", 1, delegatedShared),
  row("g2", PREFERENCE_LOCAL, "resolved", "contrary", 0, delegatedLocal),
  row("g3", PREFERENCE_SHARED, "resolved", "mixed", 0.5, mixedShared),
  row("g3", PREFERENCE_LOCAL, "resolved", "mixed", 0.5, mixedLocal),
  row(
    "g4",
    PREFERENCE_SHARED,
    "not_applicable",
    "not_applicable",
    null,
    `${distinctNote} shared_domain_rule concerns one shared mapping; these snapshots positively show two unrelated obligations, so the preference does not apply.`,
  ),
  row(
    "g4",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    `${distinctNote} caller_local is satisfied: each file owns its own rule.`,
  ),
  row(
    "g5",
    PREFERENCE_SHARED,
    "resolved",
    "meets",
    1,
    "After extraction, mayPublish is the only implementation; three callers import it. The clone group is gone. shared_domain_rule is met.",
  ),
  row(
    "g5",
    PREFERENCE_LOCAL,
    "resolved",
    "contrary",
    0,
    "The same extracted owner under caller_local is contrary: callers no longer own the rule.",
  ),
  row(
    "g6",
    PREFERENCE_SHARED,
    "resolved",
    "contrary",
    0,
    "title-case/slugify/clamp/unique are unrelated helpers. They do not change that preview.ts and submit.ts still clone mayPublish. Min aggregation must remain contrary.",
  ),
  row(
    "g6",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "Padding helpers are context. The two publish callers still locally own the rule, meeting caller_local.",
  ),
  row(
    "g7a",
    PREFERENCE_SHARED,
    "resolved",
    "contrary",
    0,
    "preview/submit/audit each clone mayPublish. Overlap with g7b via submit.ts does not make this group healthier.",
  ),
  row(
    "g7a",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "Each overlapping publish caller still owns its copy, meeting caller_local.",
  ),
  row(
    "g7b",
    PREFERENCE_SHARED,
    "not_applicable",
    "not_applicable",
    null,
    "submit.ts clones publish; sample.ts owns a different sampling table. This group is not one shared publish obligation.",
  ),
  row(
    "g7b",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "Each overlapping file still implements its own predicate locally.",
  ),
  row(
    "g8",
    PREFERENCE_SHARED,
    "unresolved",
    "unknown",
    null,
    "publish-rule.ts is types only; notes.ts has no implementation. Insufficient evidence, not a healthy meet.",
  ),
  row(
    "g8",
    PREFERENCE_LOCAL,
    "unresolved",
    "unknown",
    null,
    "No caller implementation is present under caller_local either.",
  ),
  row(
    "g9",
    PREFERENCE_SHARED,
    "unresolved",
    "unknown",
    null,
    "Owner body is present but no callers are supplied, so whether the obligation is shared or copied cannot be decided.",
  ),
  row(
    "g9",
    PREFERENCE_LOCAL,
    "unresolved",
    "unknown",
    null,
    "Without callers, caller-local ownership cannot be confirmed or denied.",
  ),
  row(
    "g10",
    PREFERENCE_SHARED,
    "unresolved",
    "unknown",
    null,
    "Comments are not an implementation. Thin notes are unknown, not not_applicable.",
  ),
  row(
    "g10",
    PREFERENCE_LOCAL,
    "unresolved",
    "unknown",
    null,
    "Same notes-only snapshot remains unknown under caller_local.",
  ),
  row(
    "g11",
    PREFERENCE_SHARED,
    "unresolved",
    "unknown",
    null,
    "alphaAllowed and betaAllowed use similar gating shape but different predicates (tier/evidence vs tier/ceiling). Rule identity is not established.",
  ),
  row(
    "g11",
    PREFERENCE_LOCAL,
    "unresolved",
    "unknown",
    null,
    "Because identity is not established, caller_local cannot be scored as a meet of a named obligation.",
  ),
  row(
    "g12",
    PREFERENCE_SHARED,
    "not_applicable",
    "not_applicable",
    null,
    "Two owners (mayPublish, maySample) with distinct tables. Extraction did not create one shared rule. Asymmetric to g4: owners exist, still not one obligation.",
  ),
  row(
    "g12",
    PREFERENCE_LOCAL,
    "resolved",
    "contrary",
    0,
    "Callers delegate to owners rather than implementing locally, so caller_local is contrary.",
  ),
  row(
    "g13",
    PREFERENCE_SHARED,
    "resolved",
    "contrary",
    0,
    "Three identical copies remain contrary. Extra copies cannot raise min aggregation.",
  ),
  row(
    "g13",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "Three local copies still meet caller_local.",
  ),
  row(
    "g14",
    PREFERENCE_SHARED,
    "unresolved",
    "unknown",
    null,
    "A single local implementation without a second site does not establish sharing or a clone group.",
  ),
  row(
    "g14",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "One caller implementing its own rule meets caller_local.",
  ),
  row(
    "g15",
    PREFERENCE_SHARED,
    "resolved",
    "contrary",
    0,
    "Filing tags are swapped to owner, but both files still embed the same predicate. Host tags are not proof; arrangement is still two copies.",
  ),
  row(
    "g15",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "Swapped tags do not change that each file implements the rule locally.",
  ),
  row(
    "g16",
    PREFERENCE_SHARED,
    "resolved",
    "contrary",
    0,
    "Source order is reversed relative to g1; bytes are the same two copies.",
  ),
  row(
    "g16",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "Order perturbation must not change caller_local meet on the same copies.",
  ),
  row(
    "g17",
    PREFERENCE_SHARED,
    "not_applicable",
    "not_applicable",
    null,
    "Order-reversed g4: distinct publish vs sample predicates, still not one shared mapping.",
  ),
  row(
    "g17",
    PREFERENCE_LOCAL,
    "resolved",
    "meets",
    1,
    "Order-reversed distinct rules still meet caller_local.",
  ),
  row(
    "g18",
    PREFERENCE_SHARED,
    "resolved",
    "mixed",
    0.5,
    "Same mixed copy+delegate as g3 plus unrelated titleCase context. Padding cannot lift mixed to meets.",
  ),
  row(
    "g18",
    PREFERENCE_LOCAL,
    "resolved",
    "mixed",
    0.5,
    "Padding cannot hide the remaining delegated caller under caller_local.",
  ),
  row(
    "g19",
    "conflict",
    "unresolved",
    "unknown",
    null,
    "Preference text asserts both exclusive shared ownership and exclusive caller-local ownership. Conflicting policy is unresolved, not a forced meet.",
  ),
  row(
    "g20",
    "stretch-shared",
    "resolved",
    "meets",
    1,
    "Delegation meets shared_domain_rule. Stretch (documented extraction notes plus tests) is not evidenced in these snapshots, so do not award exceeds.",
  ),
  row(
    "g21",
    "stretch-shared",
    "resolved",
    "contrary",
    0,
    "Copies remain contrary even when a stretch requirement exists. Stretch is not a path to invent exceeds from violations.",
  ),
]

export const expectationOf = (
  caseId: string,
  preference: PreferenceId | "conflict" | "stretch-shared",
): SealedExpectation => {
  const found = SEALED_EXPECTATIONS.find(
    (entry) => entry.caseId === caseId && entry.preference === preference,
  )
  if (found === undefined) throw new Error(`missing sealed expectation ${caseId}/${preference}`)
  return found
}

export const HOST_SCENARIOS = [
  {
    id: "host-min-shortfall",
    declaredGroupIds: ["a", "b", "c"],
    labels: [
      { groupId: "a", status: "resolved" as const, anchorId: "meets", anchorValue: 1 },
      { groupId: "b", status: "resolved" as const, anchorId: "contrary", anchorValue: 0 },
      { groupId: "c", status: "resolved" as const, anchorId: "meets", anchorValue: 1 },
    ],
    expectedApplicability: "applicable" as const,
    expectedAttainment: 0,
    note: "Healthy groups cannot raise min; contrary remains 0.",
  },
  {
    id: "host-unresolved-abstain",
    declaredGroupIds: ["a", "b"],
    labels: [
      { groupId: "a", status: "resolved" as const, anchorId: "meets", anchorValue: 1 },
      { groupId: "b", status: "unresolved" as const },
    ],
    expectedApplicability: "insufficient_evidence" as const,
    expectedObserved: 1,
    note: "Unresolved group blocks overall claim; observedAttainment retains the known meet.",
  },
  {
    id: "host-not-applicable-excluded",
    declaredGroupIds: ["a", "b"],
    labels: [
      { groupId: "a", status: "not_applicable" as const },
      { groupId: "b", status: "resolved" as const, anchorId: "mixed", anchorValue: 0.5 },
    ],
    expectedApplicability: "applicable" as const,
    expectedAttainment: 0.5,
    note: "not_applicable groups drop out of the min; remaining mixed is the score.",
  },
  {
    id: "host-empty-applicable",
    declaredGroupIds: ["a"],
    labels: [{ groupId: "a", status: "not_applicable" as const }],
    expectedApplicability: "not_applicable" as const,
    note: "Complete empty applicable population is not_applicable, not a perfect score.",
  },
  {
    id: "host-missing-label",
    declaredGroupIds: ["a", "b"],
    labels: [{ groupId: "a", status: "resolved" as const, anchorId: "meets", anchorValue: 1 }],
    expectedApplicability: "insufficient_evidence" as const,
    expectedObserved: 1,
    note: "Missing declared group is incomplete inventory.",
  },
  {
    id: "host-no-policy",
    declaredGroupIds: [],
    labels: [],
    policyPresent: false,
    expectedApplicability: "not_configured" as const,
    note: "Missing policy is not_configured, not a healthy default.",
  },
  {
    id: "host-stretch-clamp",
    declaredGroupIds: ["a"],
    labels: [{ groupId: "a", status: "resolved" as const, anchorId: "exceeds", anchorValue: 1.2 }],
    expectedApplicability: "applicable" as const,
    expectedAttainment: 1.2,
    expectedScore: 1,
    note: "Full attainment may exceed 1; displayed score clamps to 1.",
  },
] as const
