import {
  appendVectorProvenance,
  type PulsarVector,
  type PulsarVectorEvidence,
} from "../vector.js"
import type {
  PulsarVectorProposal,
  PulsarVectorProposalStatus,
} from "./proposal-schema.js"

export const applyPulsarVectorProposal = (
  vector: PulsarVector,
  proposal: PulsarVectorProposal,
  options?: {
    readonly artifactPath?: string
  },
): PulsarVector => {
  const signal_overrides = { ...vector.signal_overrides }

  for (const delta of proposal.deltas) {
    signal_overrides[delta.signal_id] = {
      ...signal_overrides[delta.signal_id],
      weight: delta.proposed_weight,
    }
  }

  let nextModes = vector.modes
  for (const delta of proposal.mode_deltas ?? []) {
    if (delta.mode === "ai_assisted") {
      nextModes = { ai_assisted: delta.proposed }
    }
  }

  const acceptedEvidence: Array<PulsarVectorEvidence> = [...proposal.evidence]
  acceptedEvidence.push({
    kind: "proposal",
    summary: `Accepted proposal ${proposal.id}`,
    ...(options?.artifactPath !== undefined ? { artifact_path: options.artifactPath } : {}),
    metadata: {
      proposal_id: proposal.id,
      status: proposal.status,
    },
  })

  return appendVectorProvenance(
    {
      ...vector,
      signal_overrides,
      ...(nextModes !== undefined ? { modes: nextModes } : {}),
    },
    {
      source: proposal.source,
      recorded_at: proposal.reviewed_at ?? proposal.created_at,
      summary: proposal.summary,
      ...(options?.artifactPath !== undefined ? { artifact_path: options.artifactPath } : {}),
      evidence: acceptedEvidence,
    },
  )
}

export const resolvePulsarVectorProposal = (input: {
  readonly proposal: PulsarVectorProposal
  readonly status: Exclude<PulsarVectorProposalStatus, "pending-confirmation">
  readonly now?: string
}): PulsarVectorProposal => ({
  ...input.proposal,
  status: input.status,
  reviewed_at: input.now ?? new Date().toISOString(),
})
