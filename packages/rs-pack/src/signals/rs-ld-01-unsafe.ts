import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import type { RustAnalysis } from "../rust-analysis.js"
import type { RustFunctionFact } from "../rust-analysis-types.js"
import { type RustProject, RustProjectTag } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"
import {
  collectFunctionCallFacts,
  unsafePropagatingFunctionKeys,
} from "./rs-ld-01-unsafe-calls.js"
import {
  type FunctionCallFacts,
  type UnsafeModuleSummary,
  type UnsafeSite,
  type UnsafeSiteKind,
  functionKey,
} from "./rs-ld-01-unsafe-model.js"
import { collectUnsafeSites } from "./rs-ld-01-unsafe-sites.js"

const RsLd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  safe_only_modules: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsLd01Config = typeof RsLd01Config.Type

interface RsLd01Output {
  readonly modules: ReadonlyArray<UnsafeModuleSummary>
  readonly totalUnsafeBlocks: number
  readonly totalUnsafeFunctions: number
  readonly totalUnsafeSites: number
  readonly unsafeSites: ReadonlyArray<UnsafeSite>
  readonly unsafeSiteKindCounts: Partial<Record<UnsafeSiteKind, number>>
  readonly totalPropagatingFunctions: number
  readonly repositoryUnsafePropagationShare: number
  readonly repositoryUnsafeSitesPerFunction: number
  readonly repositoryCappedUnsafeSiteShare: number
  readonly repositoryUnsafePressure: number
  readonly safeOnlyViolations: ReadonlyArray<UnsafeModuleSummary>
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly functionCount: number
  readonly diagnosticLimit: number
  readonly propagationMode: "local-call-graph"
  readonly scoreMode: "one-minus-max-propagation-share-or-capped-site-share"
  readonly safeOnlySelectorMode: "module-subtree"
  readonly diagnosticCapPolicy: "safe-only-blocks-uncapped-warnings-capped"
  readonly sitePressureScoreCap: number
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const UNSAFE_SITE_PRESSURE_SCORE_CAP = 1
const RS_LD_01_SCORE_MODE = "one-minus-max-propagation-share-or-capped-site-share" as const
const SAFE_ONLY_SELECTOR_MODE = "module-subtree" as const
const DIAGNOSTIC_CAP_POLICY = "safe-only-blocks-uncapped-warnings-capped" as const

const RS_LD_01_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.safe_only_modules",
    title: "Config safe only modules",
    valueKind: "array",
    scoreRole: "threshold",
    defaultValue: [],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsLd01: Signal<RsLd01Config, RsLd01Output, RustProjectTag> = {
  id: "RS-LD-01-unsafe-code",
  title: "Unsafe code",
  aliases: ["RS-LD-01"],
  tier: 1,
  category: "legibility-decay",
  kind: "legibility",
  cacheVersion: "unsafe-code-config-applicability-diagnostics-call-graph-density-sites-safe-only-qualified-v6",
  configSchema: RsLd01Config,
  factorDefinitions: RS_LD_01_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    safe_only_modules: [],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsLd01Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: () => computeRsLd01Output(project, normalizedConfig),
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-LD-01-unsafe-code", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.safeOnlyViolations.length > 0) return 0
    if (out.functionCount === 0 && out.totalUnsafeSites === 0) return 1
    return Math.max(0, 1 - out.repositoryUnsafePressure)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-LD-01 found no Rust source files for unsafe code analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          functionCount: out.functionCount,
          propagationMode: out.propagationMode,
          scoreMode: out.scoreMode,
          safeOnlySelectorMode: out.safeOnlySelectorMode,
          diagnosticCapPolicy: out.diagnosticCapPolicy,
        },
      }].slice(0, out.diagnosticLimit)
    }
    const safeOnlyDiagnostics = out.safeOnlyViolations.map((module) => ({
      severity: "block" as const,
      message: `Unsafe usage in safe-only module ${module.module}`,
      location: { file: module.file },
      data: {
          module: module.module,
          safeOnlyMatchedSelectors: module.safeOnlyMatchedSelectors,
          safeOnlySelectorMode: out.safeOnlySelectorMode,
          unsafeSiteCount: module.unsafeSiteCount,
          unsafeSiteKindCounts: module.unsafeSiteKindCounts,
          sites: siteDiagnosticSample(module.sites),
          unsafeBlockCount: module.unsafeBlockCount,
          unsafeFunctionCount: module.unsafeFunctionCount,
        propagatingFunctionCount: module.propagatingFunctionCount,
        diagnosticCapPolicy: out.diagnosticCapPolicy,
      },
    }))
    const warningDiagnostics = out.modules
      .filter((module) => module.unsafeSiteCount > 0 || module.propagatingFunctionCount > 0)
      .map((module) => ({
        severity: "warn" as const,
        message: `Unsafe surface in ${module.module}: ${(module.unsafePropagationShare * 100).toFixed(0)}% functions, ${unsafeSitePressureText(module)}`,
        location: { file: module.file },
        data: {
          module: module.module,
          unsafeSiteCount: module.unsafeSiteCount,
          unsafeSiteKindCounts: module.unsafeSiteKindCounts,
          sites: siteDiagnosticSample(module.sites),
          unsafePropagationShare: module.unsafePropagationShare,
          unsafeSitesPerFunction: module.unsafeSitesPerFunction,
          cappedUnsafeSiteShare: module.cappedUnsafeSiteShare,
          unsafePressure: module.unsafePressure,
          unsafeBlockCount: module.unsafeBlockCount,
          unsafeFunctionCount: module.unsafeFunctionCount,
          propagatingFunctionCount: module.propagatingFunctionCount,
          propagationMode: out.propagationMode,
          scoreMode: out.scoreMode,
          diagnosticCapPolicy: out.diagnosticCapPolicy,
        },
      }))
    return [
      ...safeOnlyDiagnostics,
      ...warningDiagnostics.slice(0, out.diagnosticLimit),
    ]
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || (out.functionCount === 0 && out.totalUnsafeSites === 0)) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsLd01FactorLedger(),
}

