import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Signal } from "@skastr0/pulsar-core/signal"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import { Effect } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { collectProjectSizes } from "./ts-ld-02-counting.js"
import { diagnoseTsLd02 } from "./ts-ld-02-diagnostics.js"
import {
  TsLd02Config as TsLd02ConfigSchema,
  type TsLd02Config as TsLd02ConfigType,
  type TsLd02Output,
} from "./ts-ld-02-model.js"
import {
  buildTsLd02Output,
  calibrateThresholdFunctions,
  summarizeThresholds,
} from "./ts-ld-02-thresholds.js"

/**
 * TS-LD-02 — function / file size distribution.
 *
 * Counts non-blank, non-comment lines per function body and per
 * source file. Emits both true outliers (above p95 + threshold) and
 * absolute threshold contributors that directly affect max-pressure
 * scoring, so every score-bearing pressure has actionable evidence.
 *
 * Threshold defaults:
 * - max_function_loc: 50 — mainstream cognitive-load guidance across
 *   Rich Hickey, Kent Beck, and modern style guides converges around
 *   "fits on a screen" (~50 LOC). Good enough as a first cut.
 * - max_file_loc: 300 — typical "this file is a drag to review"
 *   threshold across linter defaults and team conventions. Trend
 *   metric first, hard gate later.
 */
export const TsLd02: Signal<TsLd02ConfigType, TsLd02Output, TsProjectTag> = {
  id: "TS-LD-02-function-size-distribution",
  title: "Function size distribution",
  aliases: ["TS-LD-02"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "exclusive-function-loc-v2",
  configSchema: TsLd02ConfigSchema,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "**/*.d.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/test-support/**",
      "**/*test-support.ts",
      "**/*test-support.tsx",
      "**/*.test-support.ts",
      "**/*.test-support.tsx",
      "**/test-helpers.ts",
      "**/*test-helpers.ts",
      "**/*test-helpers.tsx",
      "**/*.test-helpers.ts",
      "**/*.test-helpers.tsx",
      "**/test-mocks.ts",
      "**/*test-mocks.ts",
      "**/*test-mocks.tsx",
      "**/*.test-mocks.ts",
      "**/*.test-mocks.tsx",
      "**/test-harness.ts",
      "**/*test-harness.ts",
      "**/*test-harness.tsx",
      "**/*.test-harness.ts",
      "**/*.test-harness.tsx",
      "**/happydom.ts",
    ],
    max_function_loc: 50,
    max_file_loc: 300,
    top_n_diagnostics: 5,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const collected = yield* Effect.try({
        try: () => collectProjectSizes(project, config),
        catch: toSignalComputeError,
      })
      const thresholds = summarizeThresholds(collected, config)
      const calibratedFunctions = yield* calibrateThresholdFunctions(
        thresholds,
        collected,
        config,
        calibration,
      ).pipe(Effect.mapError(toSignalComputeError))
      return buildTsLd02Output(collected, thresholds, calibratedFunctions)
    }),
  score: (out) => {
    const totalEntities = out.totalFunctions + out.totalFiles
    if (totalEntities === 0) return 1
    const pressure = Math.max(
      out.ratioPressure,
      out.maxFunctionPressure,
      out.maxFilePressure,
    )
    return Math.max(0, 1 - pressure)
  },
  outputMetadata: (out) =>
    out.totalFunctions + out.totalFiles === 0
      ? { applicability: "not_applicable" as const }
      : undefined,
  diagnose: diagnoseTsLd02,
}

const toSignalComputeError = (cause: unknown): SignalComputeError =>
  cause instanceof SignalComputeError
    ? cause
    : new SignalComputeError({
        signalId: "TS-LD-02-function-size-distribution",
        message: String(cause),
        cause,
      })
