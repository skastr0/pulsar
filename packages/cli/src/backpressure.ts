import { createTimeSeriesServices } from "@skastr0/pulsar-core/time-series"
import {
  type BackpressureOutput,
  type BackpressureTrendEntry,
  type CategoryBackpressure,
  evaluateBackpressure,
  evaluateBackpressureTrend,
} from "@skastr0/pulsar-core/backpressure"
import { CATEGORIES } from "@skastr0/pulsar-core/signal"
import { Effect } from "effect"
import { writeJsonToStdout } from "./cli-output.js"
import { buildPulsarRegistry, resolveRepoRoot } from "./runtime.js"
import {
  discoverPulsarVector,
  type DiscoveredPulsarVector,
} from "./vector-discovery.js"

interface BackpressureCommandOptions {
  readonly repoPath: string
  readonly vectorPath?: string
  readonly trend?: boolean
  readonly json?: boolean
}

export const runBackpressureCommand = (
  opts: BackpressureCommandOptions,
): Effect.Effect<number, Error, never> =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const registry = yield* buildPulsarRegistry(repoRoot)
    const vectorSelection = yield* discoverPulsarVector({
      repoPath: repoRoot,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const timeSeries = createTimeSeriesServices(repoRoot)
    const entries = yield* timeSeries.reader.entries()
    const output = evaluateBackpressure(entries, vectorSelection.vector)
    const trend =
      opts.trend === true
        ? evaluateBackpressureTrend(entries, vectorSelection.vector)
        : undefined

    if (opts.json === true) {
      yield* Effect.tryPromise({
        try: () =>
          writeJsonToStdout(
            toBackpressureJson(repoRoot, vectorSelection, output, trend),
          ),
        catch: (cause) =>
          new Error(`Failed to write backpressure JSON: ${String(cause)}`),
      })
      return 0
    }

    if (trend !== undefined) {
      printTrendView(
        repoRoot,
        vectorSelection.label,
        vectorSelection.sourceLabel,
        output,
        trend,
      )
      return 0
    }

    printBackpressureView(
      repoRoot,
      vectorSelection.label,
      vectorSelection.sourceLabel,
      output,
    )
    return 0
  })

const printBackpressureView = (
  repoRoot: string,
  vectorLabel: string,
  vectorSourceLabel: string,
  output: BackpressureOutput,
): void => {
  console.log("")
  console.log(`  Repo:            ${repoRoot}`)
  console.log(`  Vector:          ${vectorLabel}`)
  console.log(`  Vector Source:   ${vectorSourceLabel}`)
  console.log(`  Overall:         ${output.overall}`)
  console.log(`  Evidence State:  ${output.evidenceState}`)
  console.log(
    `  Evidence Count:  ${output.evidenceObservationCount}/${output.observationCount} usable observations`,
  )
  if (output.evidenceState !== "available") {
    console.log(`  Reason:          ${output.evidenceReason}`)
  }
  console.log(`  Trend Window:    ${output.trajectoryDays} days`)
  console.log("")
  console.log("  Categories:")
  for (const category of CATEGORIES) {
    const entry = output.byCategory[category]
    const metrics =
      entry.evidenceState === "available"
        ? ` score=${entry.currentScore.toFixed(2)} slope=${entry.trajectorySlope.toFixed(3)}`
        : entry.currentScore !== undefined
          ? ` score=${entry.currentScore.toFixed(2)}`
          : ""
    const reason =
      entry.evidenceState === "available"
        ? ""
        : ` reason=${entry.evidenceReason}`
    console.log(
      `    ${category.padEnd(22, " ")} ${entry.level.padEnd(11, " ")}${metrics} observations=${entry.observationCount}${reason}`,
    )
  }
  console.log("")
  console.log("  Rationale:")
  for (const line of output.rationale) {
    console.log(`    - ${line}`)
  }
  console.log("")
  if (output.evidenceState === "available") {
    console.log(`  Goodhart:        ${output.goodhart.suspicion}`)
    for (const line of output.goodhart.rationale) {
      console.log(`    - ${line}`)
    }
  } else {
    console.log("  Goodhart:        unavailable")
  }
  console.log("")
}

