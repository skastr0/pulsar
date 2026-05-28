import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import {
  type Diagnostic,
  type DistributionalSummary,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
  summarize,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { RustProjectTag, type RustProject } from "../project.js"
import { isExcluded } from "./shared-globs.js"

const RsAd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  warn_pub_ratio: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsAd01Config = typeof RsAd01Config.Type

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
  readonly averagePubRatio: number
  readonly warnPubRatio: number
  readonly topDiagnostics: number
}

const DEFAULT_WARN_PUB_RATIO = 0.35
const DEFAULT_TOP_N_DIAGNOSTICS = 5

const RS_AD_01_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "metadata",
    defaultValue: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
  },
  {
    path: "config.warn_pub_ratio",
    title: "Config warn pub ratio",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_WARN_PUB_RATIO,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

const emptyVisibilitySurfaceOutput = (config: NormalizedRsAd01Config): RsAd01Output => ({
  modules: [],
  byModule: new Map(),
  totalItems: 0,
  overallPubRatio: 0,
  averagePubRatio: 0,
  warnPubRatio: config.warn_pub_ratio,
  topDiagnostics: config.top_n_diagnostics,
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
  cacheVersion: "visibility-surface-config-thresholds-spaced-visibility-v2",
  configSchema: RsAd01Config,
  factorDefinitions: RS_AD_01_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    warn_pub_ratio: DEFAULT_WARN_PUB_RATIO,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsAd01Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: () => computeVisibilitySurface(project, normalizedConfig),
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
    if (out.averagePubRatio <= out.warnPubRatio) return 1
    const headroom = Math.max(1 - out.warnPubRatio, 0.000001)
    return Math.max(0, 1 - (out.averagePubRatio - out.warnPubRatio) / headroom)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> =>
    out.modules.slice(0, out.topDiagnostics).map((module) => ({
      severity: module.pubRatio >= out.warnPubRatio ? ("warn" as const) : ("info" as const),
      message: `Module ${module.module} exposes ${(module.pubRatio * 100).toFixed(0)}% of its items as pub`,
      location: { file: module.file },
      data: {
        module: module.module,
        pubRatio: module.pubRatio,
        warnPubRatio: out.warnPubRatio,
        counts: {
          pub: module.pub,
          pubCrate: module.pubCrate,
          pubSuper: module.pubSuper,
          pubInPath: module.pubInPath,
          private: module.private,
        },
      },
    })),
  outputMetadata: (out) =>
    out.totalItems === 0 ? { applicability: "insufficient_evidence" as const } : undefined,
  factorLedger: () => makeRsAd01FactorLedger(),
}

type NormalizedRsAd01Config = RsAd01Config

const normalizeRsAd01Config = (config: RsAd01Config): NormalizedRsAd01Config => ({
  exclude_globs: config.exclude_globs,
  warn_pub_ratio: Number.isFinite(config.warn_pub_ratio)
    ? clamp01(config.warn_pub_ratio)
    : DEFAULT_WARN_PUB_RATIO,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const computeVisibilitySurface = async (
  project: RustProject,
  config: NormalizedRsAd01Config,
): Promise<RsAd01Output> => {
  if (project.sourceFiles.length === 0) return emptyVisibilitySurfaceOutput(config)

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
  const averagePubRatio = modules.length === 0
    ? 0
    : modules.reduce((sum, module) => sum + module.pubRatio, 0) / modules.length
  return {
    modules,
    byModule: summarizeVisibilityByModule(modules),
    totalItems,
    overallPubRatio: totalItems === 0 ? 0 : publicItems / totalItems,
    averagePubRatio,
    warnPubRatio: config.warn_pub_ratio,
    topDiagnostics: config.top_n_diagnostics,
  }
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

const makeRsAd01FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-AD-01-visibility-surface", RS_AD_01_FACTOR_DEFINITIONS)

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
