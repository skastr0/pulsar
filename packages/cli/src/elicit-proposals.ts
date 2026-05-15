import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import {
  applyPulsarVectorProposal,
  type PulsarVectorProposal,
  resolvePulsarVectorProposal,
} from "@skastr0/pulsar-core/elicitation"
import {
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core/vector"
import { Effect } from "effect"
import { buildPulsarRegistry, resolveRepoRoot } from "./runtime.js"
import { renderVectorDiff, summarizeVectorDiff } from "./vector-format.js"
import {
  defaultVector,
  ensureProposalDirectories,
  loadPendingProposals,
  proposalPaths,
  readProposalFile,
  resolveVectorTarget,
  toPulsarStateRef,
  writeJsonFile,
} from "./elicit-files.js"
import { renderProposalReview } from "./elicit-ui.js"
import type { ElicitCommandOptions, ProposalPaths } from "./elicit-types.js"

type ProposalResolutionStatus = "accepted" | "rejected"

interface ProposalResolutionContext {
  readonly proposalId: string
  readonly repoRoot: string
  readonly paths: ProposalPaths
  readonly pendingPath: string
  readonly proposal: PulsarVectorProposal
  readonly resolved: PulsarVectorProposal
}

export const runReviewAction = (
  opts: ElicitCommandOptions,
): Effect.Effect<number, Error, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const proposals = yield* loadPendingProposals(repoRoot)

    console.log("")
    if (proposals.length === 0) {
      console.log("No pending elicitation proposals.")
      console.log("")
      return 0
    }

    console.log(`Pending elicitation proposals: ${proposals.length}`)
    console.log("")
    for (const proposal of proposals) {
      renderProposalReview(proposal)
      console.log("")
      console.log(`  Accept: pulsar elicit accept ${proposal.id} ${repoRoot}`)
      console.log(`  Reject: pulsar elicit reject ${proposal.id} ${repoRoot}`)
      console.log("")
    }
    return 0
  })

export const runResolutionAction = (
  opts: ElicitCommandOptions,
  status: ProposalResolutionStatus,
): Effect.Effect<number, Error, never> =>
  Effect.gen(function* () {
    const context = yield* loadResolutionContext(opts, status)
    return status === "rejected"
      ? yield* rejectProposal(context)
      : yield* acceptProposal(opts, context)
  })

const loadResolutionContext = (
  opts: ElicitCommandOptions,
  status: ProposalResolutionStatus,
) =>
  Effect.gen(function* () {
    const proposalId = opts.proposalId
    if (proposalId === undefined) {
      return yield* Effect.fail(
        new Error(`elicit ${status === "accepted" ? "accept" : "reject"} requires a proposal id`),
      )
    }

    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const paths = proposalPaths(repoRoot)
    const pendingPath = join(paths.pendingDir, `${proposalId}.json`)
    if (!existsSync(pendingPath)) {
      return yield* Effect.fail(new Error(`Pending proposal not found: ${pendingPath}`))
    }
    const proposal = yield* readProposalFile(pendingPath)
    return {
      proposalId,
      repoRoot,
      paths,
      pendingPath,
      proposal,
      resolved: resolvePulsarVectorProposal({ proposal, status }),
    } satisfies ProposalResolutionContext
  })

const rejectProposal = (context: ProposalResolutionContext) =>
  Effect.gen(function* () {
    const rejectedPath = join(context.paths.rejectedDir, `${context.proposalId}.json`)
    yield* ensureProposalDirectories(context.paths)
    yield* writeJsonFile(rejectedPath, context.resolved)
    yield* removePendingProposal(context.pendingPath)
    printRejectedProposal(context, rejectedPath)
    return 0
  })

const acceptProposal = (
  opts: ElicitCommandOptions,
  context: ProposalResolutionContext,
) =>
  Effect.gen(function* () {
    const registry = yield* buildPulsarRegistry(context.repoRoot)
    const vectorTarget = yield* resolveVectorTarget({
      repoRoot: context.repoRoot,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const acceptedPath = join(context.paths.acceptedDir, `${context.proposalId}.json`)
    const baseVector = vectorTarget.vector ?? defaultVector(context.proposal.domain)
    const nextVector = applyPulsarVectorProposal(baseVector, context.resolved, {
      artifactPath: toPulsarStateRef(context.repoRoot, acceptedPath),
    })
    yield* validateVectorAgainstRegistry(nextVector, registry)

    yield* ensureProposalDirectories(context.paths)
    yield* writeJsonFile(acceptedPath, context.resolved)
    yield* writeJsonFile(vectorTarget.outputPath, nextVector)
    yield* removePendingProposal(context.pendingPath)
    printAcceptedProposal(context, acceptedPath, vectorTarget, nextVector)
    return 0
  })

const removePendingProposal = (pendingPath: string) =>
  Effect.tryPromise({
    try: () => rm(pendingPath),
    catch: (cause) => new Error(`Failed to remove pending proposal ${pendingPath}: ${String(cause)}`),
  })

const printRejectedProposal = (
  context: ProposalResolutionContext,
  rejectedPath: string,
): void => {
  console.log("")
  console.log(`Rejected proposal: ${context.proposalId}`)
  console.log(`Archived at:       ${rejectedPath}`)
  if (context.proposal.source === "ai-assisted-detection") {
    console.log("")
    console.log("AI-assisted mode remains manual. The pulsar will not silently tighten thresholds behind your back.")
  }
  console.log("")
}

const printAcceptedProposal = (
  context: ProposalResolutionContext,
  acceptedPath: string,
  vectorTarget: { readonly vector: Parameters<typeof summarizeVectorDiff>[0]; readonly outputPath: string },
  nextVector: Parameters<typeof summarizeVectorDiff>[1],
): void => {
  console.log("")
  console.log(`Accepted proposal: ${context.proposalId}`)
  console.log(`Wrote vector:      ${vectorTarget.outputPath}`)
  console.log(`Archived at:       ${acceptedPath}`)
  console.log("")
  for (const line of renderVectorDiff(summarizeVectorDiff(vectorTarget.vector, nextVector))) {
    console.log(line)
  }
  if (context.proposal.source === "ai-assisted-detection") {
    console.log("")
    console.log("AI-assisted mode stays explicit in the vector. Edit modes.ai_assisted or reject future proposals to return to manual thresholds.")
  }
  console.log("")
}
