import { Schema } from "effect"
import { PulsarVectorEvidence } from "../vector.js"

export const PulsarVectorProposalSource = Schema.Literal(
  "passive-extraction",
  "revealed-preference",
  "ai-assisted-detection",
)
export type PulsarVectorProposalSource = typeof PulsarVectorProposalSource.Type

export const PulsarVectorProposalStatus = Schema.Literal(
  "pending-confirmation",
  "accepted",
  "rejected",
)
export type PulsarVectorProposalStatus = typeof PulsarVectorProposalStatus.Type

export const PulsarVectorProposalDelta = Schema.Struct({
  signal_id: Schema.String,
  previous_score: Schema.optional(Schema.Number),
  current_score: Schema.optional(Schema.Number),
  previous_weight: Schema.Number,
  proposed_weight: Schema.Number,
  support: Schema.optional(Schema.Number.pipe(Schema.between(-1, 1))),
  rationale: Schema.String,
})
export type PulsarVectorProposalDelta = typeof PulsarVectorProposalDelta.Type

export const PulsarVectorProposalModeDelta = Schema.Struct({
  mode: Schema.Literal("ai_assisted"),
  previous: Schema.Boolean,
  proposed: Schema.Boolean,
  rationale: Schema.String,
})
export type PulsarVectorProposalModeDelta = typeof PulsarVectorProposalModeDelta.Type

export const PulsarVectorProposal = Schema.Struct({
  schema_version: Schema.Literal(1),
  id: Schema.String,
  source: PulsarVectorProposalSource,
  domain: Schema.String,
  created_at: Schema.String,
  status: PulsarVectorProposalStatus,
  confidence: Schema.optionalWith(Schema.Number.pipe(Schema.between(0, 1)), {
    default: () => 1,
  }),
  reviewed_at: Schema.optional(Schema.String),
  summary: Schema.String,
  changed_files: Schema.Array(Schema.String),
  evidence: Schema.Array(PulsarVectorEvidence),
  deltas: Schema.Array(PulsarVectorProposalDelta),
  mode_deltas: Schema.optionalWith(Schema.Array(PulsarVectorProposalModeDelta), {
    default: () => [],
  }),
})
export type PulsarVectorProposal = typeof PulsarVectorProposal.Type
