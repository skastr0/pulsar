import { Effect } from "effect"
import { decodeTasteVector, type TasteVector } from "./vector.js"
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

export interface TasteVectorPresetSummary {
  readonly id: string
  readonly description: string
}

export const loadTasteVectorPresets = () =>
  Effect.gen(function* () {
    const presets = yield* Effect.forEach(SHIPPED_PRESETS, (preset) =>
      decodeTasteVector(preset),
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

export const loadTasteVectorPresetById = (presetId: string) =>
  Effect.gen(function* () {
    const presets = yield* loadTasteVectorPresets()
    const preset = presets.find((candidate) => candidate.id === presetId)
    if (preset === undefined) {
      return yield* Effect.fail(new Error(`Unknown persona preset: ${presetId}`))
    }
    return preset
  })

export const summarizeTasteVectorPresets = (
  presets: ReadonlyArray<TasteVector>,
): ReadonlyArray<TasteVectorPresetSummary> =>
  [...presets]
    .map((preset) => ({
      id: preset.id,
      description: oneLineDescription(preset),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))

export const oneLineDescription = (vector: TasteVector): string => {
  const trimmed = vector.description?.trim()
  if (trimmed === undefined || trimmed.length === 0) return "No description provided."
  const line = trimmed.split(/\r?\n/, 1)[0]?.trim()
  if (line === undefined || line.length === 0) return trimmed
  return line
}
