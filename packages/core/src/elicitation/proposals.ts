import { Schema } from "effect"
import type { ObserverOutput } from "../observer.js"
import {
  aiAssistedModeEnabled,
  appendVectorProvenance,
  weightOf,
  PulsarVectorEvidence,
  type PulsarVector,
} from "../vector.js"

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

const SIGNIFICANT_SCORE_DELTA = 0.2
const MAX_SIGNAL_BUMP = 0.25

export const derivePassiveVectorProposal = (input: {
  readonly fingerprint: string
  readonly changedFiles: ReadonlyArray<string>
  readonly vector: PulsarVector | undefined
  readonly previous: ObserverOutput | undefined
  readonly current: ObserverOutput
  readonly now?: string
}): PulsarVectorProposal | undefined => {
  if (input.previous === undefined) return undefined

  const deltas: Array<PulsarVectorProposalDelta> = []
  for (const [signalId, currentResult] of input.current.signalResults.entries()) {
    const previousScore = input.previous.signalResults.get(signalId)?.score
    if (previousScore === undefined) continue
    const delta = currentResult.score - previousScore
    if (delta < SIGNIFICANT_SCORE_DELTA) continue

    const previousWeight = weightOf(signalId, input.vector)
    const proposedWeight = clampWeight(previousWeight + Math.min(MAX_SIGNAL_BUMP, delta * 0.5))
    if (Math.abs(proposedWeight - previousWeight) < 0.05) continue

    deltas.push({
      signal_id: signalId,
      previous_score: roundNumber(previousScore),
      current_score: roundNumber(currentResult.score),
      previous_weight: roundNumber(previousWeight),
      proposed_weight: proposedWeight,
      rationale: `Recent edit activity improved ${signalId} by ${delta.toFixed(2)}; keep that preference explicit before it becomes implicit drift.`,
    })
  }

  const ranked = deltas.sort(
    (left, right) =>
      (right.current_score ?? 0) -
        (right.previous_score ?? 0) -
        ((left.current_score ?? 0) - (left.previous_score ?? 0)) ||
      left.signal_id.localeCompare(right.signal_id),
  )
  const top = ranked.slice(0, 3)
  if (top.length === 0) return undefined

  const evidence: Array<PulsarVectorEvidence> = top.map((delta) => ({
    kind: "score-delta",
    summary: `${delta.signal_id} improved from ${(delta.previous_score ?? 0).toFixed(2)} to ${(delta.current_score ?? 0).toFixed(2)}`,
    signal_ids: [delta.signal_id],
    metadata: {
      previous_score: delta.previous_score,
      current_score: delta.current_score,
      previous_weight: delta.previous_weight,
      proposed_weight: delta.proposed_weight,
    },
  }))

  return {
    schema_version: 1,
    id: `proposal-${input.fingerprint.slice(0, 12)}`,
    source: "passive-extraction",
    domain: input.vector?.domain ?? "typescript",
    created_at: input.now ?? new Date().toISOString(),
    status: "pending-confirmation",
    confidence: 1,
    summary: `Observed edit flow strengthened ${top.map((delta) => delta.signal_id).join(", ")}`,
    changed_files: [...new Set(input.changedFiles)].sort((left, right) => left.localeCompare(right)),
    evidence,
    deltas: top,
    mode_deltas: [],
  }
}

export const deriveAiAssistedModeProposal = (input: {
  readonly changedFiles: ReadonlyArray<string>
  readonly toolName: string
  readonly vector: PulsarVector | undefined
  readonly now?: string
}): PulsarVectorProposal | undefined => {
  if (aiAssistedModeEnabled(input.vector)) return undefined

  return {
    schema_version: 1,
    id: "proposal-ai-assisted-mode",
    source: "ai-assisted-detection",
    domain: input.vector?.domain ?? "typescript",
    created_at: input.now ?? new Date().toISOString(),
    status: "pending-confirmation",
    confidence: 0.95,
    summary: "Detected agent-mediated editing; keep AI-assisted thresholds explicit instead of hidden.",
    changed_files: [...new Set(input.changedFiles)].sort((left, right) => left.localeCompare(right)),
    evidence: [
      {
        kind: "observation",
        summary: `Observed edit tool '${input.toolName}' changing tracked files in this worktree.`,
        metadata: {
          tool: input.toolName,
          anti_dark_pattern:
            "The pulsar does not silently tighten thresholds. Accepting this proposal writes modes.ai_assisted into the vector; rejecting it preserves manual mode.",
        },
      },
    ],
    deltas: [],
    mode_deltas: [
      {
        mode: "ai_assisted",
        previous: false,
        proposed: true,
        rationale:
          "Agent edit tools were active in this worktree. Keep any tighter AI-assisted thresholds visible in the vector instead of inferring them through a hidden branch.",
      },
    ],
  }
}

