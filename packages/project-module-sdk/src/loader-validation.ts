import { Effect, Schema } from "effect"
import {
  CalibrationProcessorRole,
  CalibrationSlotId,
  ProjectModuleScope,
  activateProjectModule,
  hashCalibrationValue,
  normalizeContributions,
} from "@skastr0/pulsar-core/calibration"
import { defineProjectModule, type DefinedProjectModule } from "./definition.js"
import { ProjectModuleLoadError } from "./loader-types.js"
import type { ProjectModuleRef } from "./manifest.js"

const identity = {
  id: Schema.NonEmptyString,
  version: Schema.NonEmptyString,
  scope: ProjectModuleScope,
  source: Schema.optional(Schema.Literals(["builtin", "package", "workspace", "repo-local"])),
  sourceRef: Schema.optional(Schema.String),
  sourceFingerprint: Schema.optional(Schema.String),
  configHash: Schema.optional(Schema.String),
}
const processor = {
  id: Schema.NonEmptyString,
  slot: CalibrationSlotId,
  role: CalibrationProcessorRole,
  fingerprint: Schema.NonEmptyString,
  process: Schema.Unknown.check(Schema.makeFilter((value) => typeof value === "function")),
}
const contribution = Schema.Struct({
  slot: CalibrationSlotId,
  processorId: Schema.NonEmptyString,
  role: CalibrationProcessorRole,
  priority: Schema.Finite,
  fingerprint: Schema.NonEmptyString,
})
const definition = Schema.Struct({
  ...identity,
  processors: Schema.Array(Schema.Struct({ ...processor, priority: Schema.optional(Schema.Finite) })),
})
const descriptor = Schema.Struct({
  ...identity,
  source: Schema.Literals(["builtin", "package", "workspace", "repo-local"]),
  contributions: Schema.Array(contribution),
})
const defined = Schema.Struct({
  descriptor,
  activeModule: Schema.Struct({ ...descriptor.fields, fingerprint: Schema.NonEmptyString }),
  processors: Schema.Array(Schema.Struct({
    ...processor,
    moduleId: Schema.NonEmptyString,
    moduleVersion: Schema.NonEmptyString,
    priority: Schema.Finite,
  })),
})

/** Decode structure before normalization; call signatures remain the trusted author's contract. */
export const validateLoadedProjectModule = (
  ref: ProjectModuleRef,
  target: string,
  value: unknown,
): Effect.Effect<DefinedProjectModule, ProjectModuleLoadError> => Effect.try({
  try: () => {
    const isDefined = value !== null && typeof value === "object" && "descriptor" in value
    const decoded = isDefined
      ? Schema.decodeUnknownSync(defined)(value)
      : Schema.decodeUnknownSync(definition)(value)
    // Schema verifies each callable and every discriminant; TS cannot express the
    // correlated slot/function union for an unknown JavaScript export.
    const module = isDefined
      ? decoded as DefinedProjectModule
      : defineProjectModule(decoded as Parameters<typeof defineProjectModule>[0])
    if (module.descriptor.id !== ref.id) throw new Error("Manifest and descriptor module IDs differ")
    if (new Set(module.processors.map((p) => p.id)).size !== module.processors.length) {
      throw new Error("Duplicate processor IDs")
    }
    for (const p of module.processors) {
      if (p.moduleId !== module.descriptor.id || p.moduleVersion !== module.descriptor.version) {
        throw new Error("Processor module identity differs from descriptor")
      }
    }
    const contributions = module.processors.map((p) => ({
      slot: p.slot, processorId: p.id, role: p.role, priority: p.priority, fingerprint: p.fingerprint,
    }))
    if (hashCalibrationValue(normalizeContributions(contributions)) !==
        hashCalibrationValue(normalizeContributions(module.descriptor.contributions))) {
      throw new Error("Descriptor contributions differ from processors")
    }
    const { fingerprint: _priorFingerprint, ...activeDescriptor } = module.activeModule
    if (hashCalibrationValue(activeDescriptor) !== hashCalibrationValue(module.descriptor)) {
      throw new Error("Active module identity differs from descriptor")
    }
    // The loader has always replaced caller-supplied fingerprints with the
    // effective source identity. Validate descriptor agreement, not a stale hash.
    return { ...module, activeModule: activateProjectModule(module.descriptor) }
  },
  catch: (cause) => new ProjectModuleLoadError({
    refId: ref.id, target, message: `Invalid project module ${ref.id}: ${String(cause)}`, cause,
  }),
})
