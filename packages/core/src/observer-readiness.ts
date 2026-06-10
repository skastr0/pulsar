import { hasPoisonAuthority } from "./enforcement.js"
import type { Registry } from "./registry.js"
import type { SignalRunResult } from "./runner.js"
import type { ResolvedSignal } from "./signal.js"
import { readinessConfigOf, type PulsarVector, type ReadinessObserverConfig, weightOf as vectorWeightOf } from "./vector.js"
import type {
  ReadinessBand,
  ReadinessOutput,
  ReadinessPressure,
  ReadinessPressureSource,
} from "./observer-model.js"
import { poisonRampPressure } from "./observer-local-pressure.js"
import { clamp01, compareAscii, confidenceForSignal, roundScore, signalApplicabilityOf } from "./observer-score-utils.js"

export const computeReadiness = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: PulsarVector | undefined,
  hardGateStatus: "pass" | "fail",
): ReadinessOutput => {
  const config = readinessConfigOf(vector)
  const collected = collectReadinessPressures(registry, signalResults, vector, config)
  const summary = summarizeReadinessPressure(collected, config, hardGateStatus)
  return {
    score: summary.score,
    pressure: summary.pressure,
    status: readinessStatus(
      summary.pressure,
      hardGateStatus,
      config,
      collected.applicableSignalCount,
      collected.failedSignalCount,
    ),
    ...(collected.applicableSignalCount > 0
      ? { band: readinessBandOf(summary.pressure, config) }
      : {}),
    aggregation: {
      strategy: "pressure-pnorm-local-max",
      p: config.p_norm,
      mean_pressure: roundScore(summary.meanPressure),
      pnorm_pressure: roundScore(summary.pnormPressure),
      max_local_pressure: roundScore(collected.maxLocalPressure),
      authority_max_local_pressure: roundScore(collected.maxAuthorityLocalPressure),
      local_poison_pressure: roundScore(summary.poisonGrade),
      hard_gate_pressure: roundScore(summary.hardGatePressure),
      hard_gate_score_cap: config.hard_gate_score_cap,
      local_warning_threshold: config.local_warning_threshold,
      local_poison_threshold: config.local_poison_threshold,
      local_warning_gain: config.local_warning_gain,
      dominant_pressure_source: summary.dominantPressureSource,
      band_margin: roundScore(bandMarginOf(summary.pressure, config)),
      evidence_mean: roundScore(summary.evidenceMean),
      applicable_signal_count: collected.applicableSignalCount,
      ignored_signal_count: collected.ignoredSignalCount,
      failed_signal_count: collected.failedSignalCount,
    },
    top_pressures: topReadinessPressures(collected.pressures, config),
  }
}

export const readinessBandOf = (
  pressure: number,
  config: Pick<ReadinessObserverConfig, "green_max_pressure" | "red_min_pressure">,
): ReadinessBand =>
  pressure < config.green_max_pressure
    ? "green"
    : pressure < config.red_min_pressure
      ? "yellow"
      : "red"

interface ReadinessPressureCollection {
  readonly pressures: ReadonlyArray<ReadinessPressure>
  readonly weightedPressureSum: number
  readonly weightedPnormSum: number
  readonly weightTotal: number
  readonly maxLocalPressure: number
  readonly maxAuthorityLocalPressure: number
  readonly applicableSignalCount: number
  readonly ignoredSignalCount: number
  readonly failedSignalCount: number
}

interface ReadinessPressureSummary {
  readonly score: number
  readonly pressure: number
  readonly meanPressure: number
  readonly pnormPressure: number
  readonly poisonGrade: number
  readonly hardGatePressure: number
  readonly dominantPressureSource: ReadinessPressureSource
  readonly evidenceMean: number
}

interface ReadinessPressureContribution {
  readonly pressure: ReadinessPressure
  readonly ignored: boolean
  readonly failed: boolean
  readonly weight: number
  readonly effectivePressure: number
  readonly poisonAuthority: boolean
}

const collectReadinessPressures = (
  registry: Registry,
  signalResults: ReadonlyMap<string, SignalRunResult>,
  vector: PulsarVector | undefined,
  config: ReadinessObserverConfig,
): ReadinessPressureCollection => {
  const pressures: ReadinessPressure[] = []
  let weightedPressureSum = 0
  let weightedPnormSum = 0
  let weightTotal = 0
  let maxLocalPressure = 0
  let maxAuthorityLocalPressure = 0
  let applicableSignalCount = 0
  let ignoredSignalCount = 0
  let failedSignalCount = 0

  for (const signal of registry.sorted) {
    const result = signalResults.get(signal.id)
    if (result === undefined) continue

    const contribution = readinessPressureContribution(signal, result, vector)
    pressures.push(contribution.pressure)

    if (contribution.ignored) {
      ignoredSignalCount += 1
      if (contribution.failed) {
        failedSignalCount += 1
      }
      continue
    }

    applicableSignalCount += 1
    weightedPressureSum += contribution.weight * contribution.effectivePressure
    weightedPnormSum += contribution.weight * Math.pow(contribution.effectivePressure, config.p_norm)
    weightTotal += contribution.weight
    maxLocalPressure = Math.max(maxLocalPressure, contribution.effectivePressure)
    if (contribution.poisonAuthority) {
      maxAuthorityLocalPressure = Math.max(maxAuthorityLocalPressure, contribution.effectivePressure)
    }
  }

  return {
    pressures,
    weightedPressureSum,
    weightedPnormSum,
    weightTotal,
    maxLocalPressure,
    maxAuthorityLocalPressure,
    applicableSignalCount,
    ignoredSignalCount,
    failedSignalCount,
  }
}

