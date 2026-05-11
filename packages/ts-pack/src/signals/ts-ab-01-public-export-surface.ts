import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded, matchesAnyGlob } from "./shared-globs.js"
import { diagnosePublicExportSurface } from "./ts-ab-01-diagnostics.js"
import {
  collectPublicExportSurfaces,
  type FileSurface,
} from "./ts-ab-01-export-collection.js"
import { scorePublicExportSurface } from "./ts-ab-01-scoring.js"

const TsAb01Config = Schema.Struct({
  public_export_globs: Schema.Array(Schema.String),
  exclude_globs: Schema.Array(Schema.String),
  // Threshold, in exports, beyond which a file's surface is penalized.
  surface_threshold: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type TsAb01Config = typeof TsAb01Config.Type

export interface TsAb01Output {
  readonly byFile: ReadonlyMap<string, FileSurface>
  readonly totalPublicExports: number
  readonly largestSurface:
    | { readonly file: string; readonly total: number }
    | undefined
  /**
   * The threshold used at compute time. Captured in output so the
   * pure `score` function can apply the log-scale penalty without
   * reaching back into config.
   */
  readonly surfaceThreshold: number
}

/**
 * TS-AB-01 — public export surface area.
 *
 * Counts exported symbols per "public" file (conventionally a barrel
 * such as `packages/*\/src/index.ts`) classified by kind. The count is
 * symbol-based, not statement-based: `export * from "./x"` resolves the
 * target module's exported declarations and counts the re-exported
 * symbols individually.
 *
 * This is Tier 1: same tree -> same count.
 *
 * Threshold defaults:
 * - public_export_globs: ["**\/src/index.ts", "**\/index.ts"] —
 *   catchall convention for barrel files in monorepos and single-
 *   package layouts. Override to narrow in project pulsar vectors.
 * - surface_threshold: 50 — a file exporting 50+ public symbols is
 *   consistently a case of "everything is exported" rather than an
 *   intentional curated API; log-scale penalty above that.
 */
export const TsAb01: Signal<TsAb01Config, TsAb01Output, TsProjectTag> = {
  id: "TS-AB-01-public-export-surface",
  title: "Public export surface",
  aliases: ["TS-AB-01"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "legibility",
  configSchema: TsAb01Config,
  defaultConfig: {
    public_export_globs: ["**/src/index.ts", "**/index.ts"],
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/__tests__/**",
      "**/test/**",
      "**/tests/**",
      "**/docs/**",
      "**/examples/**",
      "**/prototypes/**",
      "**/explorations/**",
      "**/vendor/**",
      "**/gen/**",
      "**/generated/**",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/sst-env.d.ts",
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
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    surface_threshold: 50,
    top_n_diagnostics: 5,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsAb01Output => {
          const allSourceFiles = project
            .getSourceFiles()
            .filter((sf) => !isExcluded(sf.getFilePath(), config.exclude_globs))
          const sourceFiles = allSourceFiles.filter((sf) =>
            matchesAnyGlob(sf.getFilePath(), config.public_export_globs),
          )
          const surfaces = collectPublicExportSurfaces(sourceFiles, allSourceFiles)

          return {
            byFile: surfaces.byFile,
            totalPublicExports: surfaces.totalPublicExports,
            largestSurface: surfaces.largestSurface,
            surfaceThreshold: config.surface_threshold,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-AB-01-public-export-surface",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: scorePublicExportSurface,
  diagnose: diagnosePublicExportSurface,
}