export const deriveRevealedPreferenceProposal = (input: {
  readonly proposalId: string
  readonly createdAt: string
  readonly vector: PulsarVector | undefined
  readonly algorithm: string
  readonly sampleCount: number
  readonly minimumSampleCount: number
  readonly comparedPairs: number
  readonly outcomeCounts: {
    readonly accepted: number
    readonly revised: number
    readonly reverted: number
  }
  readonly weights: Readonly<Record<string, number>>
  readonly support: Readonly<Record<string, number>>
  readonly changedFiles: ReadonlyArray<string>
  readonly reportPath?: string
}): PulsarVectorProposal | undefined => {
  const deltas = Object.entries(input.weights)
    .flatMap(([signalId, proposedWeight]) => {
      const previousWeight = weightOf(signalId, input.vector)
      const support = roundSupport(input.support[signalId])
      if (Math.abs(proposedWeight - previousWeight) < 0.05) return []
      return [
        {
          signal_id: signalId,
          previous_weight: roundNumber(previousWeight),
          proposed_weight: roundNumber(proposedWeight),
          support,
          rationale:
            support >= 0
              ? `Accepted history favored stronger ${signalId} scores (support +${support.toFixed(2)} across ${input.sampleCount} labeled events).`
              : `Accepted history tolerated lighter ${signalId} pressure (support ${support.toFixed(2)} across ${input.sampleCount} labeled events).`,
        } satisfies PulsarVectorProposalDelta,
      ]
    })
    .sort(
      (left, right) =>
        Math.abs(right.proposed_weight - right.previous_weight) -
          Math.abs(left.proposed_weight - left.previous_weight) ||
        left.signal_id.localeCompare(right.signal_id),
    )

  if (deltas.length === 0) return undefined

  const topSignals = deltas.slice(0, 3).map((delta) => delta.signal_id)
  const sufficientData = input.sampleCount >= input.minimumSampleCount

  return {
    schema_version: 1,
    id: input.proposalId,
    source: "revealed-preference",
    domain: input.vector?.domain ?? "typescript",
    created_at: input.createdAt,
    status: "pending-confirmation",
    confidence: revealedPreferenceConfidence(input.sampleCount, input.minimumSampleCount),
    summary: `Repo history suggests ${topSignals.join(", ")} should shape the vector more explicitly.`,
    changed_files: [...new Set(input.changedFiles)].sort((left, right) => left.localeCompare(right)),
    evidence: [
      {
        kind: "proposal",
        summary: `Revealed-preference bootstrap labeled ${input.sampleCount} events using ${input.algorithm}.`,
        signal_ids: topSignals,
        ...(input.reportPath !== undefined ? { artifact_path: input.reportPath } : {}),
        metadata: {
          algorithm: input.algorithm,
          sample_count: input.sampleCount,
          minimum_sample_count: input.minimumSampleCount,
          compared_pairs: input.comparedPairs,
          sufficient_data: sufficientData,
          accepted: input.outcomeCounts.accepted,
          revised: input.outcomeCounts.revised,
          reverted: input.outcomeCounts.reverted,
        },
      },
      ...deltas.slice(0, 5).map((delta) => ({
        kind: "score-delta" as const,
        summary: `${delta.signal_id} support ${formatSigned(delta.support ?? 0)} → weight ${delta.previous_weight.toFixed(2)} -> ${delta.proposed_weight.toFixed(2)}`,
        signal_ids: [delta.signal_id],
        metadata: {
          support: delta.support ?? 0,
          previous_weight: delta.previous_weight,
          proposed_weight: delta.proposed_weight,
        },
      })),
    ],
    deltas,
    mode_deltas: [],
  }
}

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

const clampWeight = (value: number): number => roundNumber(Math.max(0, Math.min(2, value)))

const roundNumber = (value: number): number => Number(value.toFixed(2))

const roundSupport = (value: number | undefined): number =>
  Number((value ?? 0).toFixed(3))

const revealedPreferenceConfidence = (
  sampleCount: number,
  minimumSampleCount: number,
): number => roundNumber(Math.max(0.35, Math.min(0.95, sampleCount / minimumSampleCount)))

const formatSigned = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`
