import {
  Option,
  Effect,
  Schema,
} from "effect"
import {
  computeDiagnosticHash,
  type Diagnostic,
  type ReferenceData,
  ReferenceDataTag,
  type Signal,
  SignalComputeError,
} from "@taste-codec/core"
import {
  collectRustProjectFacts,
  isExternallyVisible,
  type RustItemFact,
  type RustModuleFact,
} from "../rust-analysis.js"
import {
  type RustManifestInfo,
  RustProjectTag,
} from "../project.js"
import { isExcluded, normalizePath } from "./shared-globs.js"

export const RsAd02Config = Schema.Struct({
  exclude_globs: Schema.Array(Schema.String),
  top_n_diagnostics: Schema.Number,
})
export type RsAd02Config = typeof RsAd02Config.Type

interface RustBoundaryRule {
  readonly visibility: string
  readonly allowedDependents: ReadonlyArray<string>
  readonly publicModules: ReadonlyArray<string>
}

export interface RsAd02Violation {
  readonly file: string
  readonly line: number
  readonly fromCrate: string
  readonly toCrate: string
  readonly importPath: string
  readonly kind: "dependent-not-allowed" | "non-public-target" | "boundary-rule"
  readonly detail: string
}

export interface RsAd02Output {
  readonly checkedImports: number
  readonly violations: ReadonlyArray<RsAd02Violation>
  readonly referenceDataStatus: "loaded" | "missing"
}

export const RsAd02: Signal<RsAd02Config, RsAd02Output, RustProjectTag | ReferenceDataTag> = {
  id: "RS-AD-02",
  tier: 2,
  category: "architectural-drift",
  kind: "structural",
  configSchema: RsAd02Config,
  defaultConfig: {
    exclude_globs: ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"],
    top_n_diagnostics: 10,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const project = yield* RustProjectTag
      const referenceData = yield* ReferenceDataTag
      return yield* Effect.tryPromise({
        try: async (): Promise<RsAd02Output> => {
          if (project.sourceFiles.length === 0) {
            return {
              checkedImports: 0,
              violations: [],
              referenceDataStatus: "missing",
            }
          }

          const facts = await collectRustProjectFacts(project)
          const crateByIdentifier = buildCrateIdentifierIndex(project.manifests)
          const crossCrateImports = facts.uses.filter((useFact) => {
            if (isExcluded(useFact.file, config.exclude_globs)) return false
            const root = useFact.segments[0]
            return root !== undefined && crateByIdentifier.has(root)
          })

          const rawConventions = await Effect.runPromise(referenceData.get<unknown>("schema-conventions"))
          if (Option.isNone(rawConventions)) {
            return {
              checkedImports: crossCrateImports.length,
              violations: [],
              referenceDataStatus: "missing",
            }
          }

          const rules = normalizeBoundaryRules(rawConventions.value)
          const violations: Array<RsAd02Violation> = []

          for (const useFact of crossCrateImports) {
            const targetCrate = crateByIdentifier.get(useFact.segments[0]!)
            if (targetCrate === undefined) continue
            const fromCrate = manifestForFile(useFact.file, project.manifests)
            if (fromCrate === undefined) continue

            const rule = lookupBoundaryRule(rules, targetCrate)
            if (rule === undefined) continue

            const dependentIdentifiers = crateIdentifiers(fromCrate)
            if (
              rule.allowedDependents.length > 0 &&
              !rule.allowedDependents.some((allowed) => dependentIdentifiers.has(allowed))
            ) {
              violations.push({
                file: useFact.file,
                line: useFact.line,
                fromCrate: fromCrate.packageName ?? fromCrate.name,
                toCrate: targetCrate.packageName ?? targetCrate.name,
                importPath: useFact.path,
                kind: "dependent-not-allowed",
                detail: `Crate ${fromCrate.packageName ?? fromCrate.name} is not listed in allowed_dependents for ${targetCrate.packageName ?? targetCrate.name}`,
              })
              continue
            }

            const targetVisibility = resolveTargetVisibility(
              useFact.segments.slice(1),
              targetCrate.packageName ?? targetCrate.name,
              facts.modulesByPath,
              facts.itemsByModuleAndName,
            )

            if (targetVisibility !== undefined && !isExternallyVisible(targetVisibility.visibility)) {
              violations.push({
                file: useFact.file,
                line: useFact.line,
                fromCrate: fromCrate.packageName ?? fromCrate.name,
                toCrate: targetCrate.packageName ?? targetCrate.name,
                importPath: useFact.path,
                kind: "non-public-target",
                detail: `${useFact.path} resolves to a ${targetVisibility.kind} with visibility ${targetVisibility.visibility.kind}`,
              })
              continue
            }

            const importedModule = importedModulePath(useFact.segments.slice(1), targetVisibility?.kind === "module")
            const isAllowedModule = rule.publicModules.some((prefix) => {
              if (prefix === "crate") {
                return importedModule === "crate"
              }
              return importedModule === prefix || importedModule.startsWith(`${prefix}::`)
            })
            if (!isAllowedModule) {
              violations.push({
                file: useFact.file,
                line: useFact.line,
                fromCrate: fromCrate.packageName ?? fromCrate.name,
                toCrate: targetCrate.packageName ?? targetCrate.name,
                importPath: useFact.path,
                kind: "boundary-rule",
                detail: `${useFact.path} bypasses declared public modules (${rule.publicModules.join(", ")})`,
              })
            }
          }

          return {
            checkedImports: crossCrateImports.length,
            violations: violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
            referenceDataStatus: "loaded",
          }
        },
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AD-02", message: String(cause), cause }),
      })
    }),
  score: (out) => {
    if (out.checkedImports === 0) return 1
    return Math.max(0, 1 - (out.violations.length / out.checkedImports) * 2)
  },
  diagnose: (out): ReadonlyArray<Diagnostic> => {
    if (out.referenceDataStatus === "missing") {
      return [
        {
          severity: "warn",
          message:
            "RS-AD-02 requires schema-conventions reference data; no Rust boundary rules were loaded",
        },
      ]
    }

    return out.violations.slice(0, 10).map((violation) => ({
      severity: "block" as const,
      message: `Crate boundary violation: ${violation.importPath} (${violation.detail})`,
      location: { file: violation.file, line: violation.line },
      data: {
        hash: hashViolation(violation),
        ...violation,
      },
    }))
  },
}

