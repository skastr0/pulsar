export const PREFERENCE_SHARED = "shared_domain_rule"
export const PREFERENCE_LOCAL = "caller_local"

export type PreferenceId = typeof PREFERENCE_SHARED | typeof PREFERENCE_LOCAL

export type ArrangementId =
  | "identical-copies"
  | "delegated-owner"
  | "mixed-copy-and-delegate"
  | "distinct-domain-same-shape"
  | "extracted-owner"
  | "healthy-padding-with-copy"
  | "overlapping-publish"
  | "overlapping-sample"
  | "missing-implementation"
  | "owner-without-callers"
  | "notes-only"
  | "ambiguous-identity"
  | "extracted-over-distinct"
  | "three-site-copies"
  | "single-local-impl"
  | "role-tags-swapped"
  | "source-order-reversed"
  | "source-order-reversed-distinct"
  | "mixed-with-padding-context"
  | "conflicting-preference-text"
  | "stretch-on-delegation"
  | "stretch-on-copies"

export type SourceRole = "owner" | "caller" | "context"

export interface SourceSnapshot {
  readonly path: string
  readonly bytes: string
  readonly role: SourceRole
}

export interface CaseSpec {
  readonly id: string
  readonly obligationId: string
  readonly arrangement: ArrangementId
  readonly sources: ReadonlyArray<SourceSnapshot>
  readonly requiresProvider: boolean
  readonly rubricKind: "shared" | "local" | "both" | "conflict" | "stretch-shared"
}

export type ExpectedStatus = "resolved" | "unresolved" | "not_applicable"

export type ExpectedAnchor = "contrary" | "mixed" | "meets" | "exceeds" | "unknown" | "not_applicable"

export interface SealedExpectation {
  readonly caseId: string
  readonly preference: PreferenceId | "conflict" | "stretch-shared"
  readonly status: ExpectedStatus
  readonly anchor: ExpectedAnchor
  readonly hostValue: number | null
  readonly justification: string
}

export interface HostGroupLabel {
  readonly groupId: string
  readonly status: ExpectedStatus
  readonly anchorId?: string
  readonly anchorValue?: number
}

export type HostApplicability =
  | "applicable"
  | "not_applicable"
  | "insufficient_evidence"
  | "not_configured"

export interface HostAggregate {
  readonly applicability: HostApplicability
  readonly attainment: number | undefined
  readonly observedAttainment: number | undefined
  readonly target: 1
  readonly score: number | undefined
  readonly histogram: Readonly<Record<string, number>>
  readonly resolvedGroupIds: ReadonlyArray<string>
  readonly unresolvedGroupIds: ReadonlyArray<string>
  readonly notApplicableGroupIds: ReadonlyArray<string>
  readonly missingGroupIds: ReadonlyArray<string>
}
