import {
  makeFactorEntry,
  makeFactorLedger,
  type SignalFactorLedger,
} from "@skastr0/pulsar-core/factors"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { collectRustProjectFacts } from "../rust-analysis.js"
import { type RustProject, RustProjectTag } from "../project.js"
import { parseRustFile, type RustSyntaxNode } from "../syn-walker.js"
import {
  DEFAULT_RUST_EXCLUDE_GLOBS,
  firstNamedChild,
  modulePathForAncestors,
  namedChildrenOf,
  resolveRustFileScope,
  walkAttributedNodes,
} from "./shared-rust-ast.js"
import { isExcluded } from "./shared-globs.js"

const RsLd01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  safe_only_modules: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsLd01Config = typeof RsLd01Config.Type

type UnsafeSiteKind =
  | "unsafe_block"
  | "unsafe_function"
  | "unsafe_function_signature"
  | "unsafe_trait"
  | "unsafe_impl"
  | "foreign_function"
  | "static_mut"

interface UnsafeSite {
  readonly kind: UnsafeSiteKind
  readonly module: string
  readonly file: string
  readonly line: number
  readonly name: string | undefined
  readonly functionName: string | undefined
}

interface UnsafeModuleSummary {
  readonly module: string
  readonly file: string
  readonly totalFunctions: number
  readonly safeOnlyMatchedSelectors: ReadonlyArray<string>
  readonly unsafeSiteCount: number
  readonly unsafeSiteKindCounts: Partial<Record<UnsafeSiteKind, number>>
  readonly sites: ReadonlyArray<UnsafeSite>
  readonly unsafeBlockCount: number
  readonly unsafeFunctionCount: number
  readonly propagatingFunctionCount: number
  readonly unsafePropagationShare: number
  readonly unsafeSitesPerFunction: number
  readonly cappedUnsafeSiteShare: number
  readonly unsafePressure: number
}

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

interface FunctionCallFacts {
  readonly key: string
  readonly module: string
  readonly name: string
  readonly calleeNames: ReadonlyArray<string>
}

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const UNSAFE_SITE_PRESSURE_SCORE_CAP = 1
const RS_LD_01_SCORE_MODE = "one-minus-max-propagation-share-or-capped-site-share" as const
const SAFE_ONLY_SELECTOR_MODE = "module-subtree" as const
const DIAGNOSTIC_CAP_POLICY = "safe-only-blocks-uncapped-warnings-capped" as const

