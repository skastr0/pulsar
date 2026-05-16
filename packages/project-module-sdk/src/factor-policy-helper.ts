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
  | "typescript.clone-group-policy"
  | "typescript.size-policy"
  | "typescript.nesting-policy"
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

export interface TuneFactorPolicyOptions {
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

export interface TuneTypeScriptSizeOptions extends TuneFactorPolicyOptions {
  readonly maxLoc?: number
}

export interface TuneTypeScriptNestingOptions extends TuneFactorPolicyOptions {
  readonly threshold?: number
}

export interface TuneTypeScriptCloneGroupOptions extends TuneFactorPolicyOptions {
  readonly cloneAction?: CalibrationSlotOutput<"typescript.clone-group-policy">["value"]["action"]
  readonly factor?: number
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

export const tuneTypeScriptDependencyVersion = (
  current: CalibrationSlotOutput<"typescript.dependency-version-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.dependency-version-policy">,
  options: TuneFactorPolicyOptions,
): CalibrationSlotOutput<"typescript.dependency-version-policy"> =>
  tuneFactorPolicy(current, runtime, options, "tune-dependency-version")

export const tuneTypeScriptTypeCoupling = (
  current: CalibrationSlotOutput<"typescript.type-coupling-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.type-coupling-policy">,
  options: TuneFactorPolicyOptions,
): CalibrationSlotOutput<"typescript.type-coupling-policy"> =>
  tuneFactorPolicy(current, runtime, options, "tune-type-coupling")

export const tuneTypeScriptSize = (
  current: CalibrationSlotOutput<"typescript.size-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.size-policy">,
  options: TuneTypeScriptSizeOptions,
): CalibrationSlotOutput<"typescript.size-policy"> =>
  tuneExtendedFactorPolicy(
    current,
    runtime,
    options.maxLoc === undefined ? {} : { maxLoc: options.maxLoc },
    options.maxLoc === undefined ? [] : [`${current.value.factorPathPrefix}.max_loc`],
    options,
    "tune-size-policy",
  )

export const tuneTypeScriptNesting = (
  current: CalibrationSlotOutput<"typescript.nesting-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.nesting-policy">,
  options: TuneTypeScriptNestingOptions,
): CalibrationSlotOutput<"typescript.nesting-policy"> =>
  tuneExtendedFactorPolicy(
    current,
    runtime,
    options.threshold === undefined ? {} : { threshold: options.threshold },
    options.threshold === undefined ? [] : [`${current.value.factorPathPrefix}.threshold`],
    options,
    "tune-nesting-policy",
  )

export const tuneTypeScriptCloneGroup = (
  current: CalibrationSlotOutput<"typescript.clone-group-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.clone-group-policy">,
  options: TuneTypeScriptCloneGroupOptions,
): CalibrationSlotOutput<"typescript.clone-group-policy"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue = {
    ...current.value,
    ...(options.visible !== undefined ? { visible: options.visible } : {}),
    ...(options.severity !== undefined ? { severity: options.severity } : {}),
    ...(options.penaltyWeight !== undefined ? { penaltyWeight: options.penaltyWeight } : {}),
    ...(options.cloneAction !== undefined ? { action: options.cloneAction } : {}),
    ...(options.factor !== undefined ? { factor: options.factor } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  }
  const factorPaths = [
    ...(factorPathInput(current.value.factorPathPrefix, options).factorPaths ?? []),
    ...(options.cloneAction !== undefined ? [`${current.value.factorPathPrefix}.action`] : []),
    ...(options.factor !== undefined ? [`${current.value.factorPathPrefix}.factor`] : []),
  ]

  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? (
        options.cloneAction === "exclude" ? "exclude-clone-group" : "tune-clone-group"
      ),
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

const tuneExtendedFactorPolicy = <
  Slot extends TunableFactorPolicySlot,
  Value extends CalibrationSlotOutput<Slot>["value"] & TunableFactorPolicyValue,
>(
  current: CalibrationSlotOutput<Slot>,
  runtime: ProjectModuleProcessorRuntime<Slot>,
  patch: Partial<Value>,
  extraFactorPaths: ReadonlyArray<string>,
  options: TuneFactorPolicyOptions,
  defaultAction: string,
): CalibrationSlotOutput<Slot> => {
  const value = current.value as Value
  const metadata = mergeMetadata(value.metadata, options.metadata)
  const nextValue = {
    ...value,
    ...(options.visible !== undefined ? { visible: options.visible } : {}),
    ...(options.severity !== undefined ? { severity: options.severity } : {}),
    ...(options.penaltyWeight !== undefined ? { penaltyWeight: options.penaltyWeight } : {}),
    ...patch,
    ...(metadata !== undefined ? { metadata } : {}),
  } as Value
  const factorPaths = [
    ...(factorPathInput(value.factorPathPrefix, options).factorPaths ?? []),
    ...extraFactorPaths,
  ]
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? defaultAction,
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(factorPaths.length > 0 ? { factorPaths } : {}),
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
