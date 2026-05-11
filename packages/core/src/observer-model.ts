import type { Category } from "./category.js"
import { ProjectModuleScope } from "./calibration.js"
import type { Diagnostic } from "./diagnostic.js"
import type { SignalRunResult } from "./runner.js"
import type { SignalApplicability, SignalOutputMetadata } from "./signal.js"

export const OBSERVER_OUTPUT_SEMANTICS = "applicability-aware-readiness-v1" as const
export type ObserverOutputSemantics = typeof OBSERVER_OUTPUT_SEMANTICS

/**
 * The top-level scoring output — a dimension vector grouped by taxonomy
 * category, the minimum dimension, a weighted mean, and hard-gate status.
 *
 * Mirrors ARCHITECTURE.md §Score Output. The public JSON contract keeps
 * the architecture doc's snake_case keys (`weighted_mean`,
 * `hard_gate_status`, `hard_gate_violations`). Additional runtime-only
 * metadata (`inactiveSignals`, `signalResults`) stays attached for
 * in-process consumers such as tests and compound signals.
 */
export interface CategoryOutput {
  readonly score: number
  readonly signals: Record<string, number>
  readonly signalCount: number
  readonly applicableSignalCount?: number
  readonly activeSignalIds: ReadonlyArray<string>
  readonly aggregation?: {
    readonly strategy: "weighted-mean" | "language-group-mean"
    readonly rawScore: number
    readonly aggregateScore: number
    readonly lowestSignalScore: number
    readonly finalScore: number
    readonly shapedByPressure: boolean
    readonly pressure: {
      readonly strategy: "pressure-pnorm-local-max"
      readonly p: number
      readonly meanPressure: number
      readonly pnormPressure: number
      readonly maxLocalPressure: number
      readonly localPressure: number
      readonly finalPressure: number
    }
    readonly weightTotal: number
    readonly weights: Record<string, number>
  }
  readonly normalization?: {
    readonly strategy: "language-group-mean"
    readonly groups: Record<
      string,
      {
        readonly score: number
        readonly signals: ReadonlyArray<string>
        readonly signalCount: number
      }
    >
  }
}

export interface MinimumDimension {
  readonly signal: string
  readonly category: Category
  readonly score: number
  readonly detail: string
}

export interface HardGateViolation {
  readonly signalId: string
  readonly category: Category
  readonly diagnostic: Diagnostic
}

export interface ReadinessPressure {
  readonly signal_id: string
  readonly category: Category
  readonly score: number
  readonly raw_pressure: number
  readonly effective_pressure: number
  readonly weight: number
  readonly confidence: number
  readonly applicability: SignalApplicability
}

export interface ReadinessOutput {
  readonly score: number
  readonly pressure: number
  readonly status: "green" | "yellow" | "red" | "blocked" | "unknown" | "failed"
  readonly aggregation: {
    readonly strategy: "pressure-pnorm-local-max"
    readonly p: number
    readonly mean_pressure: number
    readonly pnorm_pressure: number
    readonly max_local_pressure: number
    readonly failed_signal_pressure: number
    readonly hard_gate_pressure: number
    readonly hard_gate_score_cap: number
    readonly local_warning_threshold: number
    readonly local_poison_threshold: number
    readonly local_warning_gain: number
    readonly applicable_signal_count: number
    readonly ignored_signal_count: number
    readonly failed_signal_count: number
  }
  readonly top_pressures: ReadonlyArray<ReadinessPressure>
}

export interface ObserverRuntimeProfile {
  readonly totalMs: number
  readonly stages?: Record<
    string,
    {
      readonly durationMs: number
    }
  >
  readonly signals: Record<
    string,
    {
      readonly durationMs: number
      readonly score: number
      readonly diagnostics: number
    }
  >
}

export interface ObserverCalibrationModuleSummary {
  readonly id: string
  readonly version: string
  readonly scope: typeof ProjectModuleScope.Type
  readonly source: "builtin" | "package" | "workspace" | "repo-local"
  readonly source_ref?: string
  readonly source_fingerprint?: string
  readonly fingerprint: string
}

export interface ObserverCalibrationSummary {
  readonly fingerprint: string
  readonly active_modules: ReadonlyArray<ObserverCalibrationModuleSummary>
}
