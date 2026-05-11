import type { ObserverOutput } from "@skastr0/pulsar-core/observer"
import { fixedWidthLabel, formatDuration } from "./score-format.js"

export const pushRuntimeProfile = (
  lines: Array<string>,
  output: ObserverOutput,
  profile: boolean,
): void => {
  if (!profile) return
  if (output.runtimeProfile === undefined) {
    lines.push("  Runtime               unavailable (cached observer result)")
    return
  }
  lines.push(`  Runtime               ${formatDuration(output.runtimeProfile.totalMs)}`)
  pushRuntimeStages(lines, output)
  for (const entry of slowestRuntimeSignals(output, 5)) {
    lines.push(
      `    ${fixedWidthLabel(entry.signalId, 20)} ${formatDuration(entry.durationMs).padStart(8, " ")} score=${entry.score.toFixed(2)} diagnostics=${entry.diagnostics}`,
    )
  }
}

export const printRuntimeProfile = (output: ObserverOutput, profile: boolean): void => {
  if (!profile) return
  console.log("")
  if (output.runtimeProfile === undefined) {
    console.log("  Runtime               unavailable (cached observer result)")
    return
  }
  console.log(`  Runtime               ${formatDuration(output.runtimeProfile.totalMs)}`)
  printRuntimeStages(output)
  for (const entry of slowestRuntimeSignals(output, 5)) {
    console.log(
      `    ${fixedWidthLabel(entry.signalId, 20)} ${formatDuration(entry.durationMs).padStart(8, " ")} score=${entry.score.toFixed(2)} diagnostics=${entry.diagnostics}`,
    )
  }
}

const pushRuntimeStages = (lines: Array<string>, output: ObserverOutput): void => {
  const stages = slowestRuntimeStages(output)
  for (const entry of stages) {
    lines.push(`    ${formatRuntimeStageLabel(entry.stageId).padEnd(20, " ")} ${formatDuration(entry.durationMs).padStart(8, " ")}`)
  }
}

const printRuntimeStages = (output: ObserverOutput): void => {
  for (const entry of slowestRuntimeStages(output)) {
    console.log(`    ${formatRuntimeStageLabel(entry.stageId).padEnd(20, " ")} ${formatDuration(entry.durationMs).padStart(8, " ")}`)
  }
}

const slowestRuntimeStages = (
  output: ObserverOutput,
): ReadonlyArray<{ readonly stageId: string; readonly durationMs: number }> => {
  if (output.runtimeProfile?.stages === undefined) return []
  return Object.entries(output.runtimeProfile.stages)
    .map(([stageId, entry]) => ({ stageId, durationMs: entry.durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs || a.stageId.localeCompare(b.stageId))
}

const formatRuntimeStageLabel = (stageId: string): string =>
  stageId
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")

const slowestRuntimeSignals = (
  output: ObserverOutput,
  limit: number,
): ReadonlyArray<{
  readonly signalId: string
  readonly durationMs: number
  readonly score: number
  readonly diagnostics: number
}> => {
  if (output.runtimeProfile === undefined) return []
  return Object.entries(output.runtimeProfile.signals)
    .map(([signalId, entry]) => ({ signalId, ...entry }))
    .sort((a, b) => b.durationMs - a.durationMs || a.signalId.localeCompare(b.signalId))
    .slice(0, limit)
}
