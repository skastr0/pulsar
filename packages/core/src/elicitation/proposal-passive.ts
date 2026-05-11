import type { ObserverOutput } from "../observer.js"
import { weightOf, type PulsarVector, type PulsarVectorEvidence } from "../vector.js"
import type {
  PulsarVectorProposal,
  PulsarVectorProposalDelta,
} from "./proposal-schema.js"
import { clampWeight, roundNumber, sortedUniqueFiles } from "./proposal-utils.js"

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
    changed_files: sortedUniqueFiles(input.changedFiles),
    evidence,
    deltas: top,
    mode_deltas: [],
  }
}
