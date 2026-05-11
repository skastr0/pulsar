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
} from "@skastr0/pulsar-core"
import {
  collectRustProjectFacts,
  isExternallyVisible,
  type RustItemFact,
  type RustModuleFact,
} from "../rust-analysis.js"
import {
  type RustManifestInfo,
  type RustProject,
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
  id: "RS-AD-02-crate-boundaries",
  title: "Crate boundary violations",
  aliases: ["RS-AD-02"],
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
        try: () => computeRsAd02Output(project, referenceData, config),
        catch: (cause) =>
          new SignalComputeError({ signalId: "RS-AD-02-crate-boundaries", message: String(cause), cause }),
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

type RustProjectFacts = Awaited<ReturnType<typeof collectRustProjectFacts>>
type RustUseFact = RustProjectFacts["uses"][number]

const computeRsAd02Output = async (
  project: RustProject,
  referenceData: ReferenceData,
  config: RsAd02Config,
): Promise<RsAd02Output> => {
  if (project.sourceFiles.length === 0) return missingReferenceDataOutput(0)

  const facts = await collectRustProjectFacts(project)
  const crateByIdentifier = buildCrateIdentifierIndex(project.manifests)
  const crossCrateImports = collectCrossCrateImports(facts, crateByIdentifier, config)
  const rawConventions = await Effect.runPromise(referenceData.get<unknown>("schema-conventions"))
  if (Option.isNone(rawConventions)) return missingReferenceDataOutput(crossCrateImports.length)

  const rules = normalizeBoundaryRules(rawConventions.value)
  return {
    checkedImports: crossCrateImports.length,
    violations: evaluateCrateBoundaryViolations(
      crossCrateImports,
      project.manifests,
      crateByIdentifier,
      rules,
      facts,
    ),
    referenceDataStatus: "loaded",
  }
}

const missingReferenceDataOutput = (checkedImports: number): RsAd02Output => ({
  checkedImports,
  violations: [],
  referenceDataStatus: "missing",
})

const collectCrossCrateImports = (
  facts: RustProjectFacts,
  crateByIdentifier: ReadonlyMap<string, RustManifestInfo>,
  config: RsAd02Config,
): ReadonlyArray<RustUseFact> =>
  facts.uses.filter((useFact) => {
    if (isExcluded(useFact.file, config.exclude_globs)) return false
    const root = useFact.segments[0]
    return root !== undefined && crateByIdentifier.has(root)
  })

const evaluateCrateBoundaryViolations = (
  crossCrateImports: ReadonlyArray<RustUseFact>,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateByIdentifier: ReadonlyMap<string, RustManifestInfo>,
  rules: ReadonlyMap<string, RustBoundaryRule>,
  facts: RustProjectFacts,
): ReadonlyArray<RsAd02Violation> => {
  const violations = crossCrateImports.flatMap((useFact) =>
    violationForCrossCrateImport(useFact, manifests, crateByIdentifier, rules, facts),
  )
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
}

const violationForCrossCrateImport = (
  useFact: RustUseFact,
  manifests: ReadonlyArray<RustManifestInfo>,
  crateByIdentifier: ReadonlyMap<string, RustManifestInfo>,
  rules: ReadonlyMap<string, RustBoundaryRule>,
  facts: RustProjectFacts,
): ReadonlyArray<RsAd02Violation> => {
  const targetCrate = crateByIdentifier.get(useFact.segments[0]!)
  if (targetCrate === undefined) return []
  const fromCrate = manifestForFile(useFact.file, manifests)
  if (fromCrate === undefined) return []
  const rule = lookupBoundaryRule(rules, targetCrate)
  if (rule === undefined) return []

  const dependentViolation = dependentRuleViolation(useFact, fromCrate, targetCrate, rule)
  if (dependentViolation !== undefined) return [dependentViolation]

  const targetVisibility = resolveTargetVisibility(
    useFact.segments.slice(1),
    targetCrate.packageName ?? targetCrate.name,
    facts.modulesByPath,
    facts.itemsByModuleAndName,
  )
  const visibilityViolation = visibilityRuleViolation(useFact, fromCrate, targetCrate, targetVisibility)
  if (visibilityViolation !== undefined) return [visibilityViolation]

  const moduleViolation = publicModuleRuleViolation(useFact, fromCrate, targetCrate, rule, targetVisibility)
  return moduleViolation === undefined ? [] : [moduleViolation]
}

const dependentRuleViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  rule: RustBoundaryRule,
): RsAd02Violation | undefined => {
  const dependentIdentifiers = crateIdentifiers(fromCrate)
  if (
    rule.allowedDependents.length === 0 ||
    rule.allowedDependents.some((allowed) => dependentIdentifiers.has(allowed))
  ) {
    return undefined
  }
  return baseViolation(useFact, fromCrate, targetCrate, {
    kind: "dependent-not-allowed",
    detail: `Crate ${fromCrate.packageName ?? fromCrate.name} is not listed in allowed_dependents for ${targetCrate.packageName ?? targetCrate.name}`,
  })
}

const visibilityRuleViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  targetVisibility: ReturnType<typeof resolveTargetVisibility>,
): RsAd02Violation | undefined => {
  if (targetVisibility === undefined || isExternallyVisible(targetVisibility.visibility)) {
    return undefined
  }
  return baseViolation(useFact, fromCrate, targetCrate, {
    kind: "non-public-target",
    detail: `${useFact.path} resolves to a ${targetVisibility.kind} with visibility ${targetVisibility.visibility.kind}`,
  })
}

const publicModuleRuleViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  rule: RustBoundaryRule,
  targetVisibility: ReturnType<typeof resolveTargetVisibility>,
): RsAd02Violation | undefined => {
  const importedModule = importedModulePath(useFact.segments.slice(1), targetVisibility?.kind === "module")
  const isAllowedModule = rule.publicModules.some((prefix) =>
    prefix === "crate"
      ? importedModule === "crate"
      : importedModule === prefix || importedModule.startsWith(`${prefix}::`),
  )
  return isAllowedModule
    ? undefined
    : baseViolation(useFact, fromCrate, targetCrate, {
        kind: "boundary-rule",
        detail: `${useFact.path} bypasses declared public modules (${rule.publicModules.join(", ")})`,
      })
}

const baseViolation = (
  useFact: RustUseFact,
  fromCrate: RustManifestInfo,
  targetCrate: RustManifestInfo,
  violation: Pick<RsAd02Violation, "kind" | "detail">,
): RsAd02Violation => ({
  file: useFact.file,
  line: useFact.line,
  fromCrate: fromCrate.packageName ?? fromCrate.name,
  toCrate: targetCrate.packageName ?? targetCrate.name,
  importPath: useFact.path,
  ...violation,
})

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
