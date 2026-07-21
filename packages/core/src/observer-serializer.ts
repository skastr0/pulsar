import { CATEGORIES } from "./category.js"
import type { Diagnostic } from "./diagnostic.js"
import { OBSERVER_OUTPUT_SEMANTICS, type CategoryOutput } from "./observer-model.js"
import { compareAscii, signalApplicabilityOf } from "./observer-score-utils.js"
import type { SignalApplicability } from "./signal.js"
import type {
  ObserverOutput,
  ObserverOutputPublic,
  SignalFactorLedgerEntrySnapshotValue,
} from "./observer-json.js"

export const toObserverJson = (output: ObserverOutput): ObserverOutputPublic => ({
  observer_semantics: OBSERVER_OUTPUT_SEMANTICS,
  categories: Object.fromEntries(
    CATEGORIES.map((category) => [
      category,
      toObserverCategorySnapshot(output.categories[category]),
    ]),
  ) as ObserverOutputPublic["categories"],
  minimum: output.minimum,
  weighted_mean: output.weighted_mean,
  ...(output.readiness !== undefined ? { readiness: output.readiness } : {}),
  hard_gate_status: output.hard_gate_status,
  hard_gate_violations: output.hard_gate_violations,
  ...(output.calibration !== undefined ? { calibration: output.calibration } : {}),
  ...(output.signalMetadata !== undefined && Object.keys(output.signalMetadata).length > 0
    ? { signal_metadata: output.signalMetadata }
    : {}),
  ...(output.signalResults.size > 0
    ? { signal_diagnostics: signalDiagnosticsJson(output) }
    : {}),
  ...(output.runtimeProfile !== undefined
    ? {
        runtime_profile: {
          total_ms: output.runtimeProfile.totalMs,
          ...(output.runtimeProfile.stages !== undefined
            ? {
                stages: Object.fromEntries(
                  Object.entries(output.runtimeProfile.stages).map(([stageId, profile]) => [
                    stageId,
                    { duration_ms: profile.durationMs },
                  ]),
                ),
              }
            : {}),
          signals: Object.fromEntries(
            Object.entries(output.runtimeProfile.signals).map(([signalId, profile]) => [
              signalId,
              {
                duration_ms: profile.durationMs,
                score: profile.score,
                diagnostics: profile.diagnostics,
              },
            ]),
          ),
        },
      }
    : {}),
  ...(signalFactorsJson(output).length > 0
    ? { signal_factors: Object.fromEntries(signalFactorsJson(output)) }
    : {}),
})

interface ObserverSignalDiagnosticsSnapshot {
  readonly score: number
  readonly applicability: SignalApplicability
  readonly emitted_count: number
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

const signalDiagnosticsJson = (
  output: ObserverOutput,
): Readonly<Record<string, ObserverSignalDiagnosticsSnapshot>> => {
  const scoredSignalIds = new Set(
    CATEGORIES.flatMap((category) => Object.keys(output.categories[category].signals)),
  )
  return Object.fromEntries(
    [...output.signalResults.entries()]
      .filter(([signalId]) => scoredSignalIds.has(signalId))
      .sort(([left], [right]) => compareAscii(left, right))
      .map(([signalId, result]) => [
        signalId,
        {
          score: result.score,
          applicability: signalApplicabilityOf(result),
          emitted_count: result.diagnostics.length,
          diagnostics: result.diagnostics,
        },
      ]),
  )
}

const signalFactorsJson = (
  output: ObserverOutput,
): ReadonlyArray<readonly [string, ReadonlyArray<SignalFactorLedgerEntrySnapshotValue>]> =>
  [...output.signalResults.entries()]
    .flatMap(([signalId, result]) =>
      result.factorLedger === undefined
        ? []
        : [[signalId, result.factorLedger.entries] as const],
    )
    .sort(([left], [right]) => compareAscii(left, right))

const toObserverCategorySnapshot = (
  category: CategoryOutput,
): ObserverOutputPublic["categories"][import("./category.js").Category] => ({
  score: category.score,
  signals: category.signals,
  signalCount: category.signalCount,
  applicableSignalCount: category.applicableSignalCount ?? category.signalCount,
  activeSignalIds: [...category.activeSignalIds],
  ...(category.aggregation !== undefined
    ? { aggregation: category.aggregation }
    : {}),
  ...(category.normalization !== undefined
    ? { normalization: category.normalization }
    : {}),
})
