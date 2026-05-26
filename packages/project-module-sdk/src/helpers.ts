import type {
  ArchitecturalTier,
  CalibrationDecision,
  CalibrationEvidenceRef,
  CalibrationSlotOutput,
  SourceCategory,
  TypeScriptCallbackContextNameValue,
  TypeScriptExportReachabilityValue,
  TypeScriptNoopClassificationValue,
  TypeScriptUnsafeTypePolicyValue,
  TypeScriptUnfinishedImplementationPolicyValue,
} from "@skastr0/pulsar-core/calibration"
import {
  readArchitectureRole,
  readArchitecturalTier,
  readPolicyTags,
  withArchitectureRoleMetadata,
  withArchitecturalTierMetadata,
  withPolicyTagMetadata,
} from "@skastr0/pulsar-core/calibration"
import {
  appendProjectModuleDecision,
  type ProjectModuleProcessorRuntime,
} from "./definition.js"

export interface AddSourceCategoryOptions {
  readonly action?: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ClassifyArchitecturalTierOptions {
  readonly action?: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ClassifyArchitectureRoleOptions {
  readonly action?: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface AddPolicyTagOptions {
  readonly action?: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ClassifyTypeScriptNoopOptions {
  readonly classification: TypeScriptNoopClassificationValue["classification"]
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface MarkTypeScriptPublicEntrypointOptions {
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface MarkTypeScriptExportFrameworkConsumedOptions {
  readonly frameworkId: string
  readonly frameworkName: string
  readonly contractId: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface NameTypeScriptCallbackContextOptions {
  readonly resolvedName: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TuneTypeScriptUnfinishedImplementationOptions {
  readonly visible?: boolean
  readonly severity?: TypeScriptUnfinishedImplementationPolicyValue["severity"]
  readonly message?: string
  readonly confidence?: CalibrationDecision["confidence"]
  readonly penaltyWeight?: number
  readonly scoreCapParticipation?: boolean
  readonly scoreCap?: number
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface TuneTypeScriptUnsafeTypeOptions {
  readonly visible?: boolean
  readonly severity?: TypeScriptUnsafeTypePolicyValue["severity"]
  readonly boundary?: boolean
  readonly weight?: number
  readonly confidence?: CalibrationDecision["confidence"]
  readonly action?: string
  readonly reason: string
  readonly ruleId?: string
  readonly evidence?: ReadonlyArray<CalibrationEvidenceRef>
  readonly metadata?: Readonly<Record<string, unknown>>
}

export const addSourceCategory = (
  current: CalibrationSlotOutput<"taxonomy.file-classifier">,
  runtime: ProjectModuleProcessorRuntime<"taxonomy.file-classifier">,
  category: SourceCategory,
  options: AddSourceCategoryOptions,
): CalibrationSlotOutput<"taxonomy.file-classifier"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? `classify-${category}`,
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    {
      ...current.value,
      categories: [...new Set([...current.value.categories, category])].sort(),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  )
}

export const classifyArchitectureRole = (
  current: CalibrationSlotOutput<"taxonomy.file-classifier">,
  runtime: ProjectModuleProcessorRuntime<"taxonomy.file-classifier">,
  role: string,
  options: ClassifyArchitectureRoleOptions,
): CalibrationSlotOutput<"taxonomy.file-classifier"> => {
  const existingRole = readArchitectureRole(current.value.metadata)
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue = withArchitectureRoleMetadata(current.value, role, metadata)
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "classify-architecture-role",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
      before: existingRole,
      after: readArchitectureRole(nextValue.metadata),
    },
    nextValue,
  )
}

export const addPolicyTag = (
  current: CalibrationSlotOutput<"taxonomy.file-classifier">,
  runtime: ProjectModuleProcessorRuntime<"taxonomy.file-classifier">,
  tag: string,
  options: AddPolicyTagOptions,
): CalibrationSlotOutput<"taxonomy.file-classifier"> => {
  const existingTags = readPolicyTags(current.value.metadata)
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue = withPolicyTagMetadata(current.value, tag, metadata)
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "add-policy-tag",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
      before: existingTags,
      after: readPolicyTags(nextValue.metadata),
    },
    nextValue,
  )
}

export const classifyArchitecturalTier = (
  current: CalibrationSlotOutput<"taxonomy.file-classifier">,
  runtime: ProjectModuleProcessorRuntime<"taxonomy.file-classifier">,
  tier: ArchitecturalTier,
  options: ClassifyArchitecturalTierOptions,
): CalibrationSlotOutput<"taxonomy.file-classifier"> => {
  const existingTier = readArchitecturalTier(current.value.metadata)
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "classify-architectural-tier",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
      before: existingTier,
      after: tier,
    },
    withArchitecturalTierMetadata(current.value, tier, metadata),
  )
}

export const classifyTypeScriptNoop = (
  current: CalibrationSlotOutput<"typescript.noop-classifier">,
  runtime: ProjectModuleProcessorRuntime<"typescript.noop-classifier">,
  options: ClassifyTypeScriptNoopOptions,
): CalibrationSlotOutput<"typescript.noop-classifier"> => {
  const confidence = options.confidence ?? current.value.confidence
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? `classify-${options.classification}`,
      confidence: confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    {
      ...current.value,
      classification: options.classification,
      ...(confidence !== undefined ? { confidence } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    },
  )
}

export const markTypeScriptExportPublicEntrypoint = (
  current: CalibrationSlotOutput<"typescript.export-reachability">,
  runtime: ProjectModuleProcessorRuntime<"typescript.export-reachability">,
  options: MarkTypeScriptPublicEntrypointOptions,
): CalibrationSlotOutput<"typescript.export-reachability"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue: TypeScriptExportReachabilityValue = {
    ...current.value,
    isPublicEntrypoint: true,
    ...(metadata !== undefined ? { metadata } : {}),
  }
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "mark-public-entrypoint",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    nextValue,
  )
}

