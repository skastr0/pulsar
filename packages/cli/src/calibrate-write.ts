import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { Effect } from "effect"
import type { CalibrationSuggestionReport } from "./calibrate-suggestions.js"

const RELATIVE_SUGGESTIONS_PATH = ".pulsar/calibration-suggestions.json"

export const writeSuggestionReport = (report: CalibrationSuggestionReport) =>
  Effect.gen(function* () {
    const writePath = join(report.repo_root, RELATIVE_SUGGESTIONS_PATH)
    yield* Effect.tryPromise({
      try: () => mkdir(join(writePath, ".."), { recursive: true }),
      catch: (cause) => new Error(`Failed to create .pulsar directory: ${String(cause)}`),
    })
    const withWritePath = { ...report, write_path: writePath }
    yield* Effect.tryPromise({
      try: () => writeFile(writePath, `${JSON.stringify(withWritePath, null, 2)}\n`, "utf8"),
      catch: (cause) => new Error(`Failed to write calibration suggestions: ${String(cause)}`),
    })
    return withWritePath
  })