const printTrendView = (
  repoRoot: string,
  vectorLabel: string,
  vectorSourceLabel: string,
  output: BackpressureOutput,
  trend: ReadonlyArray<BackpressureTrendEntry>,
): void => {
  printBackpressureView(repoRoot, vectorLabel, vectorSourceLabel, output)
  console.log("  Trend:")
  if (trend.length === 0) {
    console.log("    (no persisted observations yet)")
    console.log("")
    return
  }

  for (const entry of trend) {
    const readiness =
      entry.readinessStatus !== undefined
        ? ` readiness_status=${entry.readinessStatus}`
        : ""
    if (entry.evidenceState === "available") {
      const readinessPressure =
        entry.readinessPressure !== undefined
          ? ` readiness_pressure=${entry.readinessPressure.toFixed(2)}`
          : ""
      console.log(
        `    ${entry.timestamp} ${entry.sha.slice(0, 12).padEnd(12, " ")} ${entry.overall.padEnd(11, " ")} weighted=${entry.weightedMean.toFixed(2)} evidence=${entry.evidenceObservationCount}/${entry.observationCount}${readiness}${readinessPressure} gate=${entry.hardGateStatus}`,
      )
      continue
    }

    console.log(
      `    ${entry.timestamp} ${entry.sha.slice(0, 12).padEnd(12, " ")} ${entry.overall.padEnd(11, " ")} evidence=${entry.evidenceObservationCount}/${entry.observationCount} reason=${entry.evidenceReason}${readiness} gate=${entry.hardGateStatus}`,
    )
  }
  console.log("")
}

const toBackpressureJson = (
  repoRoot: string,
  vectorSelection: DiscoveredPulsarVector,
  output: BackpressureOutput,
  trend: ReadonlyArray<BackpressureTrendEntry> | undefined,
): unknown => ({
  backpressure_semantics: output.backpressureSemantics,
  repo: repoRoot,
  vector: {
    id: vectorSelection.label,
    source: vectorSelection.source,
    source_label: vectorSelection.sourceLabel,
    trust_boundary: vectorSelection.trustBoundary,
    ...(vectorSelection.path !== undefined ? { path: vectorSelection.path } : {}),
  },
  overall: output.overall,
  evidence_state: output.evidenceState,
  ...(output.evidenceState !== "available"
    ? { evidence_reason: output.evidenceReason }
    : {}),
  observation_count: output.observationCount,
  evidence_observation_count: output.evidenceObservationCount,
  trajectory_days: output.trajectoryDays,
  categories: Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      toCategoryBackpressureJson(output.byCategory[category]),
    ]),
  ),
  rationale: output.rationale,
  ...(output.evidenceState === "available"
    ? { goodhart: toGoodhartJson(output.goodhart) }
    : {}),
  ...(trend !== undefined
    ? { trend: trend.map((entry) => toTrendEntryJson(entry)) }
    : {}),
})

const toCategoryBackpressureJson = (entry: CategoryBackpressure): unknown => ({
  level: entry.level,
  evidence_state: entry.evidenceState,
  ...(entry.evidenceState !== "available"
    ? { evidence_reason: entry.evidenceReason }
    : {}),
  observation_count: entry.observationCount,
  ...(entry.currentScore !== undefined
    ? { current_score: entry.currentScore }
    : {}),
  ...(entry.evidenceState === "available"
    ? { trajectory_slope: entry.trajectorySlope }
    : {}),
  triggers: entry.triggers,
})

const toGoodhartJson = (
  goodhart: Extract<BackpressureOutput, { evidenceState: "available" }>["goodhart"],
): unknown => ({
  suspicion: goodhart.suspicion,
  rationale: goodhart.rationale,
  visible_signal_ids: goodhart.visibleSignalIds,
  hidden_signal_ids: goodhart.hiddenSignalIds,
  visible_score: goodhart.visibleScore,
  hidden_score: goodhart.hiddenScore,
  holdout_gap: goodhart.holdoutGap,
  visible_trend: goodhart.visibleTrend,
  hidden_trend: goodhart.hiddenTrend,
  velocity_excess: goodhart.velocityExcess,
  rotation_window_days: goodhart.rotationWindowDays,
})

const toTrendEntryJson = (entry: BackpressureTrendEntry): unknown => ({
  sha: entry.sha,
  timestamp: entry.timestamp,
  overall: entry.overall,
  evidence_state: entry.evidenceState,
  ...(entry.evidenceState !== "available"
    ? { evidence_reason: entry.evidenceReason }
    : {}),
  observation_count: entry.observationCount,
  evidence_observation_count: entry.evidenceObservationCount,
  ...(entry.evidenceState === "available"
    ? {
        weighted_mean: entry.weightedMean,
        ...(entry.readinessScore !== undefined
          ? { readiness_score: entry.readinessScore }
          : {}),
        ...(entry.readinessPressure !== undefined
          ? { readiness_pressure: entry.readinessPressure }
          : {}),
      }
    : {}),
  ...(entry.readinessStatus !== undefined
    ? { readiness_status: entry.readinessStatus }
    : {}),
  hard_gate_status: entry.hardGateStatus,
})
