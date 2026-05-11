import { Effect, Option, Schema } from "effect"
import type {
  CalibrationDecision,
  CalibrationProcessorError,
  ResolvedCalibrationContext,
  SharedChurnRatePolicyValue,
} from "./calibration-model.js"
import { CalibrationContextTag } from "./calibration-model.js"
import { SignalContextTag } from "./context.js"
import { type Diagnostic } from "./diagnostic.js"
import { SignalComputeError } from "./errors.js"
import {
  commonDirectoryPrefix,
  factorEntryForPolicyDecision,
  factorPathSegment,
  relativeFactorPath,
} from "./factor-policy-ledger.js"
import { makeFactorLedger } from "./factor-ledger.js"
import type { Signal } from "./signal.js"
import type { SignalFactorLedger, SignalFactorLedgerEntry } from "./signal-factor-model.js"
import { clamp01 } from "./shared-history.js"
import { SHARED_PRODUCTION_EXCLUDE_GLOBS } from "./shared-history-defaults.js"
import { computeChurnRateOutput } from "./shared-03-compute.js"

export const Shared03ChurnRateConfig = Schema.Struct({
  window_days: Schema.Number,
  max_mature_commits: Schema.Number,
  similarity_threshold: Schema.Number,
  include_extensions: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
})
export type Shared03ChurnRateConfig = typeof Shared03ChurnRateConfig.Type

export interface Shared03FileRate {
  readonly introduced: number
  readonly churned: number
  readonly rate: number
}

export interface Shared03ChurnRateOutput {
  readonly churnedLineCount: number
  readonly introducedLineCount: number
  readonly churnRate: number
  readonly byFile: ReadonlyMap<string, Shared03FileRate>
  readonly windowDays: number
  readonly insufficientHistory: boolean
  readonly skippedReason?: string
  readonly effectiveFiles?: ReadonlyArray<Shared03EffectiveFileRate>
  readonly calibrationDecisions?: ReadonlyArray<CalibrationDecision>
  readonly factorLedger?: SignalFactorLedger
}

interface Shared03EffectiveFileRate extends Shared03FileRate {
  readonly file: string
  readonly visible: boolean
  readonly severity: "info" | "warn" | "block"
  readonly penaltyWeight: number
  readonly factorPathPrefix: string
  readonly policyDecisions: ReadonlyArray<CalibrationDecision>
}

/**
 * SHARED-03 — line survival within a configurable revert window. The
 * signal evaluates lines introduced in the most recent fully matured
 * window, so runtime and output stay tied to current review pain instead of
 * scanning all historical churn.
 */
export const Shared03ChurnRate: Signal<
  Shared03ChurnRateConfig,
  Shared03ChurnRateOutput,
  SignalContextTag
> = {
  id: "SHARED-03-churn-rate",
  title: "Churn rate",
  aliases: ["SHARED-03"],
  tier: 1.5,
  category: "review-pain",
  kind: "legibility",
  cacheVersion: "applicability-v2-factor-policy",
  configSchema: Shared03ChurnRateConfig,
  defaultConfig: {
    window_days: 14,
    max_mature_commits: 500,
    similarity_threshold: 0.8,
    include_extensions: [".ts", ".tsx", ".js", ".jsx", ".rs"],
    exclude_globs: [...SHARED_PRODUCTION_EXCLUDE_GLOBS],
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const ctx = yield* SignalContextTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)

      const output = yield* Effect.tryPromise({
        try: () => computeChurnRateOutput(ctx, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "SHARED-03-churn-rate",
            message: `Failed to compute churn rate: ${String(cause)}`,
            cause,
          }),
      })
      return yield* applyChurnRatePolicy(output, calibration).pipe(
        Effect.mapError(toSignalComputeError),
      )
    }),
  score: (out) => {
    if (out.insufficientHistory) return 1
    const penalty = effectiveFiles(out).reduce(
      (sum, entry) =>
        entry.visible ? sum + Math.max(0, entry.penaltyWeight) : sum,
      0,
    )
    return 1 - Math.min(1, penalty)
  },
  outputMetadata: (out) =>
    out.insufficientHistory
      ? { applicability: "insufficient_evidence" as const }
      : undefined,
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.insufficientHistory) {
      return [
        {
          severity: "info",
          message:
            out.skippedReason ??
            `SHARED-03 has no fully-mature ${out.windowDays}-day history window yet; returning a neutral score`,
        },
      ]
    }

    const churnRatePercent = formatPercent(out.churnRate)
    const noisiestFiles = effectiveFiles(out)
      .filter((entry) => entry.visible && entry.churned > 0 && entry.penaltyWeight > 0)
      .sort(
        (a, b) =>
          b.churned - a.churned ||
          b.rate - a.rate ||
          b.introduced - a.introduced ||
          a.file.localeCompare(b.file),
      )
      .slice(0, 10)

    return noisiestFiles.map((entry) => ({
      severity: entry.severity,
      message:
        `Recent churn candidate: ${entry.file} churned ${entry.churned}/${entry.introduced} introduced lines ` +
        `within ${out.windowDays} days (${formatPercent(entry.rate)} file churn; ${churnRatePercent} repo churn)`,
      location: { file: entry.file },
      data: {
        introduced: entry.introduced,
        churned: entry.churned,
        rate: entry.rate,
        repoIntroduced: out.introducedLineCount,
        repoChurned: out.churnedLineCount,
        repoRate: out.churnRate,
        penaltyWeight: entry.penaltyWeight,
        policyDecisions: entry.policyDecisions,
      },
    }))
  },
  factorLedger: (out) => out.factorLedger,
}

