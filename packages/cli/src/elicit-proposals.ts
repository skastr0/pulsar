import { existsSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join, relative } from "node:path"
import {
  applyPulsarVectorProposal,
  resolvePulsarVectorProposal,
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core"
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
  writeJsonFile,
} from "./elicit-files.js"
import { renderProposalReview } from "./elicit-ui.js"
import type { ElicitCommandOptions } from "./elicit-types.js"

export const runReviewAction = (opts: ElicitCommandOptions) =>
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
  status: "accepted" | "rejected",
) =>
  Effect.gen(function* () {
    const proposalId = opts.proposalId
    if (proposalId === undefined) {
      return yield* Effect.fail(new Error(`elicit ${status === "accepted" ? "accept" : "reject"} requires a proposal id`))
    }

    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const paths = proposalPaths(repoRoot)
    const pendingPath = join(paths.pendingDir, `${proposalId}.json`)
    if (!existsSync(pendingPath)) {
      return yield* Effect.fail(new Error(`Pending proposal not found: ${pendingPath}`))
    }

    const proposal = yield* readProposalFile(pendingPath)
    const resolved = resolvePulsarVectorProposal({ proposal, status })

    if (status === "rejected") {
      const rejectedPath = join(paths.rejectedDir, `${proposalId}.json`)
      yield* ensureProposalDirectories(paths)
      yield* writeJsonFile(rejectedPath, resolved)
      yield* Effect.tryPromise({
        try: () => rm(pendingPath),
        catch: (cause) => new Error(`Failed to remove pending proposal ${pendingPath}: ${String(cause)}`),
      })
      console.log("")
      console.log(`Rejected proposal: ${proposalId}`)
      console.log(`Archived at:       ${rejectedPath}`)
      if (proposal.source === "ai-assisted-detection") {
        console.log("")
        console.log("AI-assisted mode remains manual. The pulsar will not silently tighten thresholds behind your back.")
      }
      console.log("")
      return 0
    }

    const registry = yield* buildPulsarRegistry(repoRoot)
    const vectorTarget = yield* resolveVectorTarget({
      repoRoot,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const baseVector = vectorTarget.vector ?? defaultVector(proposal.domain)
    const acceptedPath = join(paths.acceptedDir, `${proposalId}.json`)
    const nextVector = applyPulsarVectorProposal(baseVector, resolved, {
      artifactPath: relative(repoRoot, acceptedPath),
    })
    yield* validateVectorAgainstRegistry(nextVector, registry)

    yield* ensureProposalDirectories(paths)
    yield* writeJsonFile(acceptedPath, resolved)
    yield* writeJsonFile(vectorTarget.outputPath, nextVector)
    yield* Effect.tryPromise({
      try: () => rm(pendingPath),
      catch: (cause) => new Error(`Failed to remove pending proposal ${pendingPath}: ${String(cause)}`),
    })

    console.log("")
    console.log(`Accepted proposal: ${proposalId}`)
    console.log(`Wrote vector:      ${vectorTarget.outputPath}`)
    console.log(`Archived at:       ${acceptedPath}`)
    console.log("")
    for (const line of renderVectorDiff(summarizeVectorDiff(vectorTarget.vector, nextVector))) {
      console.log(line)
    }
    if (proposal.source === "ai-assisted-detection") {
      console.log("")
      console.log("AI-assisted mode stays explicit in the vector. Edit modes.ai_assisted or reject future proposals to return to manual thresholds.")
    }
    console.log("")
    return 0
  })
