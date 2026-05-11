import { Effect, Option } from "effect"
import { CalibrationContextTag } from "./calibration.js"
import type { Registry } from "./registry.js"
import type { SignalRequirements } from "./signal.js"
import type { PulsarVector } from "./vector.js"
import { aggregateCategories } from "./observer-categories.js"
import { executeObserverSignals, summarizeCalibration } from "./observer-execution.js"
import { collectHardGateViolations, findMinimum } from "./observer-minimum.js"
import { OBSERVER_OUTPUT_SEMANTICS } from "./observer-model.js"
import { computeReadiness } from "./observer-readiness.js"
import { nowMs, roundRuntimeMs } from "./observer-time.js"
import { computeWeightedMean } from "./observer-weighted-mean.js"
import type { ObserverOutput } from "./observer-json.js"
export * from "./observer-model.js"
export * from "./observer-json.js"
export { toObserverJson } from "./observer-serializer.js"

interface ObserverOptions {
  readonly profile?: boolean
}

/**
 * Run every active signal in the registry against the ambient context,
 * then aggregate the results into the canonical ObserverOutput shape.
 *
 * Error channel is `never` because per-signal compute failures are
 * captured as score-0 warn diagnostics inside the signal's category
 * (AC-8). This keeps one flaky signal from collapsing the whole
 * observation.
 *
 * Requirements `R` is left open — it is whatever the active signals
 * demand (e.g. TsProjectTag for the TS pack). The caller provides the
 * layer union exactly as they do for runSignal.
 */
export const observe = (
  registry: Registry,
  vector: PulsarVector | undefined,
  options?: ObserverOptions,
): Effect.Effect<ObserverOutput, never, SignalRequirements> =>
  Effect.gen(function* () {
    const observerStartedAt = nowMs()
    const executed = yield* executeObserverSignals(registry, vector, options?.profile === true)
    const categories = aggregateCategories(registry, executed.signalResults, vector)
    const minimum = findMinimum(registry, executed.signalResults)
    const weighted_mean = computeWeightedMean(categories)
    const hard_gate_violations = collectHardGateViolations(registry, executed.signalResults)
    const hard_gate_status: "pass" | "fail" =
      hard_gate_violations.length > 0 ? "fail" : "pass"
    const readiness = computeReadiness(registry, executed.signalResults, vector, hard_gate_status)
    const calibration = yield* Effect.serviceOption(CalibrationContextTag)
    const calibrationSummary = Option.isSome(calibration)
      ? summarizeCalibration(calibration.value)
      : undefined

    return {
      observer_semantics: OBSERVER_OUTPUT_SEMANTICS,
      categories,
      minimum,
      weighted_mean,
      readiness,
      hard_gate_status,
      hard_gate_violations,
      inactiveSignals: executed.inactiveSignals,
      signalResults: executed.signalResults,
      ...(calibrationSummary !== undefined ? { calibration: calibrationSummary } : {}),
      ...(Object.keys(executed.signalMetadata).length > 0
        ? { signalMetadata: executed.signalMetadata }
        : {}),
      ...(options?.profile === true
        ? {
            runtimeProfile: {
              totalMs: roundRuntimeMs(nowMs() - observerStartedAt),
              signals: executed.signalProfiles,
            },
          }
        : {}),
    }
  })
