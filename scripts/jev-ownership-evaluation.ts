#!/usr/bin/env bun
/**
 * Independent ownership-preference evaluation through the production Jev evaluator.
 * Sealed expectations stay in ./jev-ownership-evaluation/expectations.ts and are
 * applied only after receipts are written.
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Effect } from "effect"
import {
  compileOwnershipRequestSync,
  evaluateOwnershipGroups,
  jevClientLayerFromEnv,
  type OwnershipGroupAssessment,
} from "../packages/cli/src/jev/index.ts"
import { outcomeOf, oppositePolicyPairs, hostFromOutcomes } from "./jev-ownership-evaluation/compare.ts"
import { buildLiveArms, type LiveArm } from "./jev-ownership-evaluation/requests.ts"

const ARTIFACT_DIR = resolve(import.meta.dir, "../.amp/in/artifacts/jev-ownership-evaluation")
const CONCURRENCY = 4

const percentile = (values: ReadonlyArray<number>, p: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))
  return sorted[index]!
}

const compactAssessment = (assessment: OwnershipGroupAssessment) => ({
  groupId: assessment.groupId,
  status: assessment.status,
  selectedAnchorId: assessment.selectedAnchorId,
  rawSelectedAnchorId: assessment.rawSelectedAnchorId,
  distribution: assessment.distribution,
  selectionGate: assessment.selectionGate,
  modelConfidence: assessment.modelConfidence,
  modelId: assessment.modelId,
  promptId: assessment.promptId,
  promptFingerprint: assessment.promptFingerprint,
  requestSha256: assessment.requestSha256,
  contentHash: assessment.contentHash,
  inputFingerprint: assessment.inputFingerprint,
  policyFingerprint: assessment.policyFingerprint,
  rubricFingerprint: assessment.rubricFingerprint,
  usage: assessment.usage,
  elapsedMs: assessment.elapsedMs,
  requestId: assessment.requestId,
  rawResponse: assessment.rawResponse,
})

const compactRequest = (arm: LiveArm) => {
  const compiled = compileOwnershipRequestSync(arm.input)
  return {
    runId: arm.runId,
    requestSha256: compiled.requestSha256,
    promptFingerprint: compiled.promptFingerprint,
    modelId: compiled.modelId,
    request: compiled.request,
  }
}

const main = async () => {
  const arms = buildLiveArms()
  if (process.argv.includes("--plan")) {
    console.log(JSON.stringify({ calls: arms.length, arrangements: [...new Set(arms.map((arm) => arm.arrangement))] }, null, 2))
    return
  }
  mkdirSync(ARTIFACT_DIR, { recursive: true })
  const started = Date.now()
  const assessments = await Effect.runPromise(
    evaluateOwnershipGroups(
      arms.map((arm) => arm.input),
      CONCURRENCY,
    ).pipe(Effect.provide(jevClientLayerFromEnv)),
  )
  if (assessments.length !== arms.length) throw new Error("assessment count drifted from plan")
  const outcomes = arms.map((arm, index) => outcomeOf(arm, assessments[index]!))
  const receipts = {
    schema: "pulsar.jev_ownership_evaluation.receipts.v1",
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date().toISOString(),
    model: "jev-1.13.0",
    promptId: assessments[0]?.promptId ?? null,
    concurrency: CONCURRENCY,
    calls: arms.length,
    requests: arms.map(compactRequest),
    assessments: assessments.map(compactAssessment),
    outcomes,
  }
  const stamp = String(started)
  const receiptPath = resolve(ARTIFACT_DIR, `receipts-${stamp}.json`)
  writeFileSync(receiptPath, `${JSON.stringify(receipts)}\n`)

  const latencies = outcomes.map((row) => row.elapsedMs)
  const mismatches = outcomes.filter((row) => !row.match)
  const byArrangement: Record<string, { calls: number; matches: number; unresolved: number }> = {}
  for (const row of outcomes) {
    const bucket = (byArrangement[row.arrangement] ??= { calls: 0, matches: 0, unresolved: 0 })
    bucket.calls += 1
    if (row.match) bucket.matches += 1
    if (row.status === "unresolved") bucket.unresolved += 1
  }
  const pairs = oppositePolicyPairs(outcomes)
  const primaryShared = outcomes.filter(
    (row) => row.preference === "shared_domain_rule" && row.perturbation === "none" && row.repeat === 1,
  )
  const primaryLocal = outcomes.filter(
    (row) => row.preference === "caller_local" && row.perturbation === "none" && row.repeat === 1,
  )
  const hostShared = hostFromOutcomes(
    primaryShared.map((row) => row.caseId),
    primaryShared,
  )
  const hostLocal = hostFromOutcomes(
    primaryLocal.map((row) => row.caseId),
    primaryLocal,
  )
  const summary = {
    schema: "pulsar.jev_ownership_evaluation.summary.v1",
    receiptPath,
    calls: outcomes.length,
    matches: outcomes.filter((row) => row.match).length,
    mismatches: mismatches.length,
    unresolved: outcomes.filter((row) => row.status === "unresolved").length,
    notApplicable: outcomes.filter((row) => row.status === "not_applicable").length,
    tokens: {
      input: outcomes.reduce((sum, row) => sum + row.inputTokens, 0),
      output: outcomes.reduce((sum, row) => sum + row.outputTokens, 0),
    },
    latencyMs: {
      min: Math.min(...latencies),
      p50: percentile(latencies, 0.5),
      p90: percentile(latencies, 0.9),
      max: Math.max(...latencies),
    },
    byArrangement,
    oppositePolicy: pairs.map((pair) => ({
      caseId: pair.caseId,
      arrangement: pair.arrangement,
      flipped: pair.flipped,
      shared: pair.shared && {
        status: pair.shared.status,
        selected: pair.shared.selectedAnchorId,
        raw: pair.shared.rawSelectedAnchorId,
        match: pair.shared.match,
      },
      local: pair.local && {
        status: pair.local.status,
        selected: pair.local.selectedAnchorId,
        raw: pair.local.rawSelectedAnchorId,
        match: pair.local.match,
      },
    })),
    hostShared: { ...hostShared.aggregate, comparison: hostShared.comparison },
    hostLocal: { ...hostLocal.aggregate, comparison: hostLocal.comparison },
    mismatchRows: mismatches.map((row) => ({
      runId: row.runId,
      arrangement: row.arrangement,
      preference: row.preference,
      expected: row.expected,
      actual: {
        status: row.status,
        selected: row.selectedAnchorId,
        raw: row.rawSelectedAnchorId,
        gate: row.gatePassed,
        winner: row.winnerProbability,
        margin: row.margin,
        distribution: row.distribution,
      },
      mismatchKind: row.mismatchKind,
    })),
  }
  const summaryPath = resolve(ARTIFACT_DIR, `summary-${stamp}.json`)
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(
    JSON.stringify(
      {
        calls: summary.calls,
        matches: summary.matches,
        mismatches: summary.mismatches,
        unresolved: summary.unresolved,
        notApplicable: summary.notApplicable,
        tokens: summary.tokens,
        latencyMs: summary.latencyMs,
        hostShared: summary.hostShared,
        hostLocal: summary.hostLocal,
        mismatchArrangements: [...new Set(mismatches.map((row) => `${row.arrangement}/${row.preference}`))],
        receiptPath,
        summaryPath,
      },
      null,
      2,
    ),
  )
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "evaluation failed")
    process.exitCode = 1
  })
}
