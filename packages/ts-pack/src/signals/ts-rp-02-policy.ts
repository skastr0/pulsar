import type { SignalFactorLedger, SignalFactorLedgerEntry } from "@skastr0/pulsar-core/signal"
import type {
  CalibrationDecision,
  CalibrationProcessorError,
  ResolvedCalibrationContext,
  TypeScriptPrSizePolicyValue,
} from "@skastr0/pulsar-core/calibration"
import {
  factorEntryForPolicyDecision,
  makeFactorLedger,
} from "@skastr0/pulsar-core/factors"
import { Effect, Option } from "effect"
import type { TsRp02Output } from "./ts-rp-02-pr-size.js"

export const applyPrSizePolicy = (
  output: TsRp02Output,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<TsRp02Output, CalibrationProcessorError, never> => {
  const input = defaultPrSizePolicy(output)
  if (Option.isNone(calibration)) {
    return Effect.succeed(withEffectivePrSizePolicy(output, input, []))
  }
  return Effect.map(
    calibration.value.runSlot("typescript.pr-size-policy", input),
    (policy) => withEffectivePrSizePolicy(output, policy.value, policy.decisions),
  )
}

const defaultPrSizePolicy = (output: TsRp02Output): TypeScriptPrSizePolicyValue => ({
  signalId: "TS-RP-02-pr-size",
  findingId: "pr-size",
  diffMode: output.diffMode,
  linesAdded: output.linesAdded,
  linesDeleted: output.linesDeleted,
  filesChanged: output.filesChanged,
  sizeCategory: output.sizeCategory,
  visible: true,
  severity:
    output.sizeCategory === "large" || output.sizeCategory === "oversized"
      ? "warn"
      : "info",
  penaltyWeight: output.sizePenalty,
  factorPathPrefix: "pr_size",
})

const withEffectivePrSizePolicy = (
  output: TsRp02Output,
  policy: TypeScriptPrSizePolicyValue,
  decisions: ReadonlyArray<CalibrationDecision>,
): TsRp02Output => ({
  ...output,
  sizePenalty: policy.penaltyWeight,
  visible: policy.visible,
  severity: policy.severity,
  factorPathPrefix: policy.factorPathPrefix,
  calibrationDecisions: decisions,
  factorLedger: makeTsRp02FactorLedger(policy, decisions),
})

const makeTsRp02FactorLedger = (
  policy: TypeScriptPrSizePolicyValue,
  decisions: ReadonlyArray<CalibrationDecision>,
): SignalFactorLedger =>
  makeFactorLedger("TS-RP-02-pr-size", [
    factorEntryForPrSizePolicyValue(decisions, `${policy.factorPathPrefix}.visible`, policy.visible),
    factorEntryForPrSizePolicyValue(decisions, `${policy.factorPathPrefix}.severity`, policy.severity),
    factorEntryForPrSizePolicyValue(
      decisions,
      `${policy.factorPathPrefix}.penalty_weight`,
      policy.penaltyWeight,
    ),
  ])

const factorEntryForPrSizePolicyValue = (
  decisions: ReadonlyArray<CalibrationDecision>,
  path: string,
  value: string | number | boolean,
): SignalFactorLedgerEntry =>
  factorEntryForPolicyDecision({
    decisions,
    path,
    title: `PR size ${path.split(".").at(-1) ?? "factor"}`,
    value,
  })
