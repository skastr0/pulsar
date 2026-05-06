import {
  CATEGORIES,
  createTimeSeriesServices,
  evaluateBackpressure,
  evaluateBackpressureTrend,
  type BackpressureOutput,
} from "@taste-codec/core"
import { Effect } from "effect"
import { buildCodecRegistry, resolveRepoRoot } from "./runtime.js"
import { discoverTasteVector } from "./vector-discovery.js"

export interface BackpressureCommandOptions {
  readonly repoPath: string
  readonly vectorPath?: string
  readonly trend?: boolean
}

export const runBackpressureCommand = (opts: BackpressureCommandOptions) =>
  Effect.gen(function* () {
    const repoRoot = yield* resolveRepoRoot(opts.repoPath)
    const registry = yield* buildCodecRegistry(repoRoot)
    const vectorSelection = yield* discoverTasteVector({
      repoPath: repoRoot,
      registry,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
    })
    const timeSeries = createTimeSeriesServices(repoRoot)
    const entries = yield* timeSeries.reader.entries()
    const output = evaluateBackpressure(entries, vectorSelection.vector)

    if (opts.trend === true) {
      printTrendView(
        repoRoot,
        vectorSelection.label,
        vectorSelection.sourceLabel,
        output,
        evaluateBackpressureTrend(entries, vectorSelection.vector),
      )
      return 0
    }

    printBackpressureView(repoRoot, vectorSelection.label, vectorSelection.sourceLabel, output)
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
  console.log(`  Trend Window:    ${output.trajectoryDays} days`)
  console.log("")
  console.log("  Categories:")
  for (const category of CATEGORIES) {
    const entry = output.byCategory[category]
    console.log(
      `    ${category.padEnd(22, " ")} ${entry.level.padEnd(6, " ")} score=${entry.currentScore.toFixed(2)} slope=${entry.trajectorySlope.toFixed(3)}`,
    )
  }
  console.log("")
  console.log("  Rationale:")
  for (const line of output.rationale) {
    console.log(`    - ${line}`)
  }
  console.log("")
  console.log(`  Goodhart:        ${output.goodhart.suspicion}`)
  for (const line of output.goodhart.rationale) {
    console.log(`    - ${line}`)
  }
  console.log("")
}

const printTrendView = (
  repoRoot: string,
  vectorLabel: string,
  vectorSourceLabel: string,
  output: BackpressureOutput,
  trend: ReturnType<typeof evaluateBackpressureTrend>,
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
      entry.readinessPressure !== undefined
        ? ` readiness_pressure=${entry.readinessPressure.toFixed(2)}`
        : ""
    console.log(
      `    ${entry.timestamp} ${entry.sha.slice(0, 12).padEnd(12, " ")} ${entry.overall.padEnd(6, " ")} weighted=${entry.weightedMean.toFixed(2)}${readiness} gate=${entry.hardGateStatus}`,
    )
  }
  console.log("")
}
