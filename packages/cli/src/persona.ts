import { existsSync } from "node:fs"
import { resolve } from "node:path"
import {
  loadPulsarVectorPresetById,
  loadPulsarVectorPresets,
  summarizePulsarVectorPresets,
} from "@skastr0/pulsar-core/elicitation"
import {
  appendVectorProvenance,
  type PulsarVector,
  validateVectorAgainstRegistry,
} from "@skastr0/pulsar-core/vector"
import { type Registry } from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"
import { writeJsonFile } from "./json-file.js"
import { buildPulsarRegistry } from "./runtime.js"
import { discoverPulsarVector, type DiscoveredPulsarVector } from "./vector-discovery.js"
import { renderVectorDiff, summarizeVectorDiff } from "./vector-format.js"

interface PersonaCommandOptions {
  readonly action: "list" | "show" | "apply" | "diff"
  readonly presetId?: string
  readonly outputPath?: string
  readonly force?: boolean
  readonly repoPath?: string
  readonly vectorPath?: string
}

export const runPersonaCommand = (
  opts: PersonaCommandOptions,
): Effect.Effect<number, unknown, never> =>
  Effect.gen(function* () {
    const { registry, presets } = yield* loadValidatedPersonaPresets()

    if (opts.action === "list") {
      return printPersonaPresetList(presets)
    }

    const preset = yield* loadRequestedPersonaPreset(opts, registry)

    if (opts.action === "show") {
      return printPersonaPreset(preset)
    }

    if (opts.action === "apply") {
      return yield* applyPersonaPreset(opts, preset)
    }

    return yield* diffPersonaPreset(opts, registry, preset)
  })

const loadValidatedPersonaPresets = (): Effect.Effect<
  { readonly registry: Registry; readonly presets: ReadonlyArray<PulsarVector> },
  unknown,
  never
> =>
  Effect.gen(function* () {
    const registry = yield* buildPulsarRegistry()
    const presets = yield* loadPulsarVectorPresets()
    for (const preset of presets) {
      yield* validateVectorAgainstRegistry(preset, registry)
    }
    return { registry, presets }
  })

const printPersonaPresetList = (presets: ReadonlyArray<PulsarVector>): number => {
  console.log("")
  console.log("Available persona presets:")
  for (const preset of summarizePulsarVectorPresets(presets)) {
    console.log(`  ${preset.id.padEnd(20)} ${preset.description}`)
  }
  console.log("")
  return 0
}

const loadRequestedPersonaPreset = (
  opts: PersonaCommandOptions,
  registry: Registry,
): Effect.Effect<PulsarVector, unknown, never> =>
  Effect.gen(function* () {
    if (opts.presetId === undefined) {
      return yield* Effect.fail(new Error(`persona ${opts.action} requires a preset id`))
    }
    const preset = yield* loadPulsarVectorPresetById(opts.presetId)
    yield* validateVectorAgainstRegistry(preset, registry)
    return preset
  })

const printPersonaPreset = (preset: PulsarVector): number => {
  console.log("")
  console.log(`${preset.id}`)
  console.log("")
  console.log(preset.description ?? "No description provided.")
  console.log("")
  console.log(JSON.stringify(preset, null, 2))
  console.log("")
  return 0
}

const applyPersonaPreset = (
  opts: PersonaCommandOptions,
  preset: PulsarVector,
): Effect.Effect<number, Error, never> =>
  Effect.gen(function* () {
    const absolutePath = yield* resolvePersonaOutputPath(opts)
    const applied = appendVectorProvenance(preset, {
      source: "preset",
      recorded_at: new Date().toISOString(),
      summary: `Applied preset ${preset.id}`,
      preset_id: preset.id,
      artifact_path: absolutePath,
      evidence: [
        {
          kind: "preset",
          summary: preset.description ?? `Preset ${preset.id}`,
        },
      ],
    })
    yield* writeJsonFile(absolutePath, applied, {
      writeErrorDescription: `vector at ${absolutePath}`,
    })
    printPersonaApplyResult(preset, absolutePath)
    return 0
  })

const resolvePersonaOutputPath = (
  opts: PersonaCommandOptions,
): Effect.Effect<string, Error, never> =>
  Effect.gen(function* () {
    if (opts.outputPath === undefined) {
      return yield* Effect.fail(new Error("persona apply requires --to <path>"))
    }
    const absolutePath = resolve(opts.outputPath)
    if (existsSync(absolutePath) && !opts.force) {
      return yield* Effect.fail(
        new Error(`Refusing to overwrite existing vector at ${absolutePath}; pass --force to replace it.`),
      )
    }
    return absolutePath
  })

const printPersonaApplyResult = (preset: PulsarVector, absolutePath: string): void => {
  console.log("")
  console.log(`  Applied preset: ${preset.id}`)
  console.log(`  Wrote vector:   ${absolutePath}`)
  console.log("")
}

const diffPersonaPreset = (
  opts: PersonaCommandOptions,
  registry: Registry,
  preset: PulsarVector,
): Effect.Effect<number, unknown, never> =>
  Effect.gen(function* () {
    const repoPath = opts.repoPath ?? "."
    const current = yield* discoverPulsarVector({
      repoPath,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
      registry,
    })
    printPersonaDiff(current, preset)
    return 0
  })

const printPersonaDiff = (
  current: DiscoveredPulsarVector,
  preset: PulsarVector,
): void => {
  const diff = summarizeVectorDiff(current.vector, preset)
  console.log("")
  console.log(`Current vector:        ${current.label}`)
  console.log(`Current vector source: ${current.sourceLabel}`)
  console.log(`Preset:                ${preset.id}`)
  console.log("")
  for (const line of renderVectorDiff(diff)) {
    console.log(line)
  }
  console.log("")
}
