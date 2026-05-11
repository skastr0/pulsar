import { Effect } from "effect"
import { printHumanReport } from "./calibrate-output.js"
import { buildSuggestionReport, type CalibrateCommandOptions } from "./calibrate-suggestions.js"
import { writeSuggestionReport } from "./calibrate-write.js"

export type { CalibrateCommandOptions } from "./calibrate-suggestions.js"

export const runCalibrateCommand = (opts: CalibrateCommandOptions) =>
  Effect.gen(function* () {
    if (opts.action !== "suggest") {
      return yield* Effect.fail(new Error("calibrate requires one of: suggest"))
    }

    const report = yield* buildSuggestionReport(opts)
    const finalReport =
      opts.write === true ? yield* writeSuggestionReport(report) : report

    if (opts.json === true) {
      console.log(JSON.stringify(finalReport, null, 2))
    } else {
      printHumanReport(finalReport)
    }
    return 0
  })
