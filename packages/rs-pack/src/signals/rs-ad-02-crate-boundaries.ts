import {
  type Diagnostic,
  type Signal,
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
} from "./rs-ad-02-crate-analysis.js"
import {
  RsAd02Config,
  type RsAd02Config as RsAd02ConfigType,
  type RsAd02Output,
  type RsAd02Violation,
} from "./rs-ad-02-types.js"

export {
  RsAd02Config,
  type RsAd02Output,
  type RsAd02Violation,
} from "./rs-ad-02-types.js"

export const RsAd02: Signal<RsAd02ConfigType, RsAd02Output, RustProjectTag | ReferenceDataTag> = {
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

const computeRsAd02Output = async (
  project: RustProject,
  referenceData: ReferenceData,
  config: RsAd02ConfigType,
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
