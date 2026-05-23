import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { CalibrationContextTag } from "@skastr0/pulsar-core/calibration"
import type { CalibrationDecision } from "@skastr0/pulsar-core/calibration"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { computeUnsafeTypeErosionOutput } from "./ts-ld-07-analysis.js"

const TsLd07Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  max_weighted_unsafe_per_kloc: Schema.Number,
  max_boundary_weighted_unsafe: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type TsLd07Config = typeof TsLd07Config.Type

export type UnsafeTypeKind =
  | "parameter"
  | "return"
  | "property"
  | "variable"
  | "type-alias"
  | "assertion"
  | "heritage"
  | "unknown"

export interface UnsafeTypeOccurrence {
  readonly findingId: string
  readonly file: string
  readonly line: number
  readonly kind: UnsafeTypeKind
  readonly target: string
  readonly boundary: boolean
  readonly severity: "info" | "warn" | "block"
  readonly visible: boolean
  readonly baseWeight: number
  readonly weight: number
  readonly policyDecisions?: ReadonlyArray<CalibrationDecision>
}

export interface UnsafeTypeFileSummary {
  readonly occurrences: number
  readonly boundaryOccurrences: number
  readonly weightedUnsafe: number
  readonly boundaryWeightedUnsafe: number
}

export interface TsLd07Output {
  readonly byFile: ReadonlyMap<string, UnsafeTypeFileSummary>
  readonly occurrences: ReadonlyArray<UnsafeTypeOccurrence>
  readonly topOccurrences: ReadonlyArray<UnsafeTypeOccurrence>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly totalOccurrences: number
  readonly boundaryOccurrences: number
  readonly weightedUnsafe: number
  readonly boundaryWeightedUnsafe: number
  readonly analyzedFiles: number
  readonly analyzedLines: number
  readonly densityPerKloc: number
  readonly densityPressure: number
  readonly boundaryPressure: number
  readonly densityThreshold: number
  readonly boundaryThreshold: number
  readonly diagnosticLimit: number
}

export const TsLd07: Signal<TsLd07Config, TsLd07Output, TsProjectTag> = {
  id: "TS-LD-07-unsafe-type-erosion",
  title: "Unsafe type erosion",
  aliases: ["TS-LD-07"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "unsafe-type-erosion-v4-value-type-surfaces-v1",
  configSchema: TsLd07Config,
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
      "**/build/**",
      "**/coverage/**",
      "**/.turbo/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
    ],
    max_weighted_unsafe_per_kloc: 10,
    max_boundary_weighted_unsafe: 48,
    top_n_diagnostics: 10,
  },
  configDirections: {
    max_weighted_unsafe_per_kloc: "higher-is-looser",
    max_boundary_weighted_unsafe: "higher-is-looser",
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const calibration = yield* Effect.serviceOption(CalibrationContextTag)
      const result = yield* Effect.try({
        try: () => project.getSourceFiles(),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-LD-07-unsafe-type-erosion",
            message: String(cause),
            cause,
          }),
      })
      const output = yield* computeUnsafeTypeErosionOutput(result, config, calibration).pipe(
        Effect.mapError(
          (cause) =>
            new SignalComputeError({
              signalId: "TS-LD-07-unsafe-type-erosion",
              message: String(cause),
              cause,
            }),
        ),
      )
      return output
    }),
  score: (out) => {
    if (out.totalOccurrences === 0) return 1
    const pressure = Math.max(out.densityPressure, out.boundaryPressure)
    return 1 / (1 + pressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.topOccurrences.map((occurrence) => ({
      severity: occurrence.severity,
      message:
        `Unsafe \`any\` in ${occurrence.boundary ? "boundary " : ""}` +
        `${unsafeKindLabel(occurrence.kind)} \`${occurrence.target}\``,
      location: { file: occurrence.file, line: occurrence.line },
      data: {
        ...occurrence,
        densityPerKloc: out.densityPerKloc,
        densityThreshold: out.densityThreshold,
        boundaryThreshold: out.boundaryThreshold,
      },
    })),
}

const unsafeKindLabel = (kind: UnsafeTypeKind): string => {
  if (kind === "type-alias") return "type alias"
  return kind
}
