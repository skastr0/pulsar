import { OBSERVER_OUTPUT_SEMANTICS, type CategoryOutput } from "./observer-model.js"
import type {
  ObserverOutput,
  ObserverOutputPublic,
  SignalFactorLedgerEntrySnapshotValue,
} from "./observer-json.js"

export const toObserverJson = (output: ObserverOutput): ObserverOutputPublic => ({
  observer_semantics: OBSERVER_OUTPUT_SEMANTICS,
  categories: {
    "architectural-drift": toObserverCategorySnapshot(
      output.categories["architectural-drift"],
    ),
    "dependency-entropy": toObserverCategorySnapshot(
      output.categories["dependency-entropy"],
    ),
    "abstraction-bloat": toObserverCategorySnapshot(
      output.categories["abstraction-bloat"],
    ),
    "legibility-decay": toObserverCategorySnapshot(
      output.categories["legibility-decay"],
    ),
    "generated-slop": toObserverCategorySnapshot(
      output.categories["generated-slop"],
    ),
    "review-pain": toObserverCategorySnapshot(output.categories["review-pain"]),
  },
  minimum: output.minimum,
  weighted_mean: output.weighted_mean,
  ...(output.readiness !== undefined ? { readiness: output.readiness } : {}),
  hard_gate_status: output.hard_gate_status,
  hard_gate_violations: output.hard_gate_violations,
  ...(output.calibration !== undefined ? { calibration: output.calibration } : {}),
  ...(output.signalMetadata !== undefined && Object.keys(output.signalMetadata).length > 0
    ? { signal_metadata: output.signalMetadata }
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

const signalFactorsJson = (
  output: ObserverOutput,
): ReadonlyArray<readonly [string, ReadonlyArray<SignalFactorLedgerEntrySnapshotValue>]> =>
  [...output.signalResults.entries()]
    .flatMap(([signalId, result]) =>
      result.factorLedger === undefined
        ? []
        : [[signalId, result.factorLedger.entries] as const],
    )
    .sort(([left], [right]) => left.localeCompare(right))

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
