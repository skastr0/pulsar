import {
  type Diagnostic,
  type Signal,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import { readFile } from "node:fs/promises"
import { Effect, Schema } from "effect"
import { workspacePackages } from "../cargo-metadata.js"
import { RustProjectTag } from "../project.js"
import { DEFAULT_RUST_EXCLUDE_GLOBS } from "./shared-rust-ast.js"
import { isExcluded, normalizePath } from "./shared-globs.js"

export const RsDe03Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  warn_feature_count: Schema.Number,
  top_n_diagnostics: Schema.Number,
})
export type RsDe03Config = typeof RsDe03Config.Type

export interface FeaturePropagation {
  readonly crate: string
  readonly feature: string
  readonly targetCrate: string
  readonly targetFeature: string | undefined
  readonly optional: boolean
}

export interface FeatureCrateSummary {
  readonly crate: string
  readonly featureCount: number
  readonly conditionalCompilationSites: number
  readonly propagatedFeatures: number
}

export interface RsDe03Output {
  readonly crates: ReadonlyArray<FeatureCrateSummary>
  readonly propagationByCrate: ReadonlyMap<string, ReadonlyArray<FeaturePropagation>>
  readonly totalConditionalCompilationSites: number
  readonly metadataStatus: "loaded" | "missing"
  readonly analysisMode: "cargo-metadata-plus-cfg-scan"
}

export const RsDe03: Signal<RsDe03Config, RsDe03Output, RustProjectTag> = {
  id: "RS-DE-03-feature-flags",
  title: "Feature flag complexity",
  aliases: ["RS-DE-03"],
  tier: 1,
  category: "dependency-entropy",
  kind: "structural",
  configSchema: RsDe03Config,
  defaultConfig: {
    exclude_globs: [...DEFAULT_RUST_EXCLUDE_GLOBS],
    warn_feature_count: 8,
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsDe03Output> => {
          if (project.cargoMetadata === undefined) {
            return {
              crates: [],
              propagationByCrate: new Map(),
              totalConditionalCompilationSites: 0,
              metadataStatus: "missing",
              analysisMode: "cargo-metadata-plus-cfg-scan",
            }
          }

          const packages = workspacePackages(project.cargoMetadata)
          const propagationByCrate = new Map<string, Array<FeaturePropagation>>()
          const conditionalSitesByCrate = new Map<string, number>()
          for (const manifest of project.manifests) {
            if (manifest.packageName === undefined) continue
            const files = project.sourceFiles.filter((file) => {
              const normalizedFile = normalizePath(file)
              return normalizedFile.startsWith(`${normalizePath(manifest.path)}/`)
            })
            let siteCount = 0
            for (const file of files) {
              if (isExcluded(file, config.exclude_globs)) continue
              siteCount += countFeatureConditionals(await readFile(file, "utf8"))
            }
            conditionalSitesByCrate.set(manifest.packageName, siteCount)
          }

          const crates = packages
            .map((pkg) => {
              const propagations = Object.entries(pkg.features).flatMap(([feature, enables]) =>
                enables.flatMap((enable) => {
                  const parsed = parseFeatureEnable(enable)
                  if (parsed === undefined) return []
                  return [
                    {
                      crate: pkg.name,
                      feature,
                      targetCrate: parsed.targetCrate,
                      targetFeature: parsed.targetFeature,
                      optional: parsed.optional,
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
              } satisfies FeatureCrateSummary
            })
            .sort((left, right) => right.featureCount - left.featureCount || left.crate.localeCompare(right.crate))

          return {
            crates,
            propagationByCrate,
            totalConditionalCompilationSites: crates.reduce(
              (sum, entry) => sum + entry.conditionalCompilationSites,
              0,
            ),
            metadataStatus: "loaded",
            analysisMode: "cargo-metadata-plus-cfg-scan",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-DE-03-feature-flags", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.crates.length === 0) return 1
    const maxFeatureCount = out.crates.reduce(
      (max, entry) => Math.max(max, entry.featureCount),
      0,
    )
    const penalty = Math.min(1, Math.max(0, maxFeatureCount - 4) / 12)
    return Math.max(0, 1 - penalty)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.metadataStatus === "missing") {
      return [{ severity: "warn", message: "RS-DE-03 could not load cargo metadata for feature analysis" }]
    }
    return out.crates.slice(0, 10).map((entry) => ({
      severity: entry.featureCount >= 8 ? ("warn" as const) : ("info" as const),
      message: `Crate ${entry.crate} defines ${entry.featureCount} features (${entry.propagatedFeatures} cross-crate propagations)`,
      data: {
        crate: entry.crate,
        featureCount: entry.featureCount,
        conditionalCompilationSites: entry.conditionalCompilationSites,
        propagatedFeatures: entry.propagatedFeatures,
        analysisMode: out.analysisMode,
      },
    }))
  },
}

const parseFeatureEnable = (
  value: string,
):
  | { readonly targetCrate: string; readonly targetFeature: string | undefined; readonly optional: boolean }
  | undefined => {
  const dependencyFeatureMatch = /^(\S+?)(\?)?\/(\S+)$/.exec(value)
  if (dependencyFeatureMatch !== null) {
    return {
      targetCrate: dependencyFeatureMatch[1]!,
      targetFeature: dependencyFeatureMatch[3]!,
      optional: dependencyFeatureMatch[2] === "?",
    }
  }

  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(value)) {
    return { targetCrate: value, targetFeature: undefined, optional: false }
  }

  return undefined
}

const countFeatureConditionals = (source: string): number => {
  const matches = [
    ...source.matchAll(/#\s*\[\s*cfg(?:_attr)?\s*\([^\]]*feature\s*=\s*"[^"]+"/g),
    ...source.matchAll(/\bcfg!\s*\([^)]*feature\s*=\s*"[^"]+"/g),
  ]
  return matches.length
}
