import type {
  CalibrationDecision,
  CalibrationEvidenceRef,
  CalibrationSlotOutput,
} from "@skastr0/pulsar-core/calibration"
import {
  appendProjectModuleDecision,
  type ProjectModuleProcessorRuntime,
} from "./definition.js"
import { mergeMetadata } from "./helpers.js"

type TunableFactorPolicySlot =
  | "typescript.dependency-version-policy"
  | "typescript.type-coupling-policy"
  | "typescript.pr-size-policy"
  | "shared.bus-factor-policy"
  | "shared.churn-rate-policy"

interface TunableFactorPolicyValue {
  readonly visible: boolean
  readonly severity: "info" | "warn" | "block"
  readonly penaltyWeight: number
  readonly factorPathPrefix: string
  readonly metadata?: Readonly<Record<string, unknown>>
}

interface TuneFactorPolicyOptions {
  readonly visible?: boolean
  readonly severity?: TunableFactorPolicyValue["severity"]
  readonly penaltyWeight?: number
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export const tuneFactorPolicy = <
  Slot extends TunableFactorPolicySlot,
  Value extends CalibrationSlotOutput<Slot>["value"] & TunableFactorPolicyValue,
>(
  current: CalibrationSlotOutput<Slot>,
  runtime: ProjectModuleProcessorRuntime<Slot>,
  options: TuneFactorPolicyOptions,
  defaultAction = "tune-factor-policy",
): CalibrationSlotOutput<Slot> => {
  const value = current.value as Value
  const metadata = mergeMetadata(value.metadata, options.metadata)
  const nextValue = {
    ...value,
    ...(options.visible !== undefined ? { visible: options.visible } : {}),
    ...(options.severity !== undefined ? { severity: options.severity } : {}),
    ...(options.penaltyWeight !== undefined ? { penaltyWeight: options.penaltyWeight } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  } as Value

  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? defaultAction,
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...factorPathInput(value.factorPathPrefix, options),
      before: value,
      after: nextValue,
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    nextValue,
  )
}

const factorPathInput = (
  prefix: string,
  options: TuneFactorPolicyOptions,
): { readonly factorPaths?: ReadonlyArray<string> } => {
  const factorPaths = [
    ...(options.visible !== undefined ? [`${prefix}.visible`] : []),
    ...(options.severity !== undefined ? [`${prefix}.severity`] : []),
    ...(options.penaltyWeight !== undefined ? [`${prefix}.penalty_weight`] : []),
  ]
  return factorPaths.length > 0 ? { factorPaths } : {}
}