const readinessPressureContribution = (
  signal: ResolvedSignal,
  result: SignalRunResult,
  vector: PulsarVector | undefined,
): ReadinessPressureContribution => {
  const applicability = signalApplicabilityOf(result)
  const ignored = applicability !== "applicable"
  const confidence = ignored ? 0 : confidenceForSignal(signal, result)
  const weight = vectorWeightOf(signal, vector)
  const rawPressure = clamp01(1 - result.score)
  const effectivePressure = rawPressure * confidence
  const poisonAuthority = hasPoisonAuthority(signal)

  return {
    pressure: {
      signal_id: signal.id,
      category: signal.category,
      score: result.score,
      raw_pressure: roundScore(rawPressure),
      effective_pressure: roundScore(effectivePressure),
      weight,
      confidence: roundScore(confidence),
      applicability,
      poison_authority: poisonAuthority,
    },
    ignored,
    failed: applicability === "failed",
    weight,
    effectivePressure,
    poisonAuthority,
  }
}

const summarizeReadinessPressure = (
  collection: ReadinessPressureCollection,
  config: ReadinessObserverConfig,
  hardGateStatus: "pass" | "fail",
): ReadinessPressureSummary => {
  const { weightTotal } = collection
  const meanPressure = weightTotal === 0 ? 0 : collection.weightedPressureSum / weightTotal
  const pnormPressure =
    weightTotal === 0
      ? 0
      : Math.pow(collection.weightedPnormSum / weightTotal, 1 / config.p_norm)
  // Only proof-grade signals (tier 1/1.5) reach the poison ramp; heuristic
  // severity is summarized by the p-norm instead of becoming the verdict.
  const poisonGrade = poisonRampPressure(collection.maxAuthorityLocalPressure, config)
  const hardGatePressure =
    hardGateStatus === "fail" ? 1 - config.hard_gate_score_cap : 0
  // Signal failures are an engine fact, not a quality measurement: they
  // shape `status`, never the score.
  const pressure = roundScore(
    clamp01(Math.max(pnormPressure, poisonGrade, hardGatePressure)),
  )
  return {
    score: roundScore(clamp01(1 - pressure)),
    pressure,
    meanPressure,
    pnormPressure,
    poisonGrade,
    hardGatePressure,
    dominantPressureSource: dominantPressureSource(pnormPressure, poisonGrade, hardGatePressure),
    evidenceMean: clamp01(1 - meanPressure),
  }
}

const dominantPressureSource = (
  pnorm: number,
  poison: number,
  hardGate: number,
): ReadinessPressureSource =>
  hardGate >= poison && hardGate >= pnorm && hardGate > 0
    ? "hard_gate"
    : poison >= pnorm && poison > 0
      ? "local_poison"
      : "pnorm"

const bandMarginOf = (
  pressure: number,
  config: Pick<ReadinessObserverConfig, "green_max_pressure" | "red_min_pressure">,
): number => {
  const greenDistance = config.green_max_pressure - pressure
  const redDistance = config.red_min_pressure - pressure
  return Math.abs(greenDistance) <= Math.abs(redDistance) ? greenDistance : redDistance
}

const topReadinessPressures = (
  pressures: ReadonlyArray<ReadinessPressure>,
  config: ReadinessObserverConfig,
): ReadonlyArray<ReadinessPressure> =>
  [...pressures]
    .sort((left, right) =>
      right.effective_pressure - left.effective_pressure ||
      right.raw_pressure - left.raw_pressure ||
      compareAscii(left.signal_id, right.signal_id),
    )
    .slice(0, config.top_pressures)

const readinessStatus = (
  pressure: number,
  hardGateStatus: "pass" | "fail",
  config: ReadinessObserverConfig,
  applicableSignalCount: number,
  failedSignalCount: number,
): ReadinessOutput["status"] => {
  if (hardGateStatus === "fail") return "blocked"
  if (failedSignalCount > 0) return "failed"
  if (applicableSignalCount === 0) return "unknown"
  return readinessBandOf(pressure, config)
}
