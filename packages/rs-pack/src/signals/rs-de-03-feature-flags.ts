import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import { computeDiagnosticHash } from "@skastr0/pulsar-core/reference-data"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { Effect, Schema } from "effect"
import { type CargoMetadataPackage, workspacePackages } from "../cargo-metadata.js"
import { RustProjectTag } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { isExcluded, normalizePath } from "./shared-globs.js"
import { parseRustFile, walkRustTree } from "../syn-walker.js"

const RsDe03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  warn_feature_count: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
type RsDe03Config = typeof RsDe03Config.Type

interface FeaturePropagation {
  readonly crate: string
  readonly feature: string
  readonly dependencyAlias: string
  readonly targetCrate: string
  readonly targetFeature: string | undefined
  readonly optional: boolean
  readonly activationKind:
    | "dependency-feature"
    | "weak-dependency-feature"
    | "optional-dependency"
}

interface FeatureCrateSummary {
  readonly crate: string
  readonly featureCount: number
  readonly conditionalCompilationSites: number
  readonly propagatedFeatures: number
  readonly manifestPath: string
  readonly firstConditionalFile: string | undefined
}

interface RsDe03Output {
  readonly crates: ReadonlyArray<FeatureCrateSummary>
  readonly propagationByCrate: ReadonlyMap<string, ReadonlyArray<FeaturePropagation>>
  readonly totalConditionalCompilationSites: number
  readonly metadataStatus: "loaded" | "missing"
  readonly packageCount: number
  readonly sourceFileCount: number
  readonly analyzedSourceFileCount: number
  readonly featureDefinitionCount: number
  readonly propagationCount: number
  readonly warnFeatureCount: number
  readonly diagnosticLimit: number
  readonly analysisMode: "cargo-metadata-plus-cfg-scan"
}

const DEFAULT_WARN_FEATURE_COUNT = 8
const DEFAULT_TOP_N_DIAGNOSTICS = 10

