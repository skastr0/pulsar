import type { CalibrationDecision, CalibrationProcessorError, ResolvedCalibrationContext } from "@skastr0/pulsar-core/calibration"
import { Effect, Option } from "effect"
import type { FunctionComplexity } from "./ts-ld-01-complexity.js"
import type { FunctionComplexityCandidate } from "./ts-ld-01-collection.js"

export const calibrateFunctionNames = (
  candidates: ReadonlyArray<FunctionComplexityCandidate>,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<
  {
    readonly functions: ReadonlyArray<FunctionComplexity>
    readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  },
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    if (Option.isNone(calibration)) {
      return {
        functions: candidates.map(stripFunctionNameCalibration),
        calibrationDecisions: [],
      }
    }

    const functions: Array<FunctionComplexity> = []
    const calibrationDecisions: Array<CalibrationDecision> = []
    for (const candidate of candidates) {
      const callbackContext = candidate.callbackContext
      if (callbackContext === undefined) {
        functions.push(stripFunctionNameCalibration(candidate))
        continue
      }

      const result = yield* calibration.value.runSlot("typescript.callback-context-namer", {
        file: candidate.file,
        line: candidate.line,
        ...callbackContext,
      })
      calibrationDecisions.push(...result.decisions)
      functions.push({
        file: candidate.file,
        line: candidate.line,
        complexity: candidate.complexity,
        name: result.value.resolvedName,
      })
    }

    return { functions, calibrationDecisions }
  })

const stripFunctionNameCalibration = (
  candidate: FunctionComplexityCandidate,
): FunctionComplexity => ({
  file: candidate.file,
  name: candidate.name,
  line: candidate.line,
  complexity: candidate.complexity,
})
