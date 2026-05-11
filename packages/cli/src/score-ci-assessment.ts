import { type PulsarVector } from "@skastr0/pulsar-core/vector"
import { type ObserverOutput } from "@skastr0/pulsar-core/observer"
import {
  type BaselineComparison,
  compareToBaseline,
  computeObserverConfigHash,
  type Registry,
} from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"
import { readBaselineFile, resolveBaselinePath } from "./baseline-file.js"
import type { ScoreOptions } from "./score.js"

export interface CiAssessment {
  readonly mode:
    | "disabled"
    | "missing-baseline"
    | "observer-config-mismatch"
    | "ratcheted"
  readonly effectiveStatus: "pass" | "fail"
  readonly baselineSha?: string
  readonly baselineVectorId?: string
  readonly currentVectorId?: string
  readonly baselineObserverConfigHash?: string
  readonly currentObserverConfigHash?: string
  readonly comparison?: BaselineComparison
  readonly baselinePath?: string
}

export const assessCiMode = (
  opts: ScoreOptions,
  repoRoot: string,
  output: ObserverOutput,
  registry: Registry,
  vector: PulsarVector,
  calibrationFingerprint: string | undefined,
): Effect.Effect<CiAssessment, Error, never> =>
  Effect.gen(function* () {
    if (opts.ci !== true) {
      return {
        mode: "disabled",
        effectiveStatus: output.hard_gate_status,
      } satisfies CiAssessment
    }

    const baseline = yield* readBaselineFile(repoRoot)
    if (baseline === undefined) {
      return {
        mode: "missing-baseline",
        effectiveStatus: "pass",
        baselinePath: resolveBaselinePath(repoRoot),
      } satisfies CiAssessment
    }

    const currentObserverConfigHash = computeObserverConfigHash(
      registry,
      vector,
      calibrationFingerprint,
    )
    if (
      baseline.observer_config_hash !== undefined &&
      baseline.observer_config_hash !== currentObserverConfigHash
    ) {
      return {
        mode: "observer-config-mismatch",
        effectiveStatus: "fail",
        baselineSha: baseline.baseline_sha,
        ...(baseline.vector_id !== undefined ? { baselineVectorId: baseline.vector_id } : {}),
        currentVectorId: vector.id,
        baselineObserverConfigHash: baseline.observer_config_hash,
        currentObserverConfigHash,
      } satisfies CiAssessment
    }

    const comparison = compareToBaseline(baseline, output.hard_gate_violations, {
      canonicalSignalId: registry.canonicalIdOf,
    })
    return {
      mode: "ratcheted",
      effectiveStatus: comparison.newViolations.length > 0 ? "fail" : "pass",
      baselineSha: baseline.baseline_sha,
      ...(baseline.vector_id !== undefined ? { baselineVectorId: baseline.vector_id } : {}),
      currentVectorId: vector.id,
      comparison,
    } satisfies CiAssessment
  })