export const markTypeScriptExportFrameworkConsumed = (
  current: CalibrationSlotOutput<"typescript.export-reachability">,
  runtime: ProjectModuleProcessorRuntime<"typescript.export-reachability">,
  options: MarkTypeScriptExportFrameworkConsumedOptions,
): CalibrationSlotOutput<"typescript.export-reachability"> => {
  const metadata = mergeMetadata(current.value.metadata, {
    framework: options.frameworkId,
    frameworkName: options.frameworkName,
    frameworkContract: options.contractId,
    ...options.metadata,
  })
  const nextValue: TypeScriptExportReachabilityValue = {
    ...current.value,
    frameworkConsumer: {
      frameworkId: options.frameworkId,
      frameworkName: options.frameworkName,
      contractId: options.contractId,
    },
    ...(metadata !== undefined ? { metadata } : {}),
  }
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "mark-framework-consumed",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      before: current.value,
      after: nextValue,
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    nextValue,
  )
}

export const nameTypeScriptCallbackContext = (
  current: CalibrationSlotOutput<"typescript.callback-context-namer">,
  runtime: ProjectModuleProcessorRuntime<"typescript.callback-context-namer">,
  options: NameTypeScriptCallbackContextOptions,
): CalibrationSlotOutput<"typescript.callback-context-namer"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue: TypeScriptCallbackContextNameValue = {
    ...current.value,
    resolvedName: options.resolvedName,
    ...(metadata !== undefined ? { metadata } : {}),
  }
  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "name-callback-context",
      confidence: options.confidence ?? "high",
      reason: options.reason,
      ...(options.ruleId !== undefined ? { ruleId: options.ruleId } : {}),
      ...(options.evidence !== undefined ? { evidence: options.evidence } : {}),
    },
    nextValue,
  )
}

export const tuneTypeScriptUnfinishedImplementation = (
  current: CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.unfinished-implementation-policy">,
  options: TuneTypeScriptUnfinishedImplementationOptions,
): CalibrationSlotOutput<"typescript.unfinished-implementation-policy"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue: TypeScriptUnfinishedImplementationPolicyValue = {
    ...current.value,
    ...(options.visible !== undefined ? { visible: options.visible } : {}),
    ...(options.severity !== undefined ? { severity: options.severity } : {}),
    ...(options.message !== undefined ? { message: options.message } : {}),
    ...(options.confidence !== undefined ? { confidence: options.confidence } : {}),
    ...(options.penaltyWeight !== undefined ? { penaltyWeight: options.penaltyWeight } : {}),
    ...(options.scoreCapParticipation !== undefined
      ? { scoreCapParticipation: options.scoreCapParticipation }
      : {}),
    ...(options.scoreCap !== undefined ? { scoreCap: options.scoreCap } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  }
  const factorPaths = [
    ...(options.confidence !== undefined ? [`${current.value.factorPathPrefix}.confidence`] : []),
    ...(options.penaltyWeight !== undefined
      ? [`${current.value.factorPathPrefix}.penalty_weight`]
      : []),
    ...(options.scoreCapParticipation !== undefined
      ? [`${current.value.factorPathPrefix}.score_cap_participation`]
      : []),
    ...(options.scoreCap !== undefined ? [`${current.value.factorPathPrefix}.score_cap`] : []),
  ]

  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "tune-unfinished-implementation",
      confidence: options.confidence ?? current.value.confidence,
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

export const tuneTypeScriptUnsafeType = (
  current: CalibrationSlotOutput<"typescript.unsafe-type-policy">,
  runtime: ProjectModuleProcessorRuntime<"typescript.unsafe-type-policy">,
  options: TuneTypeScriptUnsafeTypeOptions,
): CalibrationSlotOutput<"typescript.unsafe-type-policy"> => {
  const metadata = mergeMetadata(current.value.metadata, options.metadata)
  const nextValue: TypeScriptUnsafeTypePolicyValue = {
    ...current.value,
    ...(options.visible !== undefined ? { visible: options.visible } : {}),
    ...(options.severity !== undefined ? { severity: options.severity } : {}),
    ...(options.boundary !== undefined ? { boundary: options.boundary } : {}),
    ...(options.weight !== undefined ? { weight: options.weight } : {}),
    ...(metadata !== undefined ? { metadata } : {}),
  }
  const factorPaths = [
    ...(options.visible !== undefined ? [`${current.value.factorPathPrefix}.visible`] : []),
    ...(options.severity !== undefined ? [`${current.value.factorPathPrefix}.severity`] : []),
    ...(options.boundary !== undefined ? [`${current.value.factorPathPrefix}.boundary`] : []),
    ...(options.weight !== undefined ? [`${current.value.factorPathPrefix}.weight`] : []),
  ]

  return appendProjectModuleDecision(
    current,
    runtime,
    {
      action: options.action ?? "tune-unsafe-type",
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

export const mergeMetadata = (
  left: Readonly<Record<string, unknown>> | undefined,
  right: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined => {
  if (left === undefined) return right
  if (right === undefined) return left
  return { ...left, ...right }
}
