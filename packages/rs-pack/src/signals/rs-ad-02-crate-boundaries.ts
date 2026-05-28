import { type SignalFactorLedger } from "@skastr0/pulsar-core/factors"
import { makeDefaultSignalFactorLedger } from "./shared-factor-ledger.js"
import {
  type Diagnostic,
  type Signal,
  type SignalFactorDefinition,
  SignalComputeError,
} from "@skastr0/pulsar-core/signal"
import {
  type ReferenceData,
  ReferenceDataTag,
} from "@skastr0/pulsar-core/reference-data"
import {
  Option,
  Effect,
} from "effect"
import {
  computeDiagnosticHash,
} from "@skastr0/pulsar-core/reference-data"
import {
  collectRustProjectFacts,
} from "../rust-analysis.js"
import {
  type RustProject,
  RustProjectTag,
} from "../project.js"
import { normalizeBoundaryRules } from "./rs-ad-02-boundary-rules.js"
import {
  buildCrateIdentifierIndex,
  collectCrossCrateImports,
  evaluateCrateBoundaryViolations,
  hasBoundaryRuleForUse,
} from "./rs-ad-02-crate-analysis.js"
import {
  RsAd02Config,
  type RsAd02Config as RsAd02ConfigType,
  type RsAd02Output,
  type RsAd02Violation,
} from "./rs-ad-02-types.js"

const DEFAULT_TOP_N_DIAGNOSTICS = 10
const DEFAULT_EXCLUDE_GLOBS = ["**/target/**", "**/tests/**", "**/examples/**", "**/benches/**"] as const

const RS_AD_02_FACTOR_DEFINITIONS: ReadonlyArray<SignalFactorDefinition> = [
  {
    path: "config.exclude_globs",
    title: "Config exclude globs",
    valueKind: "array",
    scoreRole: "evidence",
    defaultValue: [...DEFAULT_EXCLUDE_GLOBS],
  },
  {
    path: "config.top_n_diagnostics",
    title: "Config top n diagnostics",
    valueKind: "number",
    scoreRole: "metadata",
    defaultValue: DEFAULT_TOP_N_DIAGNOSTICS,
  },
]

export const RsAd02: Signal<RsAd02ConfigType, RsAd02Output, RustProjectTag | ReferenceDataTag> = {
  id: "RS-AD-02-crate-boundaries",
  title: "Crate boundary violations",
  aliases: ["RS-AD-02"],
  tier: 2,
  category: "architectural-drift",
  kind: "structural",
  cacheVersion: "crate-boundary-reference-data-config-aliases-use-segments-v3",
  configSchema: RsAd02Config,
  factorDefinitions: RS_AD_02_FACTOR_DEFINITIONS,
  defaultConfig: {
    exclude_globs: [...DEFAULT_EXCLUDE_GLOBS],
    top_n_diagnostics: DEFAULT_TOP_N_DIAGNOSTICS,
  },
  inputs: [],
  compute: (config) =>
    Effect.gen(function* () {
      const normalizedConfig = normalizeRsAd02Config(config)
      const project = yield* RustProjectTag
      const referenceData = yield* ReferenceDataTag
      return yield* Effect.tryPromise({
        try: () => computeRsAd02Output(project, referenceData, normalizedConfig),
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
          severity: "warn" as const,
          message:
            "RS-AD-02 requires schema-conventions reference data; no Rust boundary rules were loaded",
          data: {
            checkedImports: out.checkedImports,
            referenceDataStatus: out.referenceDataStatus,
          },
        },
      ].slice(0, out.diagnosticLimit)
    }

    return out.violations.slice(0, out.diagnosticLimit).map((violation) => ({
      severity: "block" as const,
      message: `Crate boundary violation: ${violation.importPath} (${violation.detail})`,
      location: { file: violation.file, line: violation.line },
      data: {
        hash: hashViolation(violation),
        ...violation,
      },
    }))
  },
  outputMetadata: (out) => {
    if (out.referenceDataStatus === "missing") {
      return { applicability: "insufficient_evidence" as const }
    }
    return out.checkedImports === 0 ? { applicability: "not_applicable" as const } : undefined
  },
  factorLedger: () => makeRsAd02FactorLedger(),
}

type NormalizedRsAd02Config = RsAd02ConfigType

const normalizeRsAd02Config = (config: RsAd02ConfigType): NormalizedRsAd02Config => ({
  exclude_globs: config.exclude_globs,
  top_n_diagnostics: Number.isFinite(config.top_n_diagnostics)
    ? Math.max(0, Math.floor(config.top_n_diagnostics))
    : 0,
})

const computeRsAd02Output = async (
  project: RustProject,
  referenceData: ReferenceData,
  config: NormalizedRsAd02Config,
): Promise<RsAd02Output> => {
  const facts = await collectRustProjectFacts(project)
  const crateIndex = buildCrateIdentifierIndex(project.manifests, project.cargoMetadata)
  const crossCrateImports = collectCrossCrateImports(facts, project.manifests, crateIndex, config)
  const rawConventions = await Effect.runPromise(referenceData.get<unknown>("schema-conventions"))
  if (Option.isNone(rawConventions)) {
    return missingReferenceDataOutput(crossCrateImports.length, config.top_n_diagnostics)
  }

  const rules = normalizeBoundaryRules(rawConventions.value)
  const governedImports = crossCrateImports.filter((useFact) =>
    hasBoundaryRuleForUse(useFact, project.manifests, crateIndex, rules),
  )
  if (crossCrateImports.length > 0 && governedImports.length === 0) {
    return missingReferenceDataOutput(crossCrateImports.length, config.top_n_diagnostics)
  }

  return {
    checkedImports: governedImports.length,
    violations: evaluateCrateBoundaryViolations(
      governedImports,
      project.manifests,
      crateIndex,
      rules,
      facts,
    ),
    referenceDataStatus: "loaded",
    diagnosticLimit: config.top_n_diagnostics,
  }
}

const missingReferenceDataOutput = (
  checkedImports: number,
  diagnosticLimit: number,
): RsAd02Output => ({
  checkedImports,
  violations: [],
  referenceDataStatus: "missing",
  diagnosticLimit,
})

const hashViolation = (violation: RsAd02Violation): string =>
  computeDiagnosticHash(
    [
      violation.fromCrate,
      violation.toCrate,
      violation.file,
      String(violation.line),
      violation.importPath,
      violation.kind,
    ].join("|"),
  )

const makeRsAd02FactorLedger = (): SignalFactorLedger =>
  makeDefaultSignalFactorLedger("RS-AD-02-crate-boundaries", RS_AD_02_FACTOR_DEFINITIONS)
