import { Effect } from "effect"
import { decodePulsarVector, type PulsarVector } from "./vector.js"
import aiSlopDefensePreset from "../presets/ai-slop-defense.json" with { type: "json" }
import domainPuristPreset from "../presets/domain-purist.json" with { type: "json" }
import refactorFriendlyPreset from "../presets/refactor-friendly.json" with { type: "json" }
import securityParanoidPreset from "../presets/security-paranoid.json" with { type: "json" }
import strictTypeSafetyPreset from "../presets/strict-type-safety.json" with { type: "json" }
import velocityFirstPreset from "../presets/velocity-first.json" with { type: "json" }

const SHIPPED_PRESETS = [
  aiSlopDefensePreset,
  domainPuristPreset,
  refactorFriendlyPreset,
  securityParanoidPreset,
  strictTypeSafetyPreset,
  velocityFirstPreset,
] as const

export interface PulsarVectorPresetSummary {
  readonly id: string
  readonly description: string
  readonly presetProfileKind: string
  readonly activation: string
}

export const loadPulsarVectorPresets = (): Effect.Effect<ReadonlyArray<PulsarVector>, Error, never> =>
  Effect.gen(function* () {
    const presets = yield* Effect.forEach(SHIPPED_PRESETS, (preset) =>
      decodePulsarVector(preset).pipe(Effect.mapError(asError)),
    )

    const seen = new Set<string>()
    for (const preset of presets) {
      if (seen.has(preset.id)) {
        return yield* Effect.fail(new Error(`Duplicate preset id: ${preset.id}`))
      }
      seen.add(preset.id)
    }

    return [...presets].sort((left, right) => left.id.localeCompare(right.id))
  })

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

export const loadPulsarVectorPresetById = (
  presetId: string,
): Effect.Effect<PulsarVector, Error, never> =>
  Effect.gen(function* () {
    const presets = yield* loadPulsarVectorPresets()
    const preset = presets.find((candidate) => candidate.id === presetId)
    if (preset === undefined) {
      return yield* Effect.fail(new Error(`Unknown vector profile template: ${presetId}`))
    }
    return preset
  })

export const summarizePulsarVectorPresets = (
  presets: ReadonlyArray<PulsarVector>,
): ReadonlyArray<PulsarVectorPresetSummary> =>
  [...presets]
    .map((preset) => ({
      id: preset.id,
      description: oneLineDescription(preset),
      presetProfileKind: preset.preset_profile?.kind ?? "unclassified",
      activation: preset.preset_profile?.activation ?? "unknown",
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

export const oneLineDescription = (vector: PulsarVector): string => {
  const trimmed = vector.description?.trim()
  if (trimmed === undefined || trimmed.length === 0) return "No description provided."
  const line = trimmed.split(/\r?\n/, 1)[0]?.trim()
  if (line === undefined || line.length === 0) return trimmed
  return line
}

export const formatPulsarVectorPresetProfileKind = (kind: string | undefined): string => {
  switch (kind) {
    case "architecture-taste":
      return "architecture taste"
    case "technology-practice":
      return "technology practice"
    case "workflow-risk":
      return "workflow/risk"
    case undefined:
      return "unclassified"
    default:
      return kind.replaceAll("-", " ")
  }
}

export const formatPulsarVectorPresetProfileActivation = (
  activation: string | undefined,
): string => {
  switch (activation) {
    case "explicit-apply-only":
      return "explicit apply only"
    case undefined:
      return "unknown"
    default:
      return activation.replaceAll("-", " ")
  }
}
