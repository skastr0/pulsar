import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import {
  type Diagnostic,
  scoreThresholdViolationShare,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import {
  collectRustProjectFacts,
  isExternallyVisible,
  type RustAnalysis,
  type RustItemFact,
} from "../rust-analysis.js"
import { RustProjectTag, type RustManifestInfo, type RustProject } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import {
  buildCrateIdentifierIndex,
  type CrateReferenceIndex,
  resolveCrateImportTarget,
} from "./rs-ad-02-crate-analysis.js"
import {
  resolveCrateRelativePath,
  toLocalRelativeSegments,
} from "./shared-rust-resolution.js"
import { isExcluded } from "./shared-globs.js"

const RsAb01Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
type RsAb01Config = typeof RsAb01Config.Type

interface UnusedPublicItem {
  readonly crate: string
  readonly module: string
  readonly name: string
  readonly kind: string
  readonly file: string
  readonly line: number
  readonly reexported: boolean
  readonly crossCrateUses: number
  readonly surface: "exported-api" | "internal-overpublic" | "non-library"
}

interface RsAb01Output {
  readonly deadPublicItems: ReadonlyArray<UnusedPublicItem>
  readonly exportedApiItems: ReadonlyArray<UnusedPublicItem>
  readonly nonLibraryPublicItems: ReadonlyArray<UnusedPublicItem>
  readonly publicItemCount: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly cargoMetadataStatus: "loaded" | "missing"
  readonly workspaceCrateCount: number
  readonly libraryCrateCount: number
  readonly referenceScope: "cross-crate" | "single-crate-library"
  readonly diagnosticLimit: number
  readonly analysisMode: "explicit-use-and-reexport-resolution"
}

const DEFAULT_TOP_N_DIAGNOSTICS = 20

/**
 * Confidence reported for single-crate library workspaces. The signal's claim
 * is cross-crate unusedness; with a single workspace crate no item can ever be
 * referenced from another workspace crate, so the claim is structurally
 * unverifiable inside the repository. The lib crate's pub surface is treated
 * as intentional published API and the signal downgrades to a not-applicable
 * inventory at reduced confidence instead of warning at full confidence.
 */
const SINGLE_CRATE_LIBRARY_BASE_CONFIDENCE = 0.25

const RS_AB_01_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsAb01: Signal<RsAb01Config, RsAb01Output, RustProjectTag> = {
  id: "RS-AB-01-unused-public-items",
  title: "Unused public items",
  aliases: ["RS-AB-01"],
  tier: 1,
  category: "abstraction-bloat",
  kind: "structural",
  cacheVersion: "rs-ab-01-public-surface-use-segments-aliases-diagnostics-reexports-private-visibility-chain-metadata-applicability-single-crate-scope-v11",
  configSchema: RsAb01Config,
  factorDefinitions: RS_AB_01_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsAb01Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: () => computeUnusedPublicItems(project, normalizedConfig),
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AB-01-unused-public-items", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.referenceScope === "single-crate-library") return 1
    return scoreThresholdViolationShare(out.publicItemCount, out.deadPublicItems.length)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.sourceFileCount === 0) {
      return [{
        severity: "warn" as const,
        message: "RS-AB-01 found no Rust source files for public item analysis",
        data: {
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          publicItemCount: out.publicItemCount,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    if (out.cargoMetadataStatus === "missing" && out.publicItemCount > 0) {
      return [{
        severity: "warn" as const,
        message: "RS-AB-01 could not load cargo metadata for public item surface analysis",
        data: {
          cargoMetadataStatus: out.cargoMetadataStatus,
          publicItemCount: out.publicItemCount,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    if (out.referenceScope === "single-crate-library") {
      if (out.publicItemCount === 0) return []
      return [{
        severity: "info" as const,
        message:
          "RS-AB-01 cross-crate usage cannot be observed in a single-crate workspace; " +
          "the library's pub surface is treated as intentional published API",
        data: {
          referenceScope: out.referenceScope,
          workspaceCrateCount: out.workspaceCrateCount,
          libraryCrateCount: out.libraryCrateCount,
          publicItemCount: out.publicItemCount,
          internalOverpublicCount: out.deadPublicItems.length,
          claimLimit:
            "no other workspace crate exists that could reference these items, so unused-pub pressure is not scored",
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.deadPublicItems.slice(0, out.diagnosticLimit).map((item) => ({
      severity: "warn" as const,
      message: `Public ${item.kind} ${item.name} is not referenced from other workspace crates`,
      location: { file: item.file, line: item.line },
      data: {
        hash: hashUnusedPublicItem(item),
        crate: item.crate,
        module: item.module,
        name: item.name,
        kind: item.kind,
        surface: item.surface,
        reexported: item.reexported,
        crossCrateUses: item.crossCrateUses,
        referenceScope: out.referenceScope,
        analysisMode: out.analysisMode,
      },
    }))
  },
  outputMetadata: (out) => {
    if (out.sourceFileCount === 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.cargoMetadataStatus === "missing" && out.publicItemCount > 0) {
      return { applicability: "insufficient_evidence" as const }
    }
    if (out.analyzedSourceFileCount === 0 || out.publicItemCount === 0) {
      return { applicability: "not_applicable" as const }
    }
    if (out.referenceScope === "single-crate-library") {
      return {
        applicability: "not_applicable" as const,
        baseConfidence: SINGLE_CRATE_LIBRARY_BASE_CONFIDENCE,
      }
    }
    return undefined
  },
  factorLedger: () => makeRsAb01FactorLedger(),
}

type NormalizedRsAb01Config = RsAb01Config

const normalizeRsAb01Config = (config: RsAb01Config): NormalizedRsAb01Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsAb01FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-AB-01-unused-public-items", RS_AB_01_FACTOR_DEFINITIONS)

const computeUnusedPublicItems = async (
  project: RustProject,
  config: NormalizedRsAb01Config,
): Promise<RsAb01Output> => {
  const facts = await collectRustProjectFacts(project)
  const analyzedSourceFiles = project.sourceFiles.filter(
    (file) => !isExcluded(file, config.exclude_globs),
  )
  const workspaceCrates = collectWorkspaceCrates(project)
  const libraryCrates = collectLibraryCrates(project, workspaceCrates)
  const crateIndex = buildCrateIdentifierIndex(project.manifests, project.cargoMetadata)
  const rootNamesByCrate = collectRootNamesByCrate(facts)
  const exportedRootModules = collectExportedRootModules(facts)
  const publicItems = collectPublicItems(facts, config)
  const publicItemKeys = new Set(publicItems.map(publicItemKey))
  const usage = collectPublicUsage({
    facts,
    publicItemKeys,
    rootNamesByCrate,
    manifests: project.manifests,
    crateIndex,
    excludeGlobs: config.exclude_globs,
  })
  const publicSummaries = summarizePublicItems({
    facts,
    publicItems,
    usage,
    libraryCrates,
    exportedRootModules,
  })

  return {
    deadPublicItems: sortByLocation(
      publicSummaries.filter(
        (item) =>
          item.surface === "internal-overpublic" &&
          item.crossCrateUses === 0 &&
          !item.reexported,
      ),
    ),
    exportedApiItems: sortByLocation(
      publicSummaries.filter((item) => item.surface === "exported-api"),
    ),
    nonLibraryPublicItems: sortByLocation(
      publicSummaries.filter((item) => item.surface === "non-library"),
    ),
    publicItemCount: publicItems.length,
    sourceFileCount: project.sourceFiles.length,
    analyzedSourceFileCount: analyzedSourceFiles.length,
    cargoMetadataStatus: project.cargoMetadata === undefined ? "missing" : "loaded",
    workspaceCrateCount: workspaceCrates.size,
    libraryCrateCount: libraryCrates.size,
    referenceScope: workspaceCrates.size <= 1 && libraryCrates.size > 0
      ? ("single-crate-library" as const)
      : ("cross-crate" as const),
    diagnosticLimit: config.top_n_diagnostics,
    analysisMode: "explicit-use-and-reexport-resolution",
  }
}

const collectWorkspaceCrates = (project: RustProject): ReadonlySet<string> =>
  new Set(
    project.manifests
      .map((manifest) => manifest.packageName)
      .filter((name): name is string => name !== undefined),
  )

const collectLibraryCrates = (
  project: RustProject,
  workspaceCrates: ReadonlySet<string>,
): ReadonlySet<string> =>
  new Set(
    project.cargoMetadata?.packages
      .filter((pkg) => workspaceCrates.has(pkg.name))
      .filter((pkg) => pkg.targets.some((target) => target.kind.includes("lib")))
      .map((pkg) => pkg.name) ?? [],
  )

const collectRootNamesByCrate = (facts: RustAnalysis): ReadonlyMap<string, ReadonlySet<string>> => {
  const rootNamesByCrate = new Map<string, Set<string>>()
  for (const module of facts.modules) {
    const segments = module.relativeModulePath.split("::")
    addRootName(rootNamesByCrate, module.crateName, segments[0], segments[1])
  }
  for (const item of facts.items) {
    if (item.relativeModulePath === "crate") {
      addRootName(rootNamesByCrate, item.crateName, "crate", item.name)
    }
  }
  return rootNamesByCrate
}

const addRootName = (
  roots: Map<string, Set<string>>,
  crateName: string,
  prefix: string | undefined,
  root: string | undefined,
): void => {
  if (prefix !== "crate" || root === undefined) return
  const bucket = roots.get(crateName) ?? new Set<string>()
  bucket.add(root)
  roots.set(crateName, bucket)
}

const collectExportedRootModules = (facts: RustAnalysis): ReadonlyMap<string, ReadonlySet<string>> => {
  const exportedRootModules = new Map<string, Set<string>>()
  for (const item of facts.items) {
    if (item.kind !== "mod" || item.relativeModulePath !== "crate" || item.visibility.kind !== "pub") {
      continue
    }
    const bucket = exportedRootModules.get(item.crateName) ?? new Set<string>()
    bucket.add(item.name)
    exportedRootModules.set(item.crateName, bucket)
  }
  return exportedRootModules
}

const collectPublicItems = (
  facts: RustAnalysis,
  config: RsAb01Config,
): ReadonlyArray<RustItemFact> =>
  facts.items.filter(
    (item) => item.visibility.kind === "pub" && !isExcluded(item.file, config.exclude_globs),
  )

interface PublicUsage {
  readonly crossCrateUses: ReadonlyMap<string, number>
  readonly reexports: ReadonlySet<string>
}

const collectPublicUsage = (input: {
  readonly facts: RustAnalysis
  readonly publicItemKeys: ReadonlySet<string>
  readonly rootNamesByCrate: ReadonlyMap<string, ReadonlySet<string>>
  readonly manifests: ReadonlyArray<RustManifestInfo>
  readonly crateIndex: CrateReferenceIndex
  readonly excludeGlobs: ReadonlyArray<string>
}): PublicUsage => {
  const crossCrateUses = new Map<string, number>()
  const reexports = new Set<string>()

  for (const useFact of input.facts.uses) {
    if (isExcluded(useFact.file, input.excludeGlobs)) continue
    const targetCrate = resolveCrateImportTarget(useFact, input.manifests, input.crateIndex)
    if (targetCrate !== undefined) {
      recordCrossCrateUse(
        input.facts,
        input.publicItemKeys,
        crossCrateUses,
        targetCrate.packageName ?? targetCrate.name,
        useFact.segments.slice(1),
      )
      continue
    }
    if (useFact.visibility.kind !== "pub") continue
    if (!isModulePathExternallyReachable(input.facts, useFact.crateName, useFact.relativeModulePath)) {
      continue
    }
    const relativeSegments = toLocalRelativeSegments(
      useFact,
      input.rootNamesByCrate.get(useFact.crateName) ?? new Set(),
    )
    if (relativeSegments === undefined) continue
    recordLocalReexport(input.facts, input.publicItemKeys, reexports, useFact.crateName, relativeSegments)
  }

  return { crossCrateUses, reexports }
}

const recordLocalReexport = (
  facts: RustAnalysis,
  publicItemKeys: ReadonlySet<string>,
  reexports: Set<string>,
  crateName: string,
  relativeSegments: ReadonlyArray<string>,
): void => {
  const resolved = resolveCrateRelativePath(crateName, relativeSegments, facts)
  if (resolved === undefined) return
  if (resolved.item !== undefined) {
    const key = publicItemKey(resolved.item)
    if (publicItemKeys.has(key)) reexports.add(key)
    return
  }
  const moduleKey = resolved.module?.modulePath ?? resolved.key
  if (moduleKey === undefined) return
  for (const item of facts.items) {
    if (item.modulePath !== moduleKey) continue
    const key = publicItemKey(item)
    if (publicItemKeys.has(key)) reexports.add(key)
  }
}

const isModulePathExternallyReachable = (
  facts: RustAnalysis,
  crateName: string,
  relativeModulePath: string,
): boolean => {
  const segments = relativeModulePath.split("::").filter((segment) => segment.length > 0)
  if (segments[0] !== "crate") return false
  for (let index = 1; index < segments.length; index += 1) {
    const modulePath = `${crateName}::${segments.slice(0, index + 1).join("::")}`
    const module = facts.modulesByPath.get(modulePath)
    if (module === undefined || !isExternallyVisible(module.visibility)) return false
  }
  return true
}

const recordCrossCrateUse = (
  facts: RustAnalysis,
  publicItemKeys: ReadonlySet<string>,
  crossCrateUses: Map<string, number>,
  crateName: string,
  relativeSegments: ReadonlyArray<string>,
): void => {
  const key = resolvedPublicItemKey(facts, crateName, relativeSegments)
  if (key === undefined || !publicItemKeys.has(key)) return
  crossCrateUses.set(key, (crossCrateUses.get(key) ?? 0) + 1)
}

const resolvedPublicItemKey = (
  facts: RustAnalysis,
  crateName: string,
  segments: ReadonlyArray<string>,
): string | undefined => {
  const resolved = resolveCrateRelativePath(crateName, segments, facts)
  return resolved?.item !== undefined
    ? publicItemKey(resolved.item)
    : resolved?.key
}

const summarizePublicItems = (input: {
  readonly facts: RustAnalysis
  readonly publicItems: ReadonlyArray<RustItemFact>
  readonly usage: PublicUsage
  readonly libraryCrates: ReadonlySet<string>
  readonly exportedRootModules: ReadonlyMap<string, ReadonlySet<string>>
}): ReadonlyArray<UnusedPublicItem> =>
  input.publicItems.map((item) => {
    const key = publicItemKey(item)
    const reexported = input.usage.reexports.has(key)
    return {
      crate: item.crateName,
      module: item.modulePath,
      name: item.name,
      kind: item.kind,
      file: item.file,
      line: item.line,
      reexported,
      crossCrateUses: input.usage.crossCrateUses.get(key) ?? 0,
      surface: reexported
        ? "exported-api"
        : classifyPublicSurface(
            input.facts,
            item,
            input.libraryCrates,
            input.exportedRootModules.get(item.crateName) ?? new Set<string>(),
          ),
    }
  })

const publicItemKey = (item: { readonly modulePath: string; readonly name: string }): string =>
  `${item.modulePath}::${item.name}`

const hashUnusedPublicItem = (item: UnusedPublicItem): string =>
  computeDiagnosticHash(
    [
      item.crate,
      item.module,
      item.name,
      item.kind,
      String(item.line),
    ].join("|"),
  )

const sortByLocation = (
  items: ReadonlyArray<UnusedPublicItem>,
): ReadonlyArray<UnusedPublicItem> =>
  items.slice().sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line)

const classifyPublicSurface = (
  facts: RustAnalysis,
  item: { readonly crateName: string; readonly relativeModulePath: string },
  libraryCrates: ReadonlySet<string>,
  exportedRootModules: ReadonlySet<string>,
): UnusedPublicItem["surface"] => {
  if (!libraryCrates.has(item.crateName)) return "non-library"
  const segments = item.relativeModulePath.split("::")
  if (segments[0] !== "crate") return "non-library"
  const root = segments[1]
  if (root === undefined) return "exported-api"
  return exportedRootModules.has(root) &&
    isModulePathExternallyReachable(facts, item.crateName, item.relativeModulePath)
    ? "exported-api"
    : "internal-overpublic"
}
