import { SignalComputeError } from "@skastr0/pulsar-core/signal"
import type { Diagnostic, Signal } from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import { computeFastImportTypeCoupling } from "./ts-de-01-fast-coupling.js"
import { computePreciseTypeCoupling } from "./ts-de-01-precise-coupling.js"
import type {
  CouplingCounterpart,
  ModuleTypeCoupling,
  TsDe01Output,
} from "./ts-de-01-coupling-output.js"

const TsDe01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
  precise_module_limit: Schema.Number,
})
type TsDe01Config = typeof TsDe01Config.Type

export const TsDe01: Signal<TsDe01Config, TsDe01Output, TsProjectTag> = {
  id: "TS-DE-01-type-level-coupling",
  title: "Type-level coupling",
  aliases: ["TS-DE-01"],
  tier: 1,
  category: "dependency-entropy",
  kind: "legibility",
  configSchema: TsDe01Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx",
      "**/*.d.ts",
      "**/*.gen.ts",
      "**/*.gen.tsx",
      "**/*.generated.ts",
      "**/*.generated.tsx",
      "**/gen/**",
      "**/generated/**",
      "**/vendor/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    top_n_diagnostics: 10,
    precise_module_limit: 1_000,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* TsProjectTag
      const result = yield* Effect.try({
        try: (): TsDe01Output => {
          const sourceFiles = project
            .getSourceFiles()
            .filter((sourceFile) => !isExcluded(sourceFile.getFilePath(), config.exclude_globs))
          if (sourceFiles.length > config.precise_module_limit) {
            return computeFastImportTypeCoupling(sourceFiles, config.top_n_diagnostics)
          }
          return computePreciseTypeCoupling(sourceFiles, config.top_n_diagnostics)
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-01-type-level-coupling",
            message: String(cause),
            cause,
          }),
      })
      return result
    }),
  score: (out) => {
    if (out.totalModules === 0) return 1

    const threshold = Math.max(1, out.outlierThreshold)
    const excess = out.modules.reduce((total, module) => {
      if (module.totalCoupling <= out.outlierThreshold) return total
      return total + (module.totalCoupling - threshold) / threshold
    }, 0)

    return Math.max(0, 1 - excess / out.totalModules)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.modules
      .filter((module) => module.totalCoupling > out.outlierThreshold)
      .slice(0, out.diagnosticLimit)
      .map((module) => ({
        severity: "warn" as const,
        message:
          `Type coupling in ${module.file}: ` +
          `out=${module.externalTypesReferenced}, in=${module.typesReferencedExternally}`,
        location: { file: module.file },
        data: {
          ...module,
          outlierThreshold: out.outlierThreshold,
        },
      })),
}
