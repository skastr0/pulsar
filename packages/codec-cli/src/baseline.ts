import {
  baselineViolationCount,
  computeObserverConfigHash,
  createBaseline,
} from "@taste-codec/core"
import { Effect } from "effect"
import { readBaselineFile, resolveBaselinePath, writeBaselineFile } from "./baseline-file.js"
import { buildCodecRegistry, observeWorktree, readHeadSha, resolveRepoRoot } from "./runtime.js"
import { discoverTasteVector } from "./vector-discovery.js"

export interface BaselineCommandOptions {
  readonly action: "set" | "refresh" | "show"
  readonly repoPath: string
  readonly vectorPath?: string
}

export const runBaselineCommand = (opts: BaselineCommandOptions) =>
  Effect.gen(function* () {
    if (opts.action === "show") {
      return yield* runShowCommand(opts.repoPath)
    }

    const registry = yield* buildCodecRegistry(opts.repoPath)
    const vectorSelection = yield* discoverTasteVector({
      repoPath: opts.repoPath,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const { repoRoot, result, calibrationContext } = yield* observeWorktree(
      opts.repoPath,
      vectorSelection.vector,
    )
    const headSha = yield* readHeadSha(repoRoot)
    const baseline = createBaseline({
      baselineSha: headSha,
      vectorId: vectorSelection.label,
      vectorSource: vectorSelection.sourceLabel,
      vectorTrustBoundary: vectorSelection.trustBoundary,
      observerConfigHash: computeObserverConfigHash(
        registry,
        vectorSelection.vector,
        calibrationContext?.fingerprint,
      ),
      violations: result.hard_gate_violations,
    })
    const baselinePath = yield* writeBaselineFile(repoRoot, baseline)
    const total = baselineViolationCount(baseline)

    console.log("")
    console.log(
      `  Baseline ${opts.action === "set" ? "set" : "refreshed"}: ${total} tolerated violation${total === 1 ? "" : "s"}`,
    )
    console.log(`  Repo:     ${repoRoot}`)
    console.log(`  SHA:      ${baseline.baseline_sha}`)
    console.log(`  Vector:   ${vectorSelection.label}`)
    console.log(`  Vector Source: ${vectorSelection.sourceLabel}`)
    console.log(`  File:     ${baselinePath}`)
    console.log("")
    return 0
  })

const runShowCommand = (repoPath: string) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(repoPath)
    const baseline = yield* readBaselineFile(repoRoot)
    if (baseline === undefined) {
      return yield* Effect.fail(
        new Error(`No baseline file found at ${resolveBaselinePath(repoRoot)}`),
      )
    }

    const signalCounts = Object.entries(baseline.violations)
      .map(([signalId, violations]) => ({ signalId, count: violations.length }))
      .sort((a, b) => b.count - a.count || a.signalId.localeCompare(b.signalId))

    console.log("")
    console.log(`  Repo:          ${repoRoot}`)
    console.log(`  Baseline SHA:  ${baseline.baseline_sha}`)
    console.log(`  Created:       ${baseline.created_at}`)
    if (baseline.vector_id !== undefined) {
      console.log(`  Vector:        ${baseline.vector_id}`)
    }
    if (baseline.vector_source !== undefined) {
      console.log(`  Vector Source: ${baseline.vector_source}`)
    }
    console.log(`  Age:           ${ageInDays(baseline.created_at)} days`)
    console.log(`  Tolerated:     ${baselineViolationCount(baseline)}`)
    console.log("")
    if (signalCounts.length === 0) {
      console.log("  No tolerated hard-gate violations.")
      console.log("")
      return 0
    }

    console.log("  By signal:")
    for (const entry of signalCounts) {
      console.log(`    ${entry.signalId.padEnd(14, " ")} ${entry.count}`)
    }
    console.log("")
    return 0
  })

const ageInDays = (createdAt: string): number => {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return 0
  return Math.max(0, Math.floor((Date.now() - created.getTime()) / 86_400_000))
}
