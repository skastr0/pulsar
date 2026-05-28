import { collectRustProjectFacts, type RustUseFact } from "../rust-analysis.js"
import type { RustProject } from "../project.js"
import {
  resolveCrateRelativePath,
  toLocalRelativeSegments,
} from "./shared-rust-resolution.js"
import { isExcluded } from "./shared-globs.js"

export interface RustModuleFan {
  readonly module: string
  readonly file: string
  readonly fanIn: number
  readonly fanOut: number
  readonly hubPressure: number
}

export interface RsDe04Output {
  readonly modules: ReadonlyArray<RustModuleFan>
  readonly byModule: ReadonlyMap<string, { readonly fanIn: number; readonly fanOut: number }>
  readonly hubs: ReadonlyArray<RustModuleFan>
  readonly moduleCount: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly useCount: number
  readonly resolvedUseCount: number
  readonly hubCount: number
  readonly totalHubPressure: number
  readonly hubFanInThreshold: number
  readonly hubFanOutThreshold: number
  readonly diagnosticLimit: number
  readonly analysisMode: "explicit-use-resolution"
}

interface RsDe04AnalysisConfig {
  readonly exclude_globs: ReadonlyArray<string>
  readonly hub_fan_in_threshold: number
  readonly hub_fan_out_threshold: number
  readonly top_n_diagnostics: number
}

type RustProjectFacts = Awaited<ReturnType<typeof collectRustProjectFacts>>

interface ModuleFanGraph {
  readonly incoming: ReadonlyMap<string, ReadonlySet<string>>
  readonly outgoing: ReadonlyMap<string, ReadonlySet<string>>
  readonly useCount: number
  readonly resolvedUseCount: number
}

export const computeRsDe04Output = async (
  project: RustProject,
  config: RsDe04AnalysisConfig,
): Promise<RsDe04Output> => {
  const facts = await collectRustProjectFacts(project)
  const modules = facts.modules.filter((module) => !isExcluded(module.file, config.exclude_globs))
  const analyzedFiles = project.sourceFiles.filter((file) => !isExcluded(file, config.exclude_globs))
  const graph = buildModuleFanGraph(facts, modules, collectRootNamesByCrate(facts), config)
  const summaries = summarizeModuleFan(modules, graph, config)
  const hubs = summaries.filter((module) => isCouplingHub(module, config))
  const totalHubPressure = hubs.reduce((sum, module) => sum + module.hubPressure, 0)

  return {
    modules: summaries,
    byModule: new Map(
      summaries.map((module) => [module.module, { fanIn: module.fanIn, fanOut: module.fanOut }]),
    ),
    hubs,
    moduleCount: summaries.length,
    sourceFileCount: project.sourceFiles.length,
    analyzedSourceFileCount: analyzedFiles.length,
    useCount: graph.useCount,
    resolvedUseCount: graph.resolvedUseCount,
    hubCount: hubs.length,
    totalHubPressure,
    hubFanInThreshold: config.hub_fan_in_threshold,
    hubFanOutThreshold: config.hub_fan_out_threshold,
    diagnosticLimit: config.top_n_diagnostics,
    analysisMode: "explicit-use-resolution",
  }
}

const collectRootNamesByCrate = (facts: RustProjectFacts): ReadonlyMap<string, ReadonlySet<string>> => {
  const rootNamesByCrate = new Map<string, Set<string>>()
  for (const module of facts.modules) addModuleRootName(rootNamesByCrate, module)
  for (const item of facts.items) {
    if (item.relativeModulePath === "crate") addCrateRootName(rootNamesByCrate, item.crateName, item.name)
  }
  return rootNamesByCrate
}

const addModuleRootName = (
  rootNamesByCrate: Map<string, Set<string>>,
  module: RustProjectFacts["modules"][number],
): void => {
  const [scope, root] = module.relativeModulePath.split("::")
  if (scope === "crate" && root !== undefined) addCrateRootName(rootNamesByCrate, module.crateName, root)
}

