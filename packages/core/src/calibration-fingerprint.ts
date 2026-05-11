import { createHash } from "node:crypto"
import type {
  ActiveProjectModule,
  AnyCalibrationProcessor,
  ProjectModuleContribution,
  ProjectModuleDescriptor,
  RepoFacts,
} from "./calibration-model.js"

export const fingerprintProjectModule = (
  module: ProjectModuleDescriptor,
): string =>
  hashCalibrationValue({
    id: module.id,
    version: module.version,
    scope: module.scope,
    source: module.source,
    sourceRef: module.sourceRef ?? null,
    sourceFingerprint: module.sourceFingerprint ?? null,
    configHash: module.configHash ?? null,
    contributions: normalizeContributions(module.contributions),
  })

export const activateProjectModule = (
  module: ProjectModuleDescriptor,
): ActiveProjectModule => ({
  ...module,
  fingerprint: fingerprintProjectModule(module),
})

export const computeResolvedCalibrationFingerprint = (input: {
  readonly activeModules: ReadonlyArray<ActiveProjectModule>
  readonly repoFacts: RepoFacts
  readonly processors: ReadonlyArray<AnyCalibrationProcessor>
}): string =>
  hashCalibrationValue({
    repoFacts: {
      fingerprint: input.repoFacts.fingerprint,
      detectedTechnologies: [...input.repoFacts.detectedTechnologies].sort(),
      sourceExtensions: [...input.repoFacts.sourceExtensions].sort(),
    },
    activeModules: input.activeModules
      .map((module) => ({
        id: module.id,
        version: module.version,
        scope: module.scope,
        fingerprint: module.fingerprint,
      }))
      .sort(compareByIdThenVersion),
    processors: input.processors
      .map((processor) => ({
        id: processor.id,
        moduleId: processor.moduleId,
        moduleVersion: processor.moduleVersion,
        slot: processor.slot,
        role: processor.role,
        priority: processor.priority,
        fingerprint: processor.fingerprint,
      }))
      .sort(compareProcessorDescriptor),
  })

export const hashCalibrationValue = (value: unknown): string =>
  createHash("sha256").update(stableCalibrationStringify(value)).digest("hex")

export const stableCalibrationStringify = (value: unknown): string => {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "undefined"
  if (Array.isArray(value)) {
    return `[${value.map(stableCalibrationStringify).join(",")}]`
  }

  const object = value as Record<string, unknown>
  const keys = Object.keys(object).sort()
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableCalibrationStringify(object[key])}`)
    .join(",")}}`
}

export const normalizeContributions = (
  contributions: ReadonlyArray<ProjectModuleContribution>,
): ReadonlyArray<ProjectModuleContribution> =>
  [...contributions].sort((left, right) =>
    left.slot.localeCompare(right.slot) ||
    left.priority - right.priority ||
    left.processorId.localeCompare(right.processorId),
  )

export const compareByIdThenVersion = (
  left: { readonly id: string; readonly version: string },
  right: { readonly id: string; readonly version: string },
): number => left.id.localeCompare(right.id) || left.version.localeCompare(right.version)

export const compareProcessor = (
  left: AnyCalibrationProcessor,
  right: AnyCalibrationProcessor,
): number => compareProcessorOrder(left, right)

type ProcessorOrderKey = {
  readonly slot: string
  readonly priority: number
  readonly moduleId: string
  readonly id: string
}

const compareProcessorOrder = (left: ProcessorOrderKey, right: ProcessorOrderKey): number =>
  left.slot.localeCompare(right.slot) ||
  left.priority - right.priority ||
  left.moduleId.localeCompare(right.moduleId) ||
  left.id.localeCompare(right.id)

export const compareProcessorDescriptor = (
  left: ProcessorOrderKey,
  right: ProcessorOrderKey,
): number => compareProcessorOrder(left, right)
