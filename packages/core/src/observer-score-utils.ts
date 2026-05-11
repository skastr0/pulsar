import type { SignalRunResult } from "./runner.js"
import type { ResolvedSignal, SignalApplicability } from "./signal.js"

export const confidenceForSignal = (
  signal: ResolvedSignal,
  result: SignalRunResult,
): number =>
  clamp01(
    result.metadata?.effectiveConfidence ??
      result.metadata?.baseConfidence ??
      defaultConfidenceForTier(signal.tier),
  )

export const signalApplicabilityOf = (result: SignalRunResult): SignalApplicability =>
  result.metadata?.applicability ?? (result.output === undefined ? "failed" : "applicable")

const defaultConfidenceForTier = (tier: ResolvedSignal["tier"]): number => {
  if (tier === 1) return 1
  if (tier === 1.5) return 0.95
  if (tier === 2) return 0.85
  return 0.5
}

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

export const roundScore = (value: number): number => Number(value.toFixed(12))

export const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0
