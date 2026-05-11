import { weightOf, type PulsarVector } from "../vector.js"
import type {
  PulsarVectorProposal,
  PulsarVectorProposalDelta,
} from "./proposal-schema.js"
import {
  formatSigned,
  roundNumber,
  roundSupport,
  sortedUniqueFiles,
} from "./proposal-utils.js"

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
    changed_files: sortedUniqueFiles(input.changedFiles),
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
        summary: `${delta.signal_id} support ${formatSigned(delta.support ?? 0)} -> weight ${delta.previous_weight.toFixed(2)} -> ${delta.proposed_weight.toFixed(2)}`,
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

const revealedPreferenceConfidence = (
  sampleCount: number,
  minimumSampleCount: number,
): number => roundNumber(Math.max(0.35, Math.min(0.95, sampleCount / minimumSampleCount)))
