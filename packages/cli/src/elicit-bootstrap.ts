import { join, relative } from "node:path"
import {
  deriveRevealedPreferenceProposal,
  inferRevealedPreferencePairwise,
  inferRevealedPreferencePriorAdjusted,
  loadPulsarVectorPresetById,
  MINIMUM_REVEALED_PREFERENCE_SAMPLES,
  type PulsarVectorProposal as PulsarVectorProposalType,
} from "@skastr0/pulsar-core/elicitation"
import {
  type PulsarVector,
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core/vector"
import { Effect } from "effect"
import { buildPulsarRegistry, resolveRepoRoot } from "./runtime.js"
import { discoverPulsarVector } from "./vector-discovery.js"
import {
  ensureProposalDirectories,
  proposalPaths,
  writeJsonFile,
} from "./elicit-files.js"
import {
  classifyRevealedPreferenceEvents,
  loadRecentCommitHistory,
  scoreCommitHistory,
} from "./elicit-bootstrap-history.js"
import { printBootstrapReport } from "./elicit-ui.js"
import type {
  BootstrapActionContext,
  BootstrapInferenceResult,
  ElicitCommandOptions,
  OutcomeCounts,
  RevealedPreferenceBootstrapReport,
  RevealedPreferenceCommitEvent,
} from "./elicit-types.js"

const DEFAULT_BOOTSTRAP_COMMITS = 60

export const runBootstrapAction = (opts: ElicitCommandOptions) =>
  Effect.gen(function* () {
    const context = yield* prepareBootstrapAction(opts)
    const result = inferBootstrapPreferences(context)
    const persisted = yield* persistBootstrapProposal(context, result)
    if (persisted === undefined) return 0
    printBootstrapReport(persisted)
    return 0
  })

const prepareBootstrapAction = (
  opts: ElicitCommandOptions,
): Effect.Effect<BootstrapActionContext, Error, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const registry = yield* buildPulsarRegistry(repoRoot)
    const discovered = yield* discoverPulsarVector({
      repoPath: repoRoot,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
      registry,
    })
    const preset =
      discovered.vector === undefined && opts.presetId !== undefined
        ? yield* loadPulsarVectorPresetById(opts.presetId)
        : undefined
    if (preset !== undefined) yield* validateVectorAgainstRegistry(preset, registry)

    const baseVector = discovered.vector ?? preset
    const commitHistory = yield* loadRecentCommitHistory(
      repoRoot,
      opts.commits ?? DEFAULT_BOOTSTRAP_COMMITS,
    )
    const scoredCommits = yield* scoreCommitHistory(repoRoot, baseVector, commitHistory)
    return {
      repoRoot,
      baseVector,
      baseVectorLabel: discovered.vector?.id ?? preset?.id ?? "all-defaults",
      baseVectorSourceLabel:
        discovered.vector !== undefined || preset === undefined
          ? discovered.sourceLabel
          : "preset fallback",
      presetId: preset?.id,
      scoredCommits,
      events: classifyRevealedPreferenceEvents(scoredCommits),
    }
  })

const inferBootstrapPreferences = (
  context: BootstrapActionContext,
): BootstrapInferenceResult => {
  const outcomeCounts = countOutcomes(context.events)
  if (outcomeCounts.accepted === 0 || outcomeCounts.revised + outcomeCounts.reverted === 0) {
    throw new Error(
      "Revealed preference bootstrap needs both accepted and revised/reverted events in the sampled history.",
    )
  }
  const priorWeights = collectPriorWeights(context.baseVector)
  const usePriorAdjusted =
    context.events.length < MINIMUM_REVEALED_PREFERENCE_SAMPLES &&
    Object.keys(priorWeights).length > 0
  const result = usePriorAdjusted
    ? inferRevealedPreferencePriorAdjusted(context.events, priorWeights)
    : inferRevealedPreferencePairwise(context.events, priorWeights)
  return {
    algorithm: usePriorAdjusted ? "prior-adjusted" : "pairwise",
    sampleCount: result.sampleCount,
    comparedPairs: result.comparedPairs,
    support: result.support,
    weights: result.weights,
    outcomeCounts,
  }
}