type NormalizedRsLd01Config = RsLd01Config

const normalizeRsLd01Config = (config: RsLd01Config): NormalizedRsLd01Config => ({
  exclude_globs: config.exclude_globs,
  safe_only_modules: config.safe_only_modules
    .map((module) => module.trim())
    .filter((module) => module.length > 0),
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

interface UnsafeAnalysisFacts {
  readonly facts: RustAnalysis
  readonly analyzedSourceFiles: ReadonlyArray<string>
  readonly callFacts: ReadonlyArray<FunctionCallFacts>
  readonly unsafeSites: ReadonlyArray<UnsafeSite>
}

interface UnsafeModuleBuild {
  readonly modules: ReadonlyArray<UnsafeModuleSummary>
  readonly functionCount: number
}

interface RepositoryUnsafeTotals {
  readonly totalUnsafeBlocks: number
  readonly totalUnsafeFunctions: number
  readonly totalUnsafeSites: number
  readonly unsafeSiteKindCounts: Partial<Record<UnsafeSiteKind, number>>
  readonly totalPropagatingFunctions: number
  readonly repositoryUnsafePropagationShare: number
  readonly repositoryUnsafeSitesPerFunction: number
  readonly repositoryCappedUnsafeSiteShare: number
  readonly repositoryUnsafePressure: number
}

const computeRsLd01Output = async (
  project: RustProject,
  config: NormalizedRsLd01Config,
): Promise<RsLd01Output> => {
  const analysis = await collectUnsafeAnalysisFacts(project, config)
  const moduleBuild = buildUnsafeModules(project, analysis, config)
  const totals = summarizeRepositoryUnsafeTotals(
    moduleBuild.modules,
    analysis.unsafeSites,
    moduleBuild.functionCount,
  )

  return {
    modules: moduleBuild.modules,
    ...totals,
    unsafeSites: analysis.unsafeSites,
    safeOnlyViolations: safeOnlyViolations(moduleBuild.modules),
    sourceFileCount: project.sourceFiles.length,
    analyzedSourceFileCount: analysis.analyzedSourceFiles.length,
    functionCount: moduleBuild.functionCount,
    diagnosticLimit: config.top_n_diagnostics,
    propagationMode: "local-call-graph",
    scoreMode: RS_LD_01_SCORE_MODE,
    safeOnlySelectorMode: SAFE_ONLY_SELECTOR_MODE,
    diagnosticCapPolicy: DIAGNOSTIC_CAP_POLICY,
    sitePressureScoreCap: UNSAFE_SITE_PRESSURE_SCORE_CAP,
  }
}

const collectUnsafeAnalysisFacts = async (
  project: RustProject,
  config: NormalizedRsLd01Config,
): Promise<UnsafeAnalysisFacts> => {
  const facts = await collectRustProjectFacts(project)
  const analyzedSourceFiles = project.sourceFiles.filter(
    (file) => !isExcluded(file, config.exclude_globs),
  )
  const [callFacts, unsafeSites] = await Promise.all([
    collectFunctionCallFacts(project, analyzedSourceFiles),
    collectUnsafeSites(project, analyzedSourceFiles),
  ])
  return { facts, analyzedSourceFiles, callFacts, unsafeSites }
}

const buildUnsafeModules = (
  project: RustProject,
  analysis: UnsafeAnalysisFacts,
  config: NormalizedRsLd01Config,
): UnsafeModuleBuild => {
  const callFactsByKey = new Map(analysis.callFacts.map((fn) => [fn.key, fn]))
  const propagatingFunctionKeys = unsafePropagatingFunctionKeys(
    analysis.facts.functions,
    analysis.callFacts,
  )
  const functionModules = summarizeUnsafeFunctionModules(
    analysis.facts.functions,
    callFactsByKey,
    propagatingFunctionKeys,
    config.exclude_globs,
  )
  const grouped = withUnsafeSiteModules(
    functionModules.grouped,
    groupUnsafeSitesByModule(analysis.unsafeSites),
    project.worktreePath,
  )
  return {
    modules: finalizeUnsafeModules(grouped, config.safe_only_modules),
    functionCount: functionModules.functionCount,
  }
}

const summarizeUnsafeFunctionModules = (
  functions: ReadonlyArray<RustFunctionFact>,
  callFactsByKey: ReadonlyMap<string, FunctionCallFacts>,
  propagatingFunctionKeys: ReadonlySet<string>,
  excludeGlobs: ReadonlyArray<string>,
): { readonly grouped: ReadonlyMap<string, UnsafeModuleSummary>; readonly functionCount: number } => {
  const grouped = new Map<string, UnsafeModuleSummary>()
  let functionCount = 0
  for (const fn of functions) {
    if (isExcluded(fn.file, excludeGlobs)) continue
    const key = functionKey(fn.modulePath, fn.name)
    if (!callFactsByKey.has(key)) continue
    functionCount += 1
    grouped.set(
      fn.modulePath,
      addFunctionToUnsafeModule(
        grouped.get(fn.modulePath) ?? emptyUnsafeModuleSummary(fn.modulePath, fn.file),
        fn,
        propagatingFunctionKeys.has(key),
      ),
    )
  }
  return { grouped, functionCount }
}

const addFunctionToUnsafeModule = (
  module: UnsafeModuleSummary,
  fn: RustFunctionFact,
  propagatesUnsafe: boolean,
): UnsafeModuleSummary => ({
  ...module,
  totalFunctions: module.totalFunctions + 1,
  unsafeBlockCount: module.unsafeBlockCount + fn.unsafeBlockCount,
  unsafeFunctionCount: module.unsafeFunctionCount + (fn.isUnsafeFn ? 1 : 0),
  propagatingFunctionCount: module.propagatingFunctionCount + (propagatesUnsafe ? 1 : 0),
})

const withUnsafeSiteModules = (
  grouped: ReadonlyMap<string, UnsafeModuleSummary>,
  unsafeSitesByModule: ReadonlyMap<string, ReadonlyArray<UnsafeSite>>,
  fallbackFile: string,
): ReadonlyMap<string, UnsafeModuleSummary> => {
  const next = new Map(grouped)
  for (const [module, sites] of unsafeSitesByModule) {
    next.set(module, {
      ...(next.get(module) ?? emptyUnsafeModuleSummary(module, sites[0]?.file ?? fallbackFile)),
      unsafeSiteCount: sites.length,
      unsafeSiteKindCounts: countUnsafeSiteKinds(sites),
      sites,
    })
  }
  return next
}

const finalizeUnsafeModules = (
  grouped: ReadonlyMap<string, UnsafeModuleSummary>,
  safeOnlySelectors: ReadonlyArray<string>,
): ReadonlyArray<UnsafeModuleSummary> =>
  [...grouped.values()]
    .map((module) => unsafeModuleWithPressure(module))
    .map((module) => ({
      ...module,
      safeOnlyMatchedSelectors: matchedSafeOnlySelectors(module.module, safeOnlySelectors),
    }))
    .sort(compareUnsafeModules)

const compareUnsafeModules = (
  left: UnsafeModuleSummary,
  right: UnsafeModuleSummary,
): number =>
  right.unsafePressure - left.unsafePressure ||
  right.unsafePropagationShare - left.unsafePropagationShare ||
  right.unsafeSitesPerFunction - left.unsafeSitesPerFunction

const summarizeRepositoryUnsafeTotals = (
  modules: ReadonlyArray<UnsafeModuleSummary>,
  unsafeSites: ReadonlyArray<UnsafeSite>,
  functionCount: number,
): RepositoryUnsafeTotals => {
  const totalUnsafeSites = unsafeSites.length
  const totalPropagatingFunctions = modules.reduce(
    (sum, module) => sum + module.propagatingFunctionCount,
    0,
  )
  const repositoryUnsafeSitesPerFunction = unsafeSitePressure(totalUnsafeSites, functionCount)
  const repositoryCappedUnsafeSiteShare = cappedSiteShare(repositoryUnsafeSitesPerFunction)
  const repositoryUnsafePropagationShare = boundedShare(totalPropagatingFunctions, functionCount)
  return {
    totalUnsafeBlocks: modules.reduce((sum, module) => sum + module.unsafeBlockCount, 0),
    totalUnsafeFunctions: modules.reduce((sum, module) => sum + module.unsafeFunctionCount, 0),
    totalUnsafeSites,
    unsafeSiteKindCounts: countUnsafeSiteKinds(unsafeSites),
    totalPropagatingFunctions,
    repositoryUnsafePropagationShare,
    repositoryUnsafeSitesPerFunction,
    repositoryCappedUnsafeSiteShare,
    repositoryUnsafePressure: Math.max(repositoryUnsafePropagationShare, repositoryCappedUnsafeSiteShare),
  }
}

const safeOnlyViolations = (
  modules: ReadonlyArray<UnsafeModuleSummary>,
): ReadonlyArray<UnsafeModuleSummary> =>
  modules.filter(
    (module) =>
      module.safeOnlyMatchedSelectors.length > 0 &&
      (module.unsafeSiteCount > 0 || module.propagatingFunctionCount > 0),
  )

const makeRsLd01FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-LD-01-unsafe-code", RS_LD_01_FACTOR_DEFINITIONS)

const emptyUnsafeModuleSummary = (module: string, file: string): UnsafeModuleSummary => ({
  module,
  file,
  totalFunctions: 0,
  safeOnlyMatchedSelectors: [],
  unsafeSiteCount: 0,
  unsafeSiteKindCounts: {},
  sites: [],
  unsafeBlockCount: 0,
  unsafeFunctionCount: 0,
  propagatingFunctionCount: 0,
  unsafePropagationShare: 0,
  unsafeSitesPerFunction: 0,
  cappedUnsafeSiteShare: 0,
  unsafePressure: 0,
})

const unsafeModuleWithPressure = (module: UnsafeModuleSummary): UnsafeModuleSummary => {
  const unsafePropagationShare = boundedShare(module.propagatingFunctionCount, module.totalFunctions)
  const unsafeSitesPerFunction = unsafeSitePressure(module.unsafeSiteCount, module.totalFunctions)
  const cappedUnsafeSiteShare = cappedSiteShare(unsafeSitesPerFunction)
  return {
    ...module,
    unsafePropagationShare,
    unsafeSitesPerFunction,
    cappedUnsafeSiteShare,
    unsafePressure: Math.max(unsafePropagationShare, cappedUnsafeSiteShare),
  }
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator

const unsafeSitePressure = (unsafeSiteCount: number, functionCount: number): number =>
  functionCount === 0 ? unsafeSiteCount : unsafeSiteCount / functionCount

const boundedShare = (numerator: number, denominator: number): number =>
  Math.max(0, Math.min(1, ratio(numerator, denominator)))

const cappedSiteShare = (unsafeSitesPerFunction: number): number =>
  Math.max(
    0,
    Math.min(1, unsafeSitesPerFunction / UNSAFE_SITE_PRESSURE_SCORE_CAP),
  )

const unsafeSitePressureText = (module: UnsafeModuleSummary): string =>
  module.totalFunctions === 0
    ? `${module.unsafeSiteCount} unsafe site${module.unsafeSiteCount === 1 ? "" : "s"} and no functions`
    : `${module.unsafeSitesPerFunction.toFixed(2)} unsafe sites/function`

const siteDiagnosticSample = (sites: ReadonlyArray<UnsafeSite>): ReadonlyArray<UnsafeSite> =>
  sites.slice(0, 10)

const groupUnsafeSitesByModule = (
  sites: ReadonlyArray<UnsafeSite>,
): ReadonlyMap<string, ReadonlyArray<UnsafeSite>> => {
  const grouped = new Map<string, Array<UnsafeSite>>()
  for (const site of sites) {
    grouped.set(site.module, [...(grouped.get(site.module) ?? []), site])
  }
  return grouped
}

const countUnsafeSiteKinds = (
  sites: ReadonlyArray<UnsafeSite>,
): Partial<Record<UnsafeSiteKind, number>> => {
  const counts: Partial<Record<UnsafeSiteKind, number>> = {}
  for (const site of sites) {
    counts[site.kind] = (counts[site.kind] ?? 0) + 1
  }
  return counts
}

const matchedSafeOnlySelectors = (
  module: string,
  selectors: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  selectors
    .filter((selector) => module === selector || module.startsWith(`${selector}::`))
    .sort()