const formatPercent = (value: number): string => `${Math.round(value * 100)}%`

const applyChurnRatePolicy = (
  output: Shared03ChurnRateOutput,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<Shared03ChurnRateOutput, CalibrationProcessorError, never> => {
  if (output.insufficientHistory || output.introducedLineCount === 0) {
    return Effect.succeed({
      ...output,
      effectiveFiles: [],
      calibrationDecisions: [],
      factorLedger: makeFactorLedger("SHARED-03-churn-rate", []),
    })
  }

  const files = [...output.byFile.entries()]
  const factorPathRoot = commonDirectoryPrefix(files.map(([file]) => file))
  return Effect.gen(function* () {
    const effectiveFileEntries = yield* Effect.forEach(
      files,
      ([file, entry]) =>
        Effect.gen(function* () {
          const input = defaultChurnRatePolicy(file, entry, output, factorPathRoot)
          if (Option.isNone(calibration)) return toEffectiveFile(file, entry, input, [])
          const policy = yield* calibration.value.runSlot("shared.churn-rate-policy", input)
          return toEffectiveFile(file, entry, policy.value, policy.decisions)
        }),
      { concurrency: 1 },
    )

    return {
      ...output,
      effectiveFiles: effectiveFileEntries,
      calibrationDecisions: effectiveFileEntries.flatMap((entry) => entry.policyDecisions),
      factorLedger: makeShared03FactorLedger(effectiveFileEntries),
    }
  })
}

const defaultChurnRatePolicy = (
  file: string,
  entry: Shared03FileRate,
  output: Shared03ChurnRateOutput,
  factorPathRoot: string,
): SharedChurnRatePolicyValue => ({
  signalId: "SHARED-03-churn-rate",
  findingId: file,
  file,
  windowDays: output.windowDays,
  introduced: entry.introduced,
  churned: entry.churned,
  rate: entry.rate,
  introducedLineCount: output.introducedLineCount,
  churnedLineCount: output.churnedLineCount,
  churnRate: output.churnRate,
  repoIntroduced: output.introducedLineCount,
  repoChurned: output.churnedLineCount,
  repoRate: output.churnRate,
  visible: true,
  severity: entry.rate >= 0.3 ? "warn" : "info",
  penaltyWeight: defaultChurnPenaltyWeight(entry.churned, output.introducedLineCount),
  factorPathPrefix: `churn_rate.${factorPathSegment(relativeFactorPath(file, factorPathRoot))}`,
})

const toEffectiveFile = (
  file: string,
  entry: Shared03FileRate,
  policy: SharedChurnRatePolicyValue,
  decisions: ReadonlyArray<CalibrationDecision>,
): Shared03EffectiveFileRate => ({
  ...entry,
  file,
  visible: policy.visible,
  severity: policy.severity,
  penaltyWeight: policy.penaltyWeight,
  factorPathPrefix: policy.factorPathPrefix,
  policyDecisions: decisions,
})

const effectiveFiles = (
  output: Shared03ChurnRateOutput,
): ReadonlyArray<Shared03EffectiveFileRate> =>
  output.effectiveFiles ?? [...output.byFile.entries()].map(([file, entry]) =>
    toEffectiveFile(file, entry, defaultChurnRatePolicy(file, entry, output, ""), []),
  )

const defaultChurnPenaltyWeight = (churned: number, introduced: number): number =>
  introduced === 0 ? 0 : churned / introduced / 0.3

const makeShared03FactorLedger = (
  entries: ReadonlyArray<Shared03EffectiveFileRate>,
): SignalFactorLedger =>
  makeFactorLedger(
    "SHARED-03-churn-rate",
    entries.flatMap((entry): ReadonlyArray<SignalFactorLedgerEntry> => {
      if (entry.churned === 0 && entry.policyDecisions.length === 0) return []
      return [
        factorEntryForPolicyDecision({
          decisions: entry.policyDecisions,
          path: `${entry.factorPathPrefix}.visible`,
          title: "Churn rate visible",
          value: entry.visible,
        }),
        factorEntryForPolicyDecision({
          decisions: entry.policyDecisions,
          path: `${entry.factorPathPrefix}.severity`,
          title: "Churn rate severity",
          value: entry.severity,
        }),
        factorEntryForPolicyDecision({
          decisions: entry.policyDecisions,
          path: `${entry.factorPathPrefix}.penalty_weight`,
          title: "Churn rate penalty_weight",
          value: entry.penaltyWeight,
        }),
      ]
    }),
  )

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({
        signalId: "SHARED-03-churn-rate",
        message: String(cause),
        cause,
      })
