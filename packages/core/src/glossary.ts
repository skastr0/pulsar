import { Schema } from "effect"

export const GlossaryIdentifierKind = Schema.Literal(
  "function",
  "class",
  "interface",
  "type",
  "enum",
  "const",
  "parameter",
  "exported-symbol",
)
export type GlossaryIdentifierKind = typeof GlossaryIdentifierKind.Type

export const GlossaryProvenance = Schema.Struct({
  package: Schema.String,
  file: Schema.String,
  line: Schema.optional(Schema.Number),
  identifier: Schema.String,
  identifier_kind: GlossaryIdentifierKind,
})
export type GlossaryProvenance = typeof GlossaryProvenance.Type

const GlossaryDecision = Schema.Struct({
  action: Schema.Literal("accept", "reject", "merge"),
  merge_into: Schema.optional(Schema.String),
})
type GlossaryDecision = typeof GlossaryDecision.Type

const GlossaryCandidateTerm = Schema.Struct({
  term: Schema.String,
  normalized: Schema.String,
  frequency: Schema.Number,
  provenance: Schema.Array(GlossaryProvenance),
  co_occurs_with: Schema.Array(Schema.String),
  decision: Schema.optional(GlossaryDecision),
})
type GlossaryCandidateTerm = typeof GlossaryCandidateTerm.Type

const GlossarySynonymCandidate = Schema.Struct({
  terms: Schema.Array(Schema.String),
  score: Schema.Number,
  shared_context_terms: Schema.Array(Schema.String),
})
type GlossarySynonymCandidate = typeof GlossarySynonymCandidate.Type

export const GlossaryDraft = Schema.Struct({
  schema_version: Schema.Literal(1),
  extracted_at_sha: Schema.String,
  extracted_at: Schema.String,
  include_parameter_names: Schema.Boolean,
  candidate_terms: Schema.Array(GlossaryCandidateTerm),
  candidate_synonyms: Schema.Array(GlossarySynonymCandidate),
})
export type GlossaryDraft = typeof GlossaryDraft.Type

export const CanonicalGlossaryTerm = Schema.Struct({
  canonical: Schema.String,
  aliases: Schema.Array(Schema.String),
  frequency: Schema.Number,
  provenance: Schema.Array(GlossaryProvenance),
})
export type CanonicalGlossaryTerm = typeof CanonicalGlossaryTerm.Type

export const Glossary = Schema.Struct({
  schema_version: Schema.Literal(1),
  extracted_at_sha: Schema.String,
  confirmed_at: Schema.String,
  terms: Schema.Array(CanonicalGlossaryTerm),
  rejected_terms: Schema.Array(Schema.String),
})
export type Glossary = typeof Glossary.Type

export const decodeGlossaryDraftSync = Schema.decodeUnknownSync(GlossaryDraft)
export const decodeGlossary = Schema.decodeUnknown(Glossary)
export const decodeGlossarySync = Schema.decodeUnknownSync(Glossary)