const RsLd01FactorDefinitions: ReadonlyArray<SignalFactorDefinition> = [
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
  cacheVersion: "unsafe-code-config-applicability-diagnostics-call-graph-density-sites-safe-only-v5",
  configSchema: RsLd01Config,
  factorDefinitions: RsLd01FactorDefinitions,
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
        try: async (): Promise<RsLd01Output> => {
          const facts = await collectRustProjectFacts(project)
          const grouped = new Map<string, UnsafeModuleSummary>()
          const analyzedSourceFiles = project.sourceFiles.filter(
            (file) => !isExcluded(file, normalizedConfig.exclude_globs),
          )
          const callFacts = await collectFunctionCallFacts(project, analyzedSourceFiles)
          const callFactsByKey = new Map(callFacts.map((fn) => [fn.key, fn]))
          const propagatingFunctionKeys = unsafePropagatingFunctionKeys(facts.functions, callFacts)
          const unsafeSites = await collectUnsafeSites(project, analyzedSourceFiles)
          const unsafeSitesByModule = groupUnsafeSitesByModule(unsafeSites)
          let functionCount = 0

          for (const fn of facts.functions) {
            if (isExcluded(fn.file, normalizedConfig.exclude_globs)) continue
            const key = functionKey(fn.modulePath, fn.name)
            if (!callFactsByKey.has(key)) continue
            functionCount += 1
            const current = grouped.get(fn.modulePath)
            const next =
              current === undefined
                ? {
                    module: fn.modulePath,
                    file: fn.file,
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
                  }
                : { ...current }

            next.totalFunctions += 1
            next.unsafeBlockCount += fn.unsafeBlockCount
            if (fn.isUnsafeFn) next.unsafeFunctionCount += 1
            if (propagatingFunctionKeys.has(key)) next.propagatingFunctionCount += 1
            grouped.set(fn.modulePath, next)
          }

          for (const [module, sites] of unsafeSitesByModule) {
            const current = grouped.get(module)
            grouped.set(module, {
              ...(current ?? emptyUnsafeModuleSummary(module, sites[0]?.file ?? project.worktreePath)),
              unsafeSiteCount: sites.length,
              unsafeSiteKindCounts: countUnsafeSiteKinds(sites),
              sites,
            })
          }

          const modules = [...grouped.values()]
            .map((module) => unsafeModuleWithPressure(module))
            .map((module) => ({
              ...module,
              safeOnlyMatchedSelectors: matchedSafeOnlySelectors(
                module.module,
                normalizedConfig.safe_only_modules,
              ),
            }))
            .sort(
              (a, b) =>
                b.unsafePressure - a.unsafePressure ||
                b.unsafePropagationShare - a.unsafePropagationShare ||
                b.unsafeSitesPerFunction - a.unsafeSitesPerFunction,
            )
          const totalUnsafeBlocks = modules.reduce((sum, module) => sum + module.unsafeBlockCount, 0)
          const totalUnsafeFunctions = modules.reduce((sum, module) => sum + module.unsafeFunctionCount, 0)
          const totalUnsafeSites = unsafeSites.length
          const unsafeSiteKindCounts = countUnsafeSiteKinds(unsafeSites)
          const totalPropagatingFunctions = modules.reduce(
            (sum, module) => sum + module.propagatingFunctionCount,
            0,
          )
          const repositoryUnsafePropagationShare = boundedShare(
            totalPropagatingFunctions,
            functionCount,
          )
          const repositoryUnsafeSitesPerFunction = unsafeSitePressure(totalUnsafeSites, functionCount)
          const repositoryCappedUnsafeSiteShare = cappedSiteShare(
            repositoryUnsafeSitesPerFunction,
          )
          const repositoryUnsafePressure = Math.max(
            repositoryUnsafePropagationShare,
            repositoryCappedUnsafeSiteShare,
          )

          return {
            modules,
            totalUnsafeBlocks,
            totalUnsafeFunctions,
            totalUnsafeSites,
            unsafeSites,
            unsafeSiteKindCounts,
            totalPropagatingFunctions,
            repositoryUnsafePropagationShare,
            repositoryUnsafeSitesPerFunction,
            repositoryCappedUnsafeSiteShare,
            repositoryUnsafePressure,
            safeOnlyViolations: modules.filter(
              (module) =>
                module.safeOnlyMatchedSelectors.length > 0 &&
                (module.unsafeSiteCount > 0 || module.propagatingFunctionCount > 0),
            ),
            sourceFileCount: project.sourceFiles.length,
            analyzedSourceFileCount: analyzedSourceFiles.length,
            functionCount,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            propagationMode: "local-call-graph",
            scoreMode: RS_LD_01_SCORE_MODE,
            safeOnlySelectorMode: SAFE_ONLY_SELECTOR_MODE,
            diagnosticCapPolicy: DIAGNOSTIC_CAP_POLICY,
            sitePressureScoreCap: UNSAFE_SITE_PRESSURE_SCORE_CAP,
          }
        },
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

const makeRsLd01FactorLedger = (): SignalFactorLedger =>
  makeFactorLedger(
    "RS-LD-01-unsafe-code",
    RsLd01FactorDefinitions.map((definition) =>
      makeFactorEntry(definition, definition.defaultValue ?? null, {
        source: "signal-default",
      }),
    ),
  )

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

const collectUnsafeSites = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlyArray<UnsafeSite>> => {
  const sites: Array<UnsafeSite> = []
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated) return
      const site = unsafeSiteFromNode(file, scope, node, ancestors)
      if (site !== undefined) sites.push(site)
    })
  }
  return sites.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.kind.localeCompare(right.kind) ||
      (left.name ?? "").localeCompare(right.name ?? ""),
  )
}

const unsafeSiteFromNode = (
  file: string,
  scope: ReturnType<typeof resolveRustFileScope>,
  node: RustSyntaxNode,
  ancestors: ReadonlyArray<RustSyntaxNode>,
): UnsafeSite | undefined => {
  const kind = unsafeSiteKind(node, ancestors)
  if (kind === undefined) return undefined
  const { modulePath } = modulePathForAncestors(scope, ancestors)
  const name = unsafeSiteName(node, kind)
  return {
    kind,
    module: modulePath,
    file,
    line: node.startPosition.row + 1,
    name,
    functionName: kind === "unsafe_block" ? nearestFunctionName(ancestors) : name,
  }
}

const unsafeSiteKind = (
  node: RustSyntaxNode,
  ancestors: ReadonlyArray<RustSyntaxNode>,
): UnsafeSiteKind | undefined => {
  if (node.type === "unsafe_block") return "unsafe_block"
  if (node.type === "function_item" && hasUnsafeFunctionModifier(node)) return "unsafe_function"
  if (node.type === "function_signature_item" && hasAncestor(ancestors, "foreign_mod_item")) {
    return "foreign_function"
  }
  if (node.type === "function_signature_item" && hasUnsafeFunctionModifier(node)) {
    return "unsafe_function_signature"
  }
  if (node.type === "trait_item" && /\bunsafe\s+trait\b/.test(node.text)) return "unsafe_trait"
  if (node.type === "impl_item" && /^\s*unsafe\s+impl\b/.test(node.text)) return "unsafe_impl"
  if (node.type === "static_item" && firstNamedChild(node, "mutable_specifier") !== undefined) {
    return "static_mut"
  }
  return undefined
}

