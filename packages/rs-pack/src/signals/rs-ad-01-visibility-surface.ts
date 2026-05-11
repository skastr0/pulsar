import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag, type RustProject } from "../project.js"
import { isExcluded } from "./shared-globs.js"

export const RsAd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  warn_pub_ratio: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type RsAd01Config = typeof RsAd01Config.Type

export interface ModuleVisibilitySurface {
  readonly module: string
  readonly file: string
  readonly pub: number
  readonly pubCrate: number
  readonly pubSuper: number
  readonly pubInPath: number
  readonly private: number
  readonly total: number
  readonly pubRatio: number
}

export interface RsAd01Output {
  readonly modules: ReadonlyArray<ModuleVisibilitySurface>
  readonly byModule: ReadonlyMap<string, DistributionalSummary>
  readonly totalItems: number
  readonly overallPubRatio: number
}

const emptyVisibilitySurfaceOutput = (): RsAd01Output => ({
  modules: [],
  byModule: new Map(),
  totalItems: 0,
  overallPubRatio: 0,
})

const emptyModuleVisibilitySurface = (
  module: string,
  file: string,
): ModuleVisibilitySurface => ({
  module,
  file,
  pub: 0,
  pubCrate: 0,
  pubSuper: 0,
  pubInPath: 0,
  private: 0,
  total: 0,
  pubRatio: 0,
})

export const RsAd01: Signal<RsAd01Config, RsAd01Output, RustProjectTag> = {
  id: "RS-AD-01-visibility-surface",
  title: "Visibility surface",
  aliases: ["RS-AD-01"],
  tier: 1,
  category: "architectural-drift",
  kind: "structural",
  configSchema: RsAd01Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    warn_pub_ratio: 0.35,
    top_n_diagnostics: 5,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: () => computeVisibilitySurface(project, config),
        catch: (cause) =>
          new SignalComputeError({
            signalId: "RS-AD-01-visibility-surface",
            message: String(cause),
            cause,
          }),
      })
    }),
  score: (out) => {
    if (out.modules.length === 0) return 1
    const averageRatio = out.modules.reduce((sum, module) => sum + module.pubRatio, 0) / out.modules.length
    if (averageRatio <= 0.35) return 1
    return Math.max(0, 1 - (averageRatio - 0.35) / 0.65)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.modules.slice(0, 5).map((module) => ({
      severity: module.pubRatio >= 0.5 ? ("warn" as const) : ("info" as const),
      message: `Module ${module.module} exposes ${(module.pubRatio * 100).toFixed(0)}% of its items as pub`,
      location: { file: module.file },
      data: {
        module: module.module,
        pubRatio: module.pubRatio,
        counts: {
          pub: module.pub,
          pubCrate: module.pubCrate,
          pubSuper: module.pubSuper,
          pubInPath: module.pubInPath,
          private: module.private,
        },
      },
    })),
}

const computeVisibilitySurface = async (
  project: RustProject,
  config: RsAd01Config,
): Promise<RsAd01Output> => {
  if (project.sourceFiles.length === 0) return emptyVisibilitySurfaceOutput()

  const facts = await collectRustProjectFacts(project)
  const grouped = new Map<string, ModuleVisibilitySurface>()
  for (const item of facts.items) {
    if (item.kind === "impl") continue
    if (isExcluded(item.file, config.exclude_globs)) continue
    recordVisibilityItem(grouped, item.modulePath, item.file, item.visibility.kind)
  }

  const modules = finalizeVisibilityModules(grouped)
  const totalItems = modules.reduce((sum, module) => sum + module.total, 0)
  const publicItems = modules.reduce((sum, module) => sum + module.pub, 0)
  return {
    modules,
    byModule: summarizeVisibilityByModule(modules),
    totalItems,
    overallPubRatio: totalItems === 0 ? 0 : publicItems / totalItems,
  }
}

const recordVisibilityItem = (
  grouped: Map<string, ModuleVisibilitySurface>,
  modulePath: string,
  file: string,
  visibilityKind: "pub" | "pub-crate" | "pub-super" | "pub-in-path" | "private",
): void => {
  const existing = { ...(grouped.get(modulePath) ?? emptyModuleVisibilitySurface(modulePath, file)) }
  switch (visibilityKind) {
    case "pub":
      existing.pub += 1
      break
    case "pub-crate":
      existing.pubCrate += 1
      break
    case "pub-super":
      existing.pubSuper += 1
      break
    case "pub-in-path":
      existing.pubInPath += 1
      break
    case "private":
      existing.private += 1
      break
  }
  existing.total += 1
  grouped.set(modulePath, existing)
}

const finalizeVisibilityModules = (
  grouped: ReadonlyMap<string, ModuleVisibilitySurface>,
): ReadonlyArray<ModuleVisibilitySurface> =>
  [...grouped.values()]
    .map((entry) => ({
      ...entry,
      pubRatio: entry.total === 0 ? 0 : entry.pub / entry.total,
    }))
    .sort((a, b) => b.pubRatio - a.pubRatio || a.module.localeCompare(b.module))

const summarizeVisibilityByModule = (
  modules: ReadonlyArray<ModuleVisibilitySurface>,
): ReadonlyMap<string, DistributionalSummary> =>
  new Map(modules.map((module) => [module.module, summarize([module.pubRatio])]))
