import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@taste-codec/core"
import { Effect, Schema } from "effect"
import { TsProjectTag } from "../ts-project.js"
import { isExcluded } from "./shared-globs.js"
import {
  collectTypeReferenceLikeNodes,
  declarationKey,
  resolveReferenceLikeDeclarations,
} from "./shared-type-analysis.js"

export const TsDe01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type TsDe01Config = typeof TsDe01Config.Type

export interface CouplingCounterpart {
  readonly module: string
  readonly outgoingTypes: number
  readonly incomingTypes: number
  readonly totalTypes: number
}

export interface ModuleTypeCoupling {
  readonly file: string
  readonly externalTypesReferenced: number
  readonly typesReferencedExternally: number
  readonly totalCoupling: number
  readonly counterparts: ReadonlyArray<CouplingCounterpart>
}

export interface TsDe01Output {
  readonly modules: ReadonlyArray<ModuleTypeCoupling>
  readonly byModule: ReadonlyMap<string, DistributionalSummary>
  readonly repoDistribution: DistributionalSummary
  readonly outlierThreshold: number
  readonly totalModules: number
  readonly diagnosticLimit: number
}

export const TsDe01: Signal<TsDe01Config, TsDe01Output, TsProjectTag> = {
  id: "TS-DE-01",
  tier: 1,
  category: "dependency-entropy",
  kind: "legibility",
  configSchema: TsDe01Config,
  defaultConfig: {
    exclude_globs: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
    ],
    top_n_diagnostics: 10,
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
          const fileSet = new Set(sourceFiles.map((sourceFile) => sourceFile.getFilePath()))
          const outgoing = new Map<string, Map<string, Set<string>>>()
          const incoming = new Map<string, Map<string, Set<string>>>()

          for (const file of fileSet) {
            outgoing.set(file, new Map())
            incoming.set(file, new Map())
          }

          for (const sourceFile of sourceFiles) {
            const src = sourceFile.getFilePath()

            for (const reference of collectTypeReferenceLikeNodes(sourceFile)) {
              for (const declaration of resolveReferenceLikeDeclarations(reference)) {
                const targetFile = declaration.getSourceFile().getFilePath()
                if (!fileSet.has(targetFile) || targetFile === src) continue

                ensureNestedSet(outgoing, src, targetFile).add(declarationKey(declaration))
                ensureNestedSet(incoming, targetFile, src).add(declarationKey(declaration))
              }
            }
          }

          const byModule = new Map<string, DistributionalSummary>()
          const modules: Array<ModuleTypeCoupling> = []

          for (const file of fileSet) {
            const outgoingByCounterpart = outgoing.get(file) ?? new Map()
            const incomingByCounterpart = incoming.get(file) ?? new Map()
            const counterpartPaths = new Set<string>([
              ...outgoingByCounterpart.keys(),
              ...incomingByCounterpart.keys(),
            ])

            const counterparts = [...counterpartPaths]
              .map((counterpart): CouplingCounterpart => ({
                module: counterpart,
                outgoingTypes: outgoingByCounterpart.get(counterpart)?.size ?? 0,
                incomingTypes: incomingByCounterpart.get(counterpart)?.size ?? 0,
                totalTypes:
                  (outgoingByCounterpart.get(counterpart)?.size ?? 0) +
                  (incomingByCounterpart.get(counterpart)?.size ?? 0),
              }))
              .filter((counterpart) => counterpart.totalTypes > 0)
              .sort(compareCounterparts)

            const summary = summarize(counterparts.map((counterpart) => counterpart.totalTypes))
            const externalTypesReferenced = uniqueSetSize(outgoingByCounterpart.values())
            const typesReferencedExternally = uniqueSetSize(incomingByCounterpart.values())

            modules.push({
              file,
              externalTypesReferenced,
              typesReferencedExternally,
              totalCoupling: externalTypesReferenced + typesReferencedExternally,
              counterparts,
            })
            byModule.set(file, summary)
          }

          modules.sort(compareModules)

          const repoDistribution = summarize(modules.map((module) => module.totalCoupling))

          return {
            modules,
            byModule,
            repoDistribution,
            outlierThreshold: Math.max(repoDistribution.avg, repoDistribution.p95),
            totalModules: modules.length,
            diagnosticLimit: config.top_n_diagnostics,
          }
        },
        catch: (cause) =>
          new SignalComputeError({
            signalId: "TS-DE-01",
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
      .filter((module) => module.totalCoupling > 0)
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

const ensureNestedSet = (
  table: Map<string, Map<string, Set<string>>>,
  outer: string,
  inner: string,
): Set<string> => {
  const row = table.get(outer) ?? new Map<string, Set<string>>()
  table.set(outer, row)
  const set = row.get(inner) ?? new Set<string>()
  row.set(inner, set)
  return set
}

const uniqueSetSize = (sets: Iterable<Set<string>>): number => {
  const merged = new Set<string>()
  for (const set of sets) {
    for (const value of set) {
      merged.add(value)
    }
  }
  return merged.size
}

const compareCounterparts = (left: CouplingCounterpart, right: CouplingCounterpart): number => {
  if (right.totalTypes !== left.totalTypes) {
    return right.totalTypes - left.totalTypes
  }
  return left.module.localeCompare(right.module)
}

const compareModules = (left: ModuleTypeCoupling, right: ModuleTypeCoupling): number => {
  if (right.totalCoupling !== left.totalCoupling) {
    return right.totalCoupling - left.totalCoupling
  }
  return left.file.localeCompare(right.file)
}