const hashViolation = (violation: RsAd02Violation): string =>
  computeDiagnosticHash(
    [
      violation.fromCrate,
      violation.toCrate,
      violation.file,
      violation.importPath,
      violation.kind,
    ].join("|"),
  )

const isStringArray = (value: unknown): value is ReadonlyArray<string> =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string")

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const normalizeBoundaryRules = (raw: unknown): ReadonlyMap<string, RustBoundaryRule> => {
  const record = asRecord(raw)
  const boundaries = asRecord(record?.rust_crate_boundaries) ?? asRecord(record?.boundaries) ?? {}
  return new Map(
    Object.entries(boundaries).flatMap(([key, value]) => {
      const rule = asRecord(value)
      if (rule === undefined) return []
      return [
        [
          key,
          {
            visibility:
              typeof rule.visibility === "string" ? rule.visibility : "public-api",
            allowedDependents: isStringArray(rule.allowed_dependents)
              ? rule.allowed_dependents
              : [],
            publicModules: isStringArray(rule.public_modules)
              ? rule.public_modules
              : ["crate"],
          } satisfies RustBoundaryRule,
        ] as const,
      ]
    }),
  )
}

const crateIdentifiers = (manifest: RustManifestInfo): ReadonlySet<string> =>
  new Set([manifest.name, manifest.packageName].filter((value): value is string => value !== undefined))

const buildCrateIdentifierIndex = (
  manifests: ReadonlyArray<RustManifestInfo>,
): ReadonlyMap<string, RustManifestInfo> => {
  const index = new Map<string, RustManifestInfo>()
  for (const manifest of manifests) {
    for (const identifier of crateIdentifiers(manifest)) {
      index.set(identifier, manifest)
    }
  }
  return index
}

const manifestForFile = (
  filePath: string,
  manifests: ReadonlyArray<RustManifestInfo>,
): RustManifestInfo | undefined => {
  const normalizedFile = normalizePath(filePath)
  return manifests
    .slice()
    .sort((a, b) => normalizePath(b.path).length - normalizePath(a.path).length)
    .find((manifest) => normalizedFile.startsWith(`${normalizePath(manifest.path)}/`))
}

const lookupBoundaryRule = (
  rules: ReadonlyMap<string, RustBoundaryRule>,
  manifest: RustManifestInfo,
): RustBoundaryRule | undefined =>
  rules.get(manifest.packageName ?? "") ?? rules.get(manifest.name)

const importedModulePath = (segments: ReadonlyArray<string>, importingModule: boolean): string => {
  if (segments.length === 0) return "crate"
  if (importingModule) {
    return `crate::${segments.join("::")}`
  }
  if (segments.length === 1) return "crate"
  return `crate::${segments.slice(0, -1).join("::")}`
}

const resolveTargetVisibility = (
  afterCrateSegments: ReadonlyArray<string>,
  crateName: string,
  modulesByPath: ReadonlyMap<string, RustModuleFact>,
  itemsByModuleAndName: ReadonlyMap<string, RustItemFact>,
): { readonly kind: "module" | "item"; readonly visibility: RustModuleFact["visibility"] | RustItemFact["visibility"] } | undefined => {
  if (afterCrateSegments.length === 0) {
    return { kind: "module", visibility: { kind: "pub" } }
  }

  const moduleCandidate = `${crateName}::crate::${afterCrateSegments.join("::")}`
  const module = modulesByPath.get(moduleCandidate)
  if (module !== undefined) {
    return { kind: "module", visibility: module.visibility }
  }

  const itemModulePath =
    afterCrateSegments.length === 1
      ? `${crateName}::crate`
      : `${crateName}::crate::${afterCrateSegments.slice(0, -1).join("::")}`
  const itemModule = modulesByPath.get(itemModulePath)
  if (itemModule !== undefined && !isExternallyVisible(itemModule.visibility)) {
    return { kind: "module", visibility: itemModule.visibility }
  }

  const item = itemsByModuleAndName.get(`${itemModulePath}::${afterCrateSegments[afterCrateSegments.length - 1]}`)
  if (item !== undefined) {
    return { kind: "item", visibility: item.visibility }
  }

  return undefined
}
