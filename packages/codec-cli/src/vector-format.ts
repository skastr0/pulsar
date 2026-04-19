import { weightOf, type TasteVector } from "@taste-codec/core"

export interface VectorDiffSummary {
  readonly weightChanges: ReadonlyArray<string>
  readonly configChanges: ReadonlyArray<string>
  readonly modeChanges: ReadonlyArray<string>
}

export const summarizeVectorDiff = (
  current: TasteVector | undefined,
  target: TasteVector,
): VectorDiffSummary => {
  const currentOverrides = current?.signal_overrides ?? {}
  const targetOverrides = target.signal_overrides
  const signalIds = [...new Set([...Object.keys(currentOverrides), ...Object.keys(targetOverrides)])].sort(
    (left, right) => left.localeCompare(right),
  )

  const weightChanges: Array<string> = []
  const configChanges: Array<string> = []
  for (const signalId of signalIds) {
    const currentWeight = weightOf(signalId, current)
    const targetWeight = weightOf(signalId, target)
    if (Math.abs(currentWeight - targetWeight) >= 0.01) {
      const delta = targetWeight - currentWeight
      weightChanges.push(
        `${signalId.padEnd(10)} ${formatNumber(currentWeight)} -> ${formatNumber(targetWeight)} (${formatSigned(delta)})`,
      )
    }

    const currentConfig = currentOverrides[signalId]?.config
    const targetConfig = targetOverrides[signalId]?.config
    if (stableJson(currentConfig) !== stableJson(targetConfig)) {
      configChanges.push(
        `${signalId.padEnd(10)} ${stableJson(currentConfig) ?? "<default>"} -> ${stableJson(targetConfig) ?? "<default>"}`,
      )
    }
  }

  const modeChanges: Array<string> = []
  const currentAi = current?.modes?.ai_assisted ?? false
  const targetAi = target.modes?.ai_assisted ?? false
  if (currentAi !== targetAi) {
    modeChanges.push(`ai_assisted ${String(currentAi)} -> ${String(targetAi)}`)
  }

  return { weightChanges, configChanges, modeChanges }
}

export const renderVectorDiff = (summary: VectorDiffSummary): ReadonlyArray<string> => {
  const lines: Array<string> = []
  if (summary.weightChanges.length > 0) {
    lines.push("Weight deltas:")
    lines.push(...summary.weightChanges.map((line) => `  ${line}`))
  }
  if (summary.configChanges.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("Config deltas:")
    lines.push(...summary.configChanges.map((line) => `  ${line}`))
  }
  if (summary.modeChanges.length > 0) {
    if (lines.length > 0) lines.push("")
    lines.push("Mode deltas:")
    lines.push(...summary.modeChanges.map((line) => `  ${line}`))
  }
  if (lines.length === 0) {
    lines.push("No effective vector differences.")
  }
  return lines
}

const formatNumber = (value: number): string => value.toFixed(2)

const formatSigned = (value: number): string => `${value >= 0 ? "+" : ""}${value.toFixed(2)}`

const stableJson = (value: unknown): string | undefined => {
  if (value === undefined) return undefined
  return JSON.stringify(value, Object.keys((value as Record<string, unknown>) ?? {}).sort())
}
