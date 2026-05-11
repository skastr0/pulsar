import { existsSync } from "node:fs"
import { appendFile, mkdir, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import {
  RoutingDetector,
  generateReviewPlan,
  type RoutingDiff,
  type SignalChange,
} from "@skastr0/pulsar-core/routing"
import {
  deriveAiAssistedModeProposal,
  derivePassiveVectorProposal,
} from "@skastr0/pulsar-core/vector"
import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import { Effect } from "effect"
import { observeCurrentWorktree } from "./pulsar-observer"
import { createReadyAnnotation } from "./review-surfacing"
import type { PulsarAnalyzer } from "./pulsar-hook-types"

export const defaultPulsarAnalyzer: PulsarAnalyzer = async ({
  fingerprint,
  toolName,
  worktree,
  diff,
  vector,
  previous,
}) => {
  const { registry, sha, observerOutput } = await observeCurrentWorktree({
    worktree,
    vector,
    changedHunks: diff.changedHunks,
  })

  const detector = await Effect.runPromise(RoutingDetector.load({ repoRoot: worktree }))

  const routedDiff: RoutingDiff = {
    ...diff,
    signalChanges: {
      ...diff.signalChanges,
      ...buildSignalChanges(previous?.observerOutput, observerOutput),
    },
  }
  const routingOutput = detector.detect(observerOutput, routedDiff)
  const reviewPlan = generateReviewPlan(observerOutput, routingOutput, vector, {
    sha,
  })
  const annotation = createReadyAnnotation({
    worktree,
    fingerprint,
    diff: routedDiff,
    observerOutput,
    reviewPlan,
    previousObserverOutput: previous?.observerOutput,
  })

  await persistPassiveElicitationArtifacts({
    worktree,
    fingerprint,
    toolName,
    diff: routedDiff,
    vector,
    previousObserverOutput: previous?.observerOutput,
    observerOutput,
  }).catch(() => undefined)

  return {
    fingerprint,
    diff: routedDiff,
    observerOutput,
    routingOutput,
    reviewPlan,
    annotation,
  }
}

const buildSignalChanges = (
  previous: ObserverOutput | undefined,
  current: ObserverOutput,
): Record<string, SignalChange> => {
  const changes: Record<string, SignalChange> = {}

  for (const [signalId, result] of current.signalResults.entries()) {
    const previousScore = previous?.signalResults.get(signalId)?.score
    const absoluteDelta =
      previousScore === undefined ? 0 : Math.abs(result.score - previousScore)
    const relativeDelta =
      previousScore === undefined || previousScore === 0
        ? undefined
        : absoluteDelta / Math.abs(previousScore)

    changes[signalId] = {
      ...(previousScore !== undefined ? { previousScore } : {}),
      currentScore: result.score,
      absoluteDelta,
      ...(relativeDelta !== undefined ? { relativeDelta } : {}),
      sourceLocations: result.diagnostics.flatMap((diagnostic) =>
        diagnostic.location === undefined ? [] : [diagnostic.location],
      ),
    }
  }

  return changes
}

const persistPassiveElicitationArtifacts = async (input: {
  readonly worktree: string
  readonly fingerprint: string
  readonly toolName: string
  readonly diff: RoutingDiff
  readonly vector: Parameters<PulsarAnalyzer>[0]["vector"]
  readonly previousObserverOutput: ObserverOutput | undefined
  readonly observerOutput: ObserverOutput
}): Promise<void> => {
  const pulsarDir = join(input.worktree, ".pulsar")
  const proposalDir = join(pulsarDir, "proposals", "pending")
  await mkdir(proposalDir, { recursive: true })

  const proposal = derivePassiveVectorProposal({
    fingerprint: input.fingerprint,
    changedFiles: input.diff.changedFiles,
    vector: input.vector,
    previous: input.previousObserverOutput,
    current: input.observerOutput,
  })
  if (proposal !== undefined) {
    const proposalPath = join(proposalDir, `${proposal.id}.json`)
    await writeFile(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`, "utf8")
    await appendObservation(pulsarDir, {
      schema_version: 1,
      observed_at: proposal.created_at,
      kind: "passive-proposal",
      fingerprint: input.fingerprint,
      changed_files: input.diff.changedFiles,
      summary: proposal.summary,
      signal_ids: proposal.deltas.map((delta) => delta.signal_id),
      proposal_path: relative(input.worktree, proposalPath),
    })
  }

  const aiProposal = deriveAiAssistedModeProposal({
    changedFiles: input.diff.changedFiles,
    toolName: input.toolName,
    vector: input.vector,
  })
  if (aiProposal === undefined) return
  if (proposalAlreadyTracked(pulsarDir, aiProposal.id)) return

  const aiProposalPath = join(proposalDir, `${aiProposal.id}.json`)
  await writeFile(aiProposalPath, `${JSON.stringify(aiProposal, null, 2)}\n`, "utf8")
  await appendObservation(pulsarDir, {
    schema_version: 1,
    observed_at: aiProposal.created_at,
    kind: "ai-assisted-mode-proposal",
    fingerprint: input.fingerprint,
    changed_files: input.diff.changedFiles,
    summary: aiProposal.summary,
    signal_ids: [],
    proposal_path: relative(input.worktree, aiProposalPath),
  })
}

const appendObservation = async (pulsarDir: string, observation: unknown): Promise<void> => {
  await appendFile(join(pulsarDir, "observations.log"), `${JSON.stringify(observation)}\n`, "utf8")
}

const proposalAlreadyTracked = (pulsarDir: string, proposalId: string): boolean =>
  ["pending", "accepted", "rejected"].some((status) =>
    existsSync(join(pulsarDir, "proposals", status, `${proposalId}.json`)),
  )