const unsafeSiteName = (node: RustSyntaxNode, kind: UnsafeSiteKind): string | undefined => {
  if (kind === "unsafe_impl") return node.text.split("{")[0]?.trim()
  return (
    firstNamedChild(node, "identifier")?.text ??
    firstNamedChild(node, "type_identifier")?.text
  )
}

const hasUnsafeFunctionModifier = (node: RustSyntaxNode): boolean =>
  (firstNamedChild(node, "function_modifiers")?.text ?? "").includes("unsafe")

const hasAncestor = (ancestors: ReadonlyArray<RustSyntaxNode>, type: string): boolean =>
  ancestors.some((ancestor) => ancestor.type === type)

const nearestFunctionName = (ancestors: ReadonlyArray<RustSyntaxNode>): string | undefined => {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]!
    if (ancestor.type === "function_item" || ancestor.type === "function_signature_item") {
      return firstNamedChild(ancestor, "identifier")?.text
    }
  }
  return undefined
}

const collectFunctionCallFacts = async (
  project: RustProject,
  analyzedSourceFiles: ReadonlyArray<string>,
): Promise<ReadonlyArray<FunctionCallFacts>> => {
  const facts: Array<FunctionCallFacts> = []
  for (const file of analyzedSourceFiles) {
    const scope = resolveRustFileScope(project, file)
    const tree = await parseRustFile(file)
    walkAttributedNodes(tree.rootNode, ({ node, ancestors, testGated }) => {
      if (testGated || node.type !== "function_item") return
      const name = firstNamedChild(node, "identifier")?.text
      if (name === undefined) return
      const { modulePath } = modulePathForAncestors(scope, ancestors)
      facts.push({
        key: functionKey(modulePath, name),
        module: modulePath,
        name,
        calleeNames: collectCalledFunctionNames(node),
      })
    })
  }
  return facts
}

const unsafePropagatingFunctionKeys = (
  functions: ReadonlyArray<{
    readonly modulePath: string
    readonly name: string
    readonly isUnsafeFn: boolean
    readonly unsafeBlockCount: number
  }>,
  callFacts: ReadonlyArray<FunctionCallFacts>,
): ReadonlySet<string> => {
  const knownKeys = new Set(callFacts.map((fn) => fn.key))
  const keysByName = new Map<string, Array<string>>()
  for (const fn of callFacts) {
    keysByName.set(fn.name, [...(keysByName.get(fn.name) ?? []), fn.key])
  }

  const propagating = new Set(
    functions
      .filter((fn) => fn.isUnsafeFn || fn.unsafeBlockCount > 0)
      .map((fn) => functionKey(fn.modulePath, fn.name))
      .filter((key) => knownKeys.has(key)),
  )

  let changed = true
  while (changed) {
    changed = false
    for (const fn of callFacts) {
      if (propagating.has(fn.key)) continue
      const callees = fn.calleeNames.flatMap((name) =>
        resolveCalleeKeys(fn.module, name, knownKeys, keysByName),
      )
      if (callees.some((key) => propagating.has(key))) {
        propagating.add(fn.key)
        changed = true
      }
    }
  }
  return propagating
}

const resolveCalleeKeys = (
  callerModule: string,
  calleeName: string,
  knownKeys: ReadonlySet<string>,
  keysByName: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<string> => {
  const localKey = functionKey(callerModule, calleeName)
  if (knownKeys.has(localKey)) return [localKey]
  const candidates = keysByName.get(calleeName) ?? []
  return candidates.length === 1 ? candidates : []
}

const collectCalledFunctionNames = (node: RustSyntaxNode): ReadonlyArray<string> => {
  const names = new Set<string>()
  const walk = (current: RustSyntaxNode): void => {
    if (current.type === "call_expression") {
      const callee = namedChildrenOf(current)[0]
      const name = calleeName(callee)
      if (name !== undefined) names.add(name)
    }
    for (const child of namedChildrenOf(current)) walk(child)
  }
  walk(node)
  return [...names].sort()
}

const calleeName = (node: RustSyntaxNode | undefined): string | undefined => {
  if (node === undefined) return undefined
  if (node.type === "identifier") return node.text
  if (node.type === "generic_function") return calleeName(namedChildrenOf(node)[0])
  if (node.type === "scoped_identifier") {
    const identifiers = namedChildrenOf(node).filter((child) => child.type === "identifier")
    return identifiers[identifiers.length - 1]?.text
  }
  return undefined
}

const functionKey = (module: string, name: string): string => `${module}::${name}`
