import {
  AMBIGUOUS_ALPHA,
  AMBIGUOUS_BETA,
  CALLER_AUDIT_COPY,
  CALLER_AUDIT_DELEGATED,
  CALLER_PREVIEW_COPY,
  CALLER_PREVIEW_DELEGATED,
  CALLER_SAMPLE_COPY,
  CALLER_SAMPLE_DELEGATED,
  CALLER_SUBMIT_COPY,
  CALLER_SUBMIT_DELEGATED,
  NOTES_ONLY,
  OWNER_PUBLISH,
  OWNER_SAMPLE,
  PADDING_CLAMP,
  PADDING_SLUG,
  PADDING_TITLE,
  PADDING_UNIQUE,
  STUB_TYPES_ONLY,
  source,
} from "./sources.ts"
import type { ArrangementId, CaseSpec, SourceSnapshot } from "./types.ts"

export type { CaseSpec }

const publishCopies: ReadonlyArray<SourceSnapshot> = [
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
]

const publishDelegated: ReadonlyArray<SourceSnapshot> = [
  source("src/publish-rule.ts", OWNER_PUBLISH, "owner"),
  source("src/preview.ts", CALLER_PREVIEW_DELEGATED, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_DELEGATED, "caller"),
]

const mixedCopyAndDelegate: ReadonlyArray<SourceSnapshot> = [
  source("src/publish-rule.ts", OWNER_PUBLISH, "owner"),
  source("src/preview.ts", CALLER_PREVIEW_DELEGATED, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
]

const distinctDomain: ReadonlyArray<SourceSnapshot> = [
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
  source("src/sample.ts", CALLER_SAMPLE_COPY, "caller"),
]

const extractedOwner: ReadonlyArray<SourceSnapshot> = [
  source("src/publish-rule.ts", OWNER_PUBLISH, "owner"),
  source("src/preview.ts", CALLER_PREVIEW_DELEGATED, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_DELEGATED, "caller"),
  source("src/audit.ts", CALLER_AUDIT_DELEGATED, "caller"),
]

const paddingWithCopy: ReadonlyArray<SourceSnapshot> = [
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
  source("src/title-case.ts", PADDING_TITLE, "context"),
  source("src/slugify.ts", PADDING_SLUG, "context"),
  source("src/clamp.ts", PADDING_CLAMP, "context"),
  source("src/unique.ts", PADDING_UNIQUE, "context"),
]

const overlappingPublish: ReadonlyArray<SourceSnapshot> = [
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
  source("src/audit.ts", CALLER_AUDIT_COPY, "caller"),
]

const overlappingSample: ReadonlyArray<SourceSnapshot> = [
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
  source("src/sample.ts", CALLER_SAMPLE_COPY, "caller"),
]

const missingImplementation: ReadonlyArray<SourceSnapshot> = [
  source("src/publish-rule.ts", STUB_TYPES_ONLY, "owner"),
  source("src/notes.ts", NOTES_ONLY, "context"),
]

const ownerWithoutCallers: ReadonlyArray<SourceSnapshot> = [
  source("src/publish-rule.ts", OWNER_PUBLISH, "owner"),
]

const notesOnly: ReadonlyArray<SourceSnapshot> = [source("src/notes.ts", NOTES_ONLY, "context")]

const ambiguousIdentity: ReadonlyArray<SourceSnapshot> = [
  source("src/alpha.ts", AMBIGUOUS_ALPHA, "caller"),
  source("src/beta.ts", AMBIGUOUS_BETA, "caller"),
]

const extractedOverDistinct: ReadonlyArray<SourceSnapshot> = [
  source("src/publish-rule.ts", OWNER_PUBLISH, "owner"),
  source("src/sample-rule.ts", OWNER_SAMPLE, "owner"),
  source("src/preview.ts", CALLER_PREVIEW_DELEGATED, "caller"),
  source("src/sample.ts", CALLER_SAMPLE_DELEGATED, "caller"),
]

const threeSiteCopies: ReadonlyArray<SourceSnapshot> = [
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
  source("src/audit.ts", CALLER_AUDIT_COPY, "caller"),
]

const singleLocalImpl: ReadonlyArray<SourceSnapshot> = [
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
]

const roleTagsSwapped: ReadonlyArray<SourceSnapshot> = [
  source("src/preview.ts", CALLER_PREVIEW_COPY, "owner"),
  source("src/submit.ts", CALLER_SUBMIT_COPY, "owner"),
]

const sourceOrderReversed: ReadonlyArray<SourceSnapshot> = [
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
]

const sourceOrderReversedDistinct: ReadonlyArray<SourceSnapshot> = [
  source("src/sample.ts", CALLER_SAMPLE_COPY, "caller"),
  source("src/preview.ts", CALLER_PREVIEW_COPY, "caller"),
]

const mixedWithPadding: ReadonlyArray<SourceSnapshot> = [
  source("src/publish-rule.ts", OWNER_PUBLISH, "owner"),
  source("src/preview.ts", CALLER_PREVIEW_DELEGATED, "caller"),
  source("src/submit.ts", CALLER_SUBMIT_COPY, "caller"),
  source("src/title-case.ts", PADDING_TITLE, "context"),
]

const spec = (
  id: string,
  obligationId: string,
  arrangement: ArrangementId,
  sources: ReadonlyArray<SourceSnapshot>,
  rubricKind: CaseSpec["rubricKind"] = "both",
  requiresProvider = true,
): CaseSpec => ({ id, obligationId, arrangement, sources, requiresProvider, rubricKind })

export const EVALUATION_CASES: ReadonlyArray<CaseSpec> = [
  spec("g1", "obl-publish", "identical-copies", publishCopies),
  spec("g2", "obl-publish", "delegated-owner", publishDelegated),
  spec("g3", "obl-publish", "mixed-copy-and-delegate", mixedCopyAndDelegate),
  spec("g4", "obl-publish", "distinct-domain-same-shape", distinctDomain),
  spec("g5", "obl-publish", "extracted-owner", extractedOwner),
  spec("g6", "obl-publish", "healthy-padding-with-copy", paddingWithCopy),
  spec("g7a", "obl-publish", "overlapping-publish", overlappingPublish),
  spec("g7b", "obl-sample", "overlapping-sample", overlappingSample),
  spec("g8", "obl-publish", "missing-implementation", missingImplementation),
  spec("g9", "obl-publish", "owner-without-callers", ownerWithoutCallers),
  spec("g10", "obl-publish", "notes-only", notesOnly),
  spec("g11", "obl-publish", "ambiguous-identity", ambiguousIdentity),
  spec("g12", "obl-publish", "extracted-over-distinct", extractedOverDistinct),
  spec("g13", "obl-publish", "three-site-copies", threeSiteCopies),
  spec("g14", "obl-publish", "single-local-impl", singleLocalImpl),
  spec("g15", "obl-publish", "role-tags-swapped", roleTagsSwapped),
  spec("g16", "obl-publish", "source-order-reversed", sourceOrderReversed),
  spec("g17", "obl-publish", "source-order-reversed-distinct", sourceOrderReversedDistinct),
  spec("g18", "obl-publish", "mixed-with-padding-context", mixedWithPadding),
  spec("g19", "obl-publish", "conflicting-preference-text", publishCopies, "conflict"),
  spec("g20", "obl-publish", "stretch-on-delegation", publishDelegated, "stretch-shared"),
  spec("g21", "obl-publish", "stretch-on-copies", publishCopies, "stretch-shared"),
]

export const caseById = (id: string): CaseSpec => {
  const found = EVALUATION_CASES.find((entry) => entry.id === id)
  if (found === undefined) throw new Error(`unknown evaluation case ${id}`)
  return found
}

export const FORBIDDEN_SOURCE_SUBSTRINGS: ReadonlyArray<string> = [
  "fixture",
  "expected",
  "contrary",
  "meets",
  "mixed",
  "exceeds",
  "shared_domain_rule",
  "caller_local",
  "not_applicable",
  "unknown",
  "obl-publish",
  "obl-sample",
  "g1",
  "g2",
  "g3",
  "g4",
  "g5",
  "g6",
  "g7",
  "g8",
  "g9",
  "g10",
  "g11",
  "g12",
  "g13",
  "g14",
  "g15",
  "g16",
  "g17",
  "g18",
  "g19",
  "g20",
  "g21",
]
