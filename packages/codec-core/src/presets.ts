import { readdir, readFile } from "node:fs/promises"
import { Effect } from "effect"
import { decodeTasteVector, type TasteVector } from "./vector.js"

const PRESET_DIRECTORY = new URL("../presets/", import.meta.url)

export interface TasteVectorPresetSummary {
  readonly id: string
  readonly description: string
}

export const loadTasteVectorPresets = () =>
  Effect.gen(function* () {
    const files = yield* readJsonDirectory(PRESET_DIRECTORY)
    const presets = yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: () => readFile(new URL(file, PRESET_DIRECTORY), "utf8"),
          catch: (cause) =>
            new Error(`Failed to read preset ${file}: ${String(cause)}`),
        })
        const parsed = yield* Effect.try({
          try: () => JSON.parse(raw),
          catch: (cause) => new Error(`Failed to parse preset ${file}: ${String(cause)}`),
        })
        return yield* decodeTasteVector(parsed)
      }),
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

const readJsonDirectory = (directory: URL) =>
  Effect.gen(function* () {
    const entries = yield* Effect.tryPromise({
      try: () => readdir(directory),
      catch: (cause) =>
        new Error(`Failed to read preset directory ${directory.pathname}: ${String(cause)}`),
    })
    return entries.filter((entry) => entry.endsWith(".json")).sort((left, right) => left.localeCompare(right))
  })
