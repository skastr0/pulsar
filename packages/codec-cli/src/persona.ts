import { existsSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import {
  appendVectorProvenance,
  loadTasteVectorPresetById,
  loadTasteVectorPresets,
  summarizeTasteVectorPresets,
  validateVectorAgainstRegistry,
} from "@taste-codec/core"
import { Effect } from "effect"
import { buildCodecRegistry } from "./runtime.js"
import { discoverTasteVector } from "./vector-discovery.js"
import { renderVectorDiff, summarizeVectorDiff } from "./vector-format.js"

export interface PersonaCommandOptions {
  readonly action: "list" | "show" | "apply" | "diff"
  readonly presetId?: string
  readonly outputPath?: string
  readonly force?: boolean
  readonly repoPath?: string
  readonly vectorPath?: string
}

export const runPersonaCommand = (opts: PersonaCommandOptions) =>
  Effect.gen(function* () {
    const registry = yield* buildCodecRegistry()
    const presets = yield* loadTasteVectorPresets()
    for (const preset of presets) {
      yield* validateVectorAgainstRegistry(preset, registry)
    }

    if (opts.action === "list") {
      console.log("")
      console.log("Available persona presets:")
      for (const preset of summarizeTasteVectorPresets(presets)) {
        console.log(`  ${preset.id.padEnd(20)} ${preset.description}`)
      }
      console.log("")
      return 0
    }

    const presetId = opts.presetId
    if (presetId === undefined) {
      return yield* Effect.fail(new Error(`persona ${opts.action} requires a preset id`))
    }

    const preset = yield* loadTasteVectorPresetById(presetId)
    yield* validateVectorAgainstRegistry(preset, registry)

    if (opts.action === "show") {
      console.log("")
      console.log(`${preset.id}`)
      console.log("")
      console.log(preset.description ?? "No description provided.")
      console.log("")
      console.log(JSON.stringify(preset, null, 2))
      console.log("")
      return 0
    }

    if (opts.action === "apply") {
      const outputPath = opts.outputPath
      if (outputPath === undefined) {
        return yield* Effect.fail(new Error("persona apply requires --to <path>"))
      }

      const absolutePath = resolve(outputPath)
      if (existsSync(absolutePath) && !opts.force) {
        return yield* Effect.fail(
          new Error(`Refusing to overwrite existing vector at ${absolutePath}; pass --force to replace it.`),
        )
      }

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

      yield* Effect.tryPromise({
        try: () => mkdir(dirname(absolutePath), { recursive: true }),
        catch: (cause) => new Error(`Failed to create directory for ${absolutePath}: ${String(cause)}`),
      })
      yield* Effect.tryPromise({
        try: () => writeFile(absolutePath, `${JSON.stringify(applied, null, 2)}\n`, "utf8"),
        catch: (cause) => new Error(`Failed to write vector at ${absolutePath}: ${String(cause)}`),
      })

      console.log("")
      console.log(`  Applied preset: ${preset.id}`)
      console.log(`  Wrote vector:   ${absolutePath}`)
      console.log("")
      return 0
    }

    const repoPath = opts.repoPath ?? "."
    const current = yield* discoverTasteVector({
      repoPath,
      ...(opts.vectorPath !== undefined ? { explicitPath: opts.vectorPath } : {}),
      registry,
    })
    const diff = summarizeVectorDiff(current.vector, preset)

    console.log("")
    console.log(`Current vector: ${current.label}`)
    console.log(`Preset:         ${preset.id}`)
    console.log("")
    for (const line of renderVectorDiff(diff)) {
      console.log(line)
    }
    console.log("")
    return 0
  })
