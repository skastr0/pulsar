import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsPackageInfoTag, TsProjectTag } from "../ts-project.js"
import {
  analyzeCircularDependencies,
  type Cycle,
  type ExpiredBypassMatch,
} from "./ts-ad-02-cycle-graph.js"
import { diagnoseCircularDependencies } from "./ts-ad-02-diagnostics.js"

const TsAd02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  // Cap on number of cycles reported in diagnostics; the raw output
  // includes all detected cycles regardless.
  top_n_diagnostics: Schema.Number,
})
type TsAd02Config = typeof TsAd02Config.Type

export interface TsAd02Output {
  readonly cycles: ReadonlyArray<Cycle>
  readonly cycleCount: number
  readonly largestCycleSize: number
  readonly expiredBypasses: ReadonlyArray<ExpiredBypassMatch>
  readonly diagnosticLimit: number
}

/**
 * TS-AD-02 — circular module dependencies.
 *
 * Builds the import graph across the project's source files, then runs
 * Tarjan's strongly-connected-components algorithm to detect cycles.
 * Any SCC with more than one node, or a self-loop (node pointing to
 * itself), counts as a cycle.
 *
 * Threshold defaults:
 * - exclude_globs: skip tests and build artifacts so generated code
 *   and type-fixture cycles don't drown out real signal.
 * - top_n_diagnostics: 10 — readable diagnostic lists should stay
 *   scannable; raw output preserves all cycles for consumers that want
 *   the full picture.
 */
export const TsAd02: Signal<TsAd02Config, TsAd02Output, TsProjectTag | TsPackageInfoTag> = {
  id: "TS-AD-02-circular-dependencies",
  title: "Circular dependencies",
  aliases: ["TS-AD-02"],
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  cacheVersion: "semantic-type-only-imports-v3",
  configSchema: TsAd02Config,
  defaultConfig: {
    // Rationale: cycles inside test scaffolding or generated output are
    // not architectural signal — they would either be intentional
    // (mocks) or artifacts of tooling.
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.d.ts",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/gen/**",
      "**/generated/**",
      "**/vendor/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/example/**",
      "**/examples/**",
      "**/demo/**",
      "**/demos/**",
      "**/private-demos/**",
      "**/sample/**",
      "**/samples/**",
      "**/sdk-samples/**",
      "**/google_samples/**",
    ],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const packages = yield* TsPackageInfoTag
      const result = yield* Effect.try({
        try: (): TsAd02Output => {
          const analysis = analyzeCircularDependencies(
            project.getSourceFiles(),
            config.exclude_globs,
            packages,
          )

          return {
            ...analysis,
            diagnosticLimit: normalizeDiagnosticLimit(config.top_n_diagnostics),
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AD-02-circular-dependencies",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.cycleCount === 0) return 1
    // Two-part penalty: cycle count drives broad pressure, while cycle
    // size grows logarithmically so local and subsystem cycles stay
    // distinguishable from repo-scale tangles. Huge SCCs still collapse
    // toward the floor.
    const countPenalty = Math.min(0.45, out.cycleCount * 0.05)
    const sizePenalty = cycleSizePenalty(out.largestCycleSize)
    return Math.max(0.05, 1 - countPenalty - sizePenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => diagnoseCircularDependencies(out),
}

const cycleSizePenalty = (largestCycleSize: number): number => {
  const scale = Math.log2(Math.max(1, largestCycleSize - 1))
  if (largestCycleSize >= 75) return 0.9
  if (largestCycleSize >= 20) return Math.min(0.7, scale * 0.1)
  if (largestCycleSize >= 8) return scale * 0.09
  return scale * 0.12
}

const normalizeDiagnosticLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0
