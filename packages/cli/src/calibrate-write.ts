import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { resolvePulsarRepoStatePath } from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"
import type { CalibrationSuggestionReport } from "./calibrate-suggestions.js"

const SUGGESTIONS_FILE = "calibration-suggestions.json"

export const writeSuggestionReport = (
  report: CalibrationSuggestionReport,
): Effect.Effect<CalibrationSuggestionReport, Error, never> =>
  Effect.gen(function* () {
    const writePath = resolvePulsarRepoStatePath(report.repo_root, "calibrate", SUGGESTIONS_FILE)
    yield* Effect.tryPromise({
      try: () => mkdir(join(writePath, ".."), { recursive: true }),
      catch: (cause) => new Error(`Failed to create calibration state directory: ${String(cause)}`),
    })
    const withWritePath = { ...report, write_path: writePath }
    yield* Effect.tryPromise({
      try: () => writeFile(writePath, `${JSON.stringify(withWritePath, null, 2)}\n`, "utf8"),
      catch: (cause) => new Error(`Failed to write calibration suggestions: ${String(cause)}`),
    })
    return withWritePath
  })