const persistBootstrapProposal = (
  context: BootstrapActionContext,
  result: BootstrapInferenceResult,
): Effect.Effect<Parameters<typeof printBootstrapReport>[0] | undefined, Error, never> =>
  Effect.gen(function* () {
    const createdAt = new Date().toISOString()
    const proposalId = `proposal-revealed-${context.scoredCommits.at(-1)?.sha.slice(0, 12) ?? Date.now().toString(36)}`
    const paths = proposalPaths(context.repoRoot)
    yield* ensureProposalDirectories(paths)
    const reportPath = join(paths.revealedPreferenceDir, `${proposalId}.json`)
    const report = bootstrapReport(context, result, createdAt)
    yield* writeJsonFile(reportPath, report)

    const proposal = bootstrapProposal(context, result, proposalId, createdAt, reportPath)
    if (proposal === undefined) {
      console.log("")
      console.log("No effective vector deltas emerged from the sampled repo history.")
      console.log("")
      return undefined
    }

    const pendingPath = join(paths.pendingDir, `${proposal.id}.json`)
    yield* writeJsonFile(pendingPath, proposal)
    return {
      repoRoot: context.repoRoot,
      baseVectorLabel: context.baseVectorLabel,
      baseVectorSourceLabel: context.baseVectorSourceLabel,
      report,
      proposal,
      proposalPath: relative(context.repoRoot, pendingPath),
      reportPath: relative(context.repoRoot, reportPath),
      ...(context.presetId !== undefined ? { usedPriorPreset: context.presetId } : {}),
    }
  })

const bootstrapReport = (
  context: BootstrapActionContext,
  result: BootstrapInferenceResult,
  createdAt: string,
): RevealedPreferenceBootstrapReport => ({
  schema_version: 1,
  created_at: createdAt,
  repo_root: context.repoRoot,
  head_sha: context.scoredCommits.at(-1)?.sha ?? "unknown",
  base_vector: context.baseVectorLabel,
  algorithm: result.algorithm,
  sample_count: result.sampleCount,
  minimum_sample_count: MINIMUM_REVEALED_PREFERENCE_SAMPLES,
  sufficient_data: result.sampleCount >= MINIMUM_REVEALED_PREFERENCE_SAMPLES,
  compared_pairs: result.comparedPairs,
  outcome_counts: result.outcomeCounts,
  support: result.support,
  weights: result.weights,
  events: context.events,
})

const bootstrapProposal = (
  context: BootstrapActionContext,
  result: BootstrapInferenceResult,
  proposalId: string,
  createdAt: string,
  reportPath: string,
): PulsarVectorProposalType | undefined =>
  deriveRevealedPreferenceProposal({
    proposalId,
    createdAt,
    vector: context.baseVector,
    algorithm: result.algorithm,
    sampleCount: result.sampleCount,
    minimumSampleCount: MINIMUM_REVEALED_PREFERENCE_SAMPLES,
    comparedPairs: result.comparedPairs,
    outcomeCounts: result.outcomeCounts,
    weights: result.weights,
    support: result.support,
    changedFiles: uniqueSorted(context.events.flatMap((event) => event.changed_files)).slice(0, 25),
    reportPath: relative(context.repoRoot, reportPath),
  })

const countOutcomes = (events: ReadonlyArray<RevealedPreferenceCommitEvent>): OutcomeCounts => ({
  accepted: events.filter((event) => event.outcome === "accepted").length,
  revised: events.filter((event) => event.outcome === "revised").length,
  reverted: events.filter((event) => event.outcome === "reverted").length,
})

const collectPriorWeights = (vector: PulsarVector | undefined): Readonly<Record<string, number>> =>
  Object.fromEntries(
    Object.entries(vector?.signal_overrides ?? {})
      .filter(([, override]) => override.weight !== undefined)
      .map(([signalId, override]) => [signalId, override.weight ?? 1]),
  )

const uniqueSorted = (values: ReadonlyArray<string>): Array<string> =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right))