const RS_DE_03_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_RUST_EXCLUDE_GLOBS],
  },
  {
    path: "config.warn_feature_count",
    title: "Config warn feature count",
    valueKind: "number",
    scoreRole: "threshold",
    defaultValue: DEFAULT_WARN_FEATURE_COUNT,
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsDe03: Signal<RsDe03Config, RsDe03Output, RustProjectTag> = {
  id: "RS-DE-03-feature-flags",
  title: "Feature flag complexity",
  aliases: ["RS-DE-03"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  cacheVersion: "cargo-feature-flags-config-propagation-v1",
  configSchema: RsDe03Config,
  factorDefinitions: RS_DE_03_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    warn_feature_count: DEFAULT_WARN_FEATURE_COUNT,
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsDe03Config(config)
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsDe03Output> => {
          if (project.cargoMetadata === undefined) {
            return {
              crates: [],
              propagationByCrate: new Map(),
              totalConditionalCompilationSites: 0,
              metadataStatus: "missing",
              packageCount: 0,
              sourceFileCount: project.sourceFiles.length,
              analyzedSourceFileCount: 0,
              featureDefinitionCount: 0,
              propagationCount: 0,
              warnFeatureCount: normalizedConfig.warn_feature_count,
              diagnosticLimit: normalizedConfig.top_n_diagnostics,
              analysisMode: "cargo-metadata-plus-cfg-scan",
            }
          }

          const packages = workspacePackages(project.cargoMetadata)
          const propagationByCrate = new Map<string, Array<FeaturePropagation>>()
          const conditionalSitesByCrate = new Map<string, number>()
          const firstConditionalFileByCrate = new Map<string, string>()
          const sourceFilesByCrate = new Map<string, number>()
          const analyzedSourceFilesByCrate = new Map<string, number>()
          for (const manifest of project.manifests) {
            if (manifest.packageName === undefined) continue
            const files = project.sourceFiles.filter((file) => {
              const normalizedFile = normalizePath(file)
              return normalizedFile.startsWith(`${normalizePath(manifest.path)}/`)
            })
            sourceFilesByCrate.set(manifest.packageName, files.length)
            let siteCount = 0
            let analyzedFiles = 0
            for (const file of files) {
              if (isExcluded(file, normalizedConfig.exclude_globs)) continue
              analyzedFiles += 1
              const fileSiteCount = await countFeatureConditionals(file)
              siteCount += fileSiteCount
              if (fileSiteCount > 0 && !firstConditionalFileByCrate.has(manifest.packageName)) {
                firstConditionalFileByCrate.set(manifest.packageName, file)
              }
            }
            conditionalSitesByCrate.set(manifest.packageName, siteCount)
            analyzedSourceFilesByCrate.set(manifest.packageName, analyzedFiles)
          }

          const crates = packages
            .map((pkg) => {
              const featureNames = new Set(Object.keys(pkg.features))
              const dependencyByAlias = cargoDependenciesByAlias(pkg)
              const propagations = Object.entries(pkg.features).flatMap(([feature, enables]) =>
                enables.flatMap((enable) => {
                  const parsed = parseFeatureEnable(enable, featureNames, dependencyByAlias)
                  if (parsed === undefined) return []
                  return [
                    {
                      crate: pkg.name,
                      feature,
                      dependencyAlias: parsed.dependencyAlias,
                      targetCrate: parsed.targetCrate,
                      targetFeature: parsed.targetFeature,
                      optional: parsed.optional,
                      activationKind: parsed.activationKind,
                    } satisfies FeaturePropagation,
                  ]
                }),
              )
              propagationByCrate.set(pkg.name, propagations)
              return {
                crate: pkg.name,
                featureCount: Object.keys(pkg.features).length,
                conditionalCompilationSites: conditionalSitesByCrate.get(pkg.name) ?? 0,
                propagatedFeatures: propagations.length,
                manifestPath: pkg.manifestPath,
                firstConditionalFile: firstConditionalFileByCrate.get(pkg.name),
              } satisfies FeatureCrateSummary
            })
            .sort(compareFeatureCrateSummaries)
          const featureDefinitionCount = crates.reduce((sum, entry) => sum + entry.featureCount, 0)
          const propagationCount = crates.reduce((sum, entry) => sum + entry.propagatedFeatures, 0)

          return {
            crates,
            propagationByCrate,
            totalConditionalCompilationSites: crates.reduce(
              (sum, entry) => sum + entry.conditionalCompilationSites,
              0,
            ),
            metadataStatus: "loaded",
            packageCount: packages.length,
            sourceFileCount: [...sourceFilesByCrate.values()].reduce((sum, count) => sum + count, 0),
            analyzedSourceFileCount: [...analyzedSourceFilesByCrate.values()].reduce(
              (sum, count) => sum + count,
              0,
            ),
            featureDefinitionCount,
            propagationCount,
            warnFeatureCount: normalizedConfig.warn_feature_count,
            diagnosticLimit: normalizedConfig.top_n_diagnostics,
            analysisMode: "cargo-metadata-plus-cfg-scan",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-03-feature-flags", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (
      out.metadataStatus === "missing" ||
      out.crates.length === 0 ||
      (out.featureDefinitionCount === 0 &&
        out.propagationCount === 0 &&
        out.totalConditionalCompilationSites === 0)
    ) {
      return 1
    }
    const maxFeatureCount = out.crates.reduce(
      (max, entry) => Math.max(max, entry.featureCount),
      0,
    )
    const featurePenalty = Math.min(
      0.55,
      Math.max(0, maxFeatureCount - out.warnFeatureCount) /
        Math.max(1, out.warnFeatureCount),
    )
    const propagationPenalty = Math.min(0.25, out.propagationCount / 40)
    const conditionalPenalty = Math.min(0.25, out.totalConditionalCompilationSites / 40)
    return Math.max(0, 1 - featurePenalty - propagationPenalty - conditionalPenalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.metadataStatus === "missing") {
      return [{
        severity: "warn" as const,
        message: "RS-DE-03 could not load cargo metadata for feature analysis",
        data: {
          metadataStatus: out.metadataStatus,
          packageCount: out.packageCount,
          sourceFileCount: out.sourceFileCount,
          analyzedSourceFileCount: out.analyzedSourceFileCount,
          analysisMode: out.analysisMode,
        },
      }].slice(0, out.diagnosticLimit)
    }
    return out.crates
      .filter((entry) =>
        entry.featureCount > 0 ||
        entry.propagatedFeatures > 0 ||
        entry.conditionalCompilationSites > 0
      )
      .slice(0, out.diagnosticLimit)
      .map((entry) => ({
      severity: entry.featureCount >= out.warnFeatureCount ? ("warn" as const) : ("info" as const),
      message: `Crate ${entry.crate} defines ${entry.featureCount} features (${entry.propagatedFeatures} cross-crate propagations, ${entry.conditionalCompilationSites} cfg sites)`,
      location: { file: entry.manifestPath ?? entry.firstConditionalFile ?? "Cargo.toml" },
      data: {
        hash: hashFeatureCrate(entry, out.propagationByCrate.get(entry.crate) ?? []),
        crate: entry.crate,
        featureCount: entry.featureCount,
        conditionalCompilationSites: entry.conditionalCompilationSites,
        propagatedFeatures: entry.propagatedFeatures,
        warnFeatureCount: out.warnFeatureCount,
        propagations: (out.propagationByCrate.get(entry.crate) ?? []).map((propagation) => ({
          dependencyAlias: propagation.dependencyAlias,
          feature: propagation.feature,
          targetCrate: propagation.targetCrate,
          targetFeature: propagation.targetFeature,
          optional: propagation.optional,
          activationKind: propagation.activationKind,
        })),
        analysisMode: out.analysisMode,
      },
    }))
  },
  outputMetadata: (out) => {
    if (out.metadataStatus === "missing") {
      return { applicability: "insufficient_evidence" as const }
    }
    if (
      out.packageCount === 0 ||
      (out.featureDefinitionCount === 0 &&
        out.propagationCount === 0 &&
        out.totalConditionalCompilationSites === 0)
    ) {
      return { applicability: "not_applicable" as const }
    }
    return undefined
  },
  factorLedger: () => makeRsDe03FactorLedger(),
}

type NormalizedRsDe03Config = RsDe03Config

const normalizeRsDe03Config = (config: RsDe03Config): NormalizedRsDe03Config => ({
  exclude_globs: config.exclude_globs,
  warn_feature_count: Number.isFinite(config.warn_feature_count)
    ? Math.max(1, Math.floor(config.warn_feature_count))
    : DEFAULT_WARN_FEATURE_COUNT,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const makeRsDe03FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-DE-03-feature-flags", RS_DE_03_FACTOR_DEFINITIONS)

const cargoDependenciesByAlias = (
  pkg: CargoMetadataPackage,
): ReadonlyMap<string, CargoMetadataPackage["dependencies"][number]> => {
  const dependencies = new Map<string, CargoMetadataPackage["dependencies"][number]>()
  for (const dependency of pkg.dependencies) {
    dependencies.set(dependency.rename ?? dependency.name, dependency)
  }
  return dependencies
}

const parseFeatureEnable = (
  value: string,
  featureNames: ReadonlySet<string>,
  dependencyByAlias: ReadonlyMap<string, CargoMetadataPackage["dependencies"][number]>,
):
  | {
    readonly dependencyAlias: string
    readonly targetCrate: string
    readonly targetFeature: string | undefined
    readonly optional: boolean
    readonly activationKind: FeaturePropagation["activationKind"]
  }
  | undefined => {
  const explicitDependencyMatch = /^dep:([A-Za-z_][A-Za-z0-9_-]*)$/.exec(value)
  if (explicitDependencyMatch !== null) {
    const dependencyAlias = explicitDependencyMatch[1]!
    const dependency = dependencyByAlias.get(dependencyAlias)
    if (dependency === undefined) return undefined
    return {
      dependencyAlias,
      targetCrate: dependency.name,
      targetFeature: undefined,
      optional: dependency.optional,
      activationKind: "optional-dependency",
    }
  }

  const dependencyFeatureMatch = /^(\S+?)(\?)?\/(\S+)$/.exec(value)
  if (dependencyFeatureMatch !== null) {
    const dependencyAlias = dependencyFeatureMatch[1]!
    const dependency = dependencyByAlias.get(dependencyAlias)
    if (dependency === undefined) return undefined
    return {
      dependencyAlias,
      targetCrate: dependency.name,
      targetFeature: dependencyFeatureMatch[3]!,
      optional: dependency.optional || dependencyFeatureMatch[2] === "?",
      activationKind:
        dependencyFeatureMatch[2] === "?"
          ? "weak-dependency-feature"
          : "dependency-feature",
    }
  }

  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) {
    if (featureNames.has(value)) return undefined
    const dependency = dependencyByAlias.get(value)
    if (dependency === undefined || !dependency.optional) return undefined
    return {
      dependencyAlias: value,
      targetCrate: dependency.name,
      targetFeature: undefined,
      optional: true,
      activationKind: "optional-dependency",
    }
  }

  return undefined
}

const countFeatureConditionals = async (file: string): Promise<number> => {
  const tree = await parseRustFile(file)
  let count = 0
  walkRustTree(tree, (node) => {
    if (
      (node.type === "attribute_item" || node.type === "inner_attribute_item") &&
      /#\s*!?\[\s*cfg(?:_attr)?\s*\([^\]]*feature\s*=\s*"[^"]+"/.test(node.text)
    ) {
      count += 1
    }
    if (
      node.type === "macro_invocation" &&
      /\bcfg!\s*\([^)]*feature\s*=\s*"[^"]+"/.test(node.text)
    ) {
      count += 1
    }
  })
  return count
}

const compareFeatureCrateSummaries = (
  left: FeatureCrateSummary,
  right: FeatureCrateSummary,
): number =>
  right.featureCount - left.featureCount ||
  right.propagatedFeatures - left.propagatedFeatures ||
  right.conditionalCompilationSites - left.conditionalCompilationSites ||
  left.crate.localeCompare(right.crate)

const hashFeatureCrate = (
  entry: FeatureCrateSummary,
  propagations: ReadonlyArray<FeaturePropagation>,
): string =>
  computeDiagnosticHash(
    [
      entry.crate,
      entry.featureCount,
      entry.conditionalCompilationSites,
      entry.propagatedFeatures,
      ...[...propagations].sort(compareFeaturePropagations).map((propagation) =>
        [
          propagation.feature,
          propagation.dependencyAlias,
          propagation.targetCrate,
          propagation.targetFeature ?? "",
          propagation.optional,
          propagation.activationKind,
        ].join(":"),
      ),
    ].join("|"),
  )

const compareFeaturePropagations = (
  left: FeaturePropagation,
  right: FeaturePropagation,
): number =>
  left.feature.localeCompare(right.feature) ||
  left.dependencyAlias.localeCompare(right.dependencyAlias) ||
  left.targetCrate.localeCompare(right.targetCrate) ||
  (left.targetFeature ?? "").localeCompare(right.targetFeature ?? "") ||
  Number(left.optional) - Number(right.optional) ||
  left.activationKind.localeCompare(right.activationKind)
