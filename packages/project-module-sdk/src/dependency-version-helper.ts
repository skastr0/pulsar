import type {
  CalibrationDecision,
  CalibrationEvidenceRef,
  CalibrationSlotOutput,
  TypeScriptDependencyVersionPolicyValue,
} from "@skastr0/pulsar-core/calibration"
import {
  appendProjectModuleDecision,
  type ProjectModuleProcessorRuntime,
} from "./definition.js"
import { mergeMetadata } from "./helpers.js"

export interface TuneTypeScriptDependencyVersionOptions {
  readonly visible?: boolean
  readonly severity?: TypeScriptDependencyVersionPolicyValue["severity"]
  readonly penaltyWeight?: number
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export const tuneTypeScriptDependencyVersion = (
  current: CalibrationSlotOutput<"typescript.dependency-version-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.dependency-version-policy">,
  options: TuneTypeScriptDependencyVersionOptions,
): CalibrationSlotOutput<"typescript.dependency-version-policy"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue: TypeScriptDependencyVersionPolicyValue = {
    ...current.value,
    ...(options.visible !== undefined ? { visible: options.visible } : {}),
    ...(options.severity !== undefined ? { severity: options.severity } : {}),
    ...(options.penaltyWeight !== undefined ? { penaltyWeight: options.penaltyWeight } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  }
  const factorPaths = [
    ...(options.visible !== undefined ? [`${current.value.factorPathPrefix}.visible`] : []),
    ...(options.severity !== undefined ? [`${current.value.factorPathPrefix}.severity`] : []),
    ...(options.penaltyWeight !== undefined
      ? [`${current.value.factorPathPrefix}.penalty_weight`]
      : []),
  ]

  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "tune-dependency-version",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(factorPaths.length > 0 ? { factorPaths } : {}),
      before: current.value,
      after: nextValue,
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    nextValue,
  )
}