const addCrateRootName = (
  rootNamesByCrate: Map<string, Set<string>>,
  crateName: string,
  name: string,
): void => {
  const bucket = rootNamesByCrate.get(crateName) ?? new Set<string>()
  bucket.add(name)
  rootNamesByCrate.set(crateName, bucket)
}

const buildModuleFanGraph = (
  facts: RustProjectFacts,
  modules: ReadonlyArray<RustProjectFacts["modules"][number]>,
  rootNamesByCrate: ReadonlyMap<string, ReadonlySet<string>>,
  config: RsDe04AnalysisConfig,
): ModuleFanGraph => {
  const incoming = new Map(modules.map((module) => [module.modulePath, new Set<string>()] as const))
  const outgoing = new Map(modules.map((module) => [module.modulePath, new Set<string>()] as const))
  const analyzedModulePaths = new Set(modules.map((module) => module.modulePath))
  const resolvedEdges = new Set<string>()
  let useCount = 0

  for (const useFact of facts.uses) {
    if (isExcluded(useFact.file, config.exclude_globs)) continue
    useCount += 1
    const target = resolveLocalUseTarget(useFact, facts, rootNamesByCrate)
    if (!isResolvedLocalEdge(useFact.modulePath, target, analyzedModulePaths)) continue
    outgoing.get(useFact.modulePath)?.add(target)
    incoming.get(target)?.add(useFact.modulePath)
    resolvedEdges.add(`${useFact.modulePath}->${target}`)
  }
  return { incoming, outgoing, useCount, resolvedUseCount: resolvedEdges.size }
}

const isResolvedLocalEdge = (
  source: string,
  target: string | undefined,
  analyzedModulePaths: ReadonlySet<string>,
): target is string =>
  target !== undefined &&
  target !== source &&
  analyzedModulePaths.has(source) &&
  analyzedModulePaths.has(target)

const summarizeModuleFan = (
  modules: ReadonlyArray<RustProjectFacts["modules"][number]>,
  graph: ModuleFanGraph,
  config: RsDe04AnalysisConfig,
): ReadonlyArray<RustModuleFan> =>
  modules
    .map((module) => {
      const fanIn = graph.incoming.get(module.modulePath)?.size ?? 0
      const fanOut = graph.outgoing.get(module.modulePath)?.size ?? 0
      return {
        module: module.modulePath,
        file: module.file,
        fanIn,
        fanOut,
        hubPressure: hubPressure(fanIn, fanOut, config),
      }
    })
    .sort(compareModuleFan)

const isCouplingHub = (
  module: RustModuleFan,
  config: RsDe04AnalysisConfig,
): boolean =>
  module.fanIn >= config.hub_fan_in_threshold &&
  module.fanOut >= config.hub_fan_out_threshold

const hubPressure = (
  fanIn: number,
  fanOut: number,
  config: RsDe04AnalysisConfig,
): number => {
  if (
    fanIn < config.hub_fan_in_threshold ||
    fanOut < config.hub_fan_out_threshold
  ) {
    return 0
  }
  return (
    Math.max(0, fanIn - config.hub_fan_in_threshold + 1) +
    Math.max(0, fanOut - config.hub_fan_out_threshold + 1)
  )
}

const compareModuleFan = (left: RustModuleFan, right: RustModuleFan): number =>
  right.hubPressure - left.hubPressure ||
  right.fanIn + right.fanOut - (left.fanIn + left.fanOut) ||
  right.fanIn - left.fanIn ||
  right.fanOut - left.fanOut ||
  left.module.localeCompare(right.module)

const resolveLocalUseTarget = (
  useFact: RustUseFact,
  facts: RustProjectFacts,
  rootNamesByCrate: ReadonlyMap<string, ReadonlySet<string>>,
): string | undefined => {
  const relativeSegments = toLocalRelativeSegments(
    useFact,
    rootNamesByCrate.get(useFact.crateName) ?? new Set(),
  )
  if (relativeSegments === undefined) return undefined
  const resolved = resolveCrateRelativePath(useFact.crateName, relativeSegments, facts)
  return resolved?.item?.modulePath ?? resolved?.module?.modulePath
}
