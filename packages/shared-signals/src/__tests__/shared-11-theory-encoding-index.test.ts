import { describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import type { SharedChurn02Output } from "@skastr0/pulsar-core/shared-signals"
import { Effect, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import {
  Shared11TheoryEncodingIndex,
} from "../shared-11-theory-encoding-index.js"
import type { Shared07MachineFeedbackCoverageOutput } from "../shared-07-machine-feedback-coverage.js"
import type { Shared09ContractFreshnessOutput } from "../shared-09-contract-freshness.js"
import type { Shared10DomainConstructionControlOutput } from "../shared-10-domain-construction-control.js"
import type { SharedCov01CoverageFactsOutput } from "../shared-cov-01-coverage-facts.js"

const run = (
  inputs: ReadonlyMap<string, unknown>,
  config = Shared11TheoryEncodingIndex.defaultConfig,
) => Effect.runPromise(Shared11TheoryEncodingIndex.compute(config, inputs))

describe("Theory encoding index", () => {
  test("declares shared compound identity, config, factors, and cache-fingerprinted inputs", async () => {
    const registeredPackSignal = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-11"),
    )
    const registry = await Effect.runPromise(buildRegistry(SHARED_SIGNALS))
    const registered = registry.byId.get("SHARED-11")
    const decoded = Schema.decodeUnknownSync(Shared11TheoryEncodingIndex.configSchema)(
      Shared11TheoryEncodingIndex.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as any)

    expect(Shared11TheoryEncodingIndex).toMatchObject({
      id: "SHARED-11-theory-encoding-index",
      aliases: ["SHARED-11"],
      title: "Theory encoding index",
      category: "architectural-drift",
      kind: "compound",
      tier: 1.5,
      cacheVersion:
        "theory-encoding-index-composite-v4-grounded-optionals",
    })
    expect(decoded).toEqual({
      top_n_diagnostics: 10,
      warn_threshold: 0.35,
      min_available_factor_weight: 0.25,
    })
    expect(registered?.cacheVersion).toContain(Shared11TheoryEncodingIndex.cacheVersion)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.min_available_factor_weight",
        value: 0.25,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.warn_threshold",
        value: 0.35,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
    expect(Shared11TheoryEncodingIndex.inputs.map((input) => input.id)).toEqual([
      "SHARED-10-domain-construction-control",
      "SHARED-09-contract-freshness",
      "SHARED-07-machine-feedback-coverage",
      "SHARED-COV-01-coverage-facts",
      "TS-AD-04-boundary-parser-coverage",
      "TS-LD-09-error-channel-opacity",
      "SHARED-CHURN-02-recency-weighted-churn",
    ])
    expect(Shared11TheoryEncodingIndex.inputs.slice(0, 2).map((input) => input.optional)).toEqual([
      undefined,
      undefined,
    ])
    expect(Shared11TheoryEncodingIndex.inputs.slice(2).every((input) => input.optional)).toBe(true)
    expect(
      Shared11TheoryEncodingIndex.inputs.every((input) =>
        (input.cacheFingerprint ?? "").length > 0
      ),
    ).toBe(true)
  })

  test("reports insufficient evidence when required shared facts are missing", async () => {
    const out = await run(new Map())

    expect(out.state).toBe("insufficient_evidence")
    expect(Shared11TheoryEncodingIndex.score(out)).toBe(1)
    expect(out.requiredFoundationMeasured).toBe(false)
    expect(out.inputFactStates).toEqual({
      domainConstructionControl: "missing_required",
      contractFreshness: "missing_required",
      machineFeedbackCoverage: "missing_optional",
      coverageFacts: "missing_optional",
      boundaryParserCoverage: "missing_optional",
      errorChannelOpacity: "missing_optional",
      recencyWeightedChurn: "missing_optional",
    })
    expect(out.explanation.missingInputs).toEqual([
      "SHARED-10-domain-construction-control",
      "SHARED-09-contract-freshness",
      "SHARED-07-machine-feedback-coverage",
      "SHARED-COV-01-coverage-facts",
      "TS-AD-04-boundary-parser-coverage",
      "TS-LD-09-error-channel-opacity",
      "SHARED-CHURN-02-recency-weighted-churn",
    ])
    expect(Shared11TheoryEncodingIndex.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(Shared11TheoryEncodingIndex.diagnose(out)[0]).toMatchObject({
      severity: "warn",
      data: {
        inputFactStates: out.inputFactStates,
      },
    })
  })

  test("does not score not-configured foundation facts as measured zero", async () => {
    const out = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ state: "not_configured" })],
      ["SHARED-09", contractFreshness({ state: "not_configured" })],
    ]))

    expect(out.state).toBe("insufficient_evidence")
    expect(out.requiredFoundationMeasured).toBe(false)
    expect(out.availableFactorWeight).toBe(0)
    expect(out.factors.every((factor) => factor.pressure === undefined)).toBe(true)
  })

  test("does not let optional facts rescue unmeasured required foundations", async () => {
    const out = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ state: "not_configured" })],
      ["SHARED-09", contractFreshness({ state: "zero", scorePressure: 0 })],
      ["SHARED-07", machineFeedback({ missingClassCount: 2 })],
      ["SHARED-COV-01", coverageFacts({ lines: 0.1, functions: 0.1, branches: 0.1 })],
      ["TS-AD-04", boundaryParserCoverage({ findings: 2, covered: 0 })],
      ["TS-LD-09", errorChannelOpacity({ densityPressure: 1, boundaryPressure: 1 })],
      ["SHARED-CHURN-02", recencyWeightedChurn({ weightedChurn: 5 })],
    ]))

    expect(out.state).toBe("insufficient_evidence")
    expect(out.requiredFoundationMeasured).toBe(false)
    expect(out.availableFactorWeight).toBeGreaterThan(0.25)
    expect(Shared11TheoryEncodingIndex.score(out)).toBe(1)
    expect(Shared11TheoryEncodingIndex.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(out.explanation.rationale).toContain("required shared theory facts")
  })

  test("measured healthy foundation facts produce zero pressure while optionals stay missing", async () => {
    const out = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ state: "zero", scorePressure: 0 })],
      ["SHARED-09", contractFreshness({ state: "zero", scorePressure: 0 })],
    ]))

    expect(out.state).toBe("zero")
    expect(out.requiredFoundationMeasured).toBe(true)
    expect(out.theoryGapPressure).toBe(0)
    expect(out.theoryEncodingScore).toBe(1)
    expect(out.availableFactorWeight).toBeCloseTo(0.45)
    expect(out.inputFactStates).toMatchObject({
      machineFeedbackCoverage: "missing_optional",
      coverageFacts: "missing_optional",
      boundaryParserCoverage: "missing_optional",
      errorChannelOpacity: "missing_optional",
      recencyWeightedChurn: "missing_optional",
    })
    expect(Shared11TheoryEncodingIndex.diagnose(out)[0]).toMatchObject({
      severity: "info",
      message: "Theory encoding index is measured with no theory gaps.",
    })
  })

  test("combines foundation and optional facts into weighted theory pressure", async () => {
    const out = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ scorePressure: 0.5 })],
      ["SHARED-09", contractFreshness({ scorePressure: 0.25 })],
      ["SHARED-07", machineFeedback({ missingClassCount: 2 })],
      ["SHARED-COV-01", coverageFacts({ lines: 0.5, functions: 0.5, branches: 0.5, specFile: true })],
      ["TS-AD-04", boundaryParserCoverage({ findings: 2, covered: 2 })],
      ["TS-LD-09", errorChannelOpacity({ densityPressure: 0.2, boundaryPressure: 0.6 })],
      ["SHARED-CHURN-02", recencyWeightedChurn({ weightedChurn: 3 })],
    ]))

    expect(out.state).toBe("present")
    expect(out.requiredFoundationMeasured).toBe(true)
    expect(out.theoryGapPressure).toBeCloseTo(0.4295)
    expect(out.theoryEncodingScore).toBeCloseTo(0.5705)
    expect(out.gaps.map((gap) => gap.factorId)).toEqual([
      "domain-construction-control",
      "boundary-parser-coverage",
      "machine-feedback-coverage",
      "error-channel-opacity",
      "coverage-facts",
      "ai-churn-pressure",
      "contract-freshness",
    ])
    expect(out.explanation.primitiveInputs.find(
      (input) => input.id === "SHARED-10-domain-construction-control",
    )).toMatchObject({
      resolvedId: "SHARED-10",
      state: "present",
      normalizedValue: 0.5,
      rawValue: expect.objectContaining({
        constructs: [expect.objectContaining({
          declarationPath: "src/domain/order-id.ts",
          symbol: "OrderId",
        })],
      }),
    })
    expect(out.explanation.primitiveInputs.find(
      (input) => input.id === "SHARED-CHURN-02-recency-weighted-churn",
    )).toMatchObject({
      resolvedId: "SHARED-CHURN-02",
      normalizedValue: 0.6,
      rawValue: expect.objectContaining({
        topChurnFiles: [expect.objectContaining({ file: "src/domain/order-id.ts" })],
      }),
    })
    const propertySpec = out.factors.find((factor) => factor.id === "property-spec-presence")
    expect(propertySpec?.state).toBe("zero")
    const propertySpecEvidence = propertySpec?.evidence as {
      readonly constructionEvidence: ReadonlyArray<unknown>
      readonly contractContext: ReadonlyArray<unknown>
      readonly specLikeFiles: ReadonlyArray<string>
    }
    expect(propertySpecEvidence.constructionEvidence).toContainEqual(
      expect.objectContaining({ path: "src/domain/order-id.ts" }),
    )
    expect(propertySpecEvidence.contractContext).toContainEqual(
      expect.objectContaining({ artifactPath: "src/generated/client.ts" }),
    )
    expect(propertySpecEvidence.specLikeFiles).toEqual(["/repo/src/domain.spec.ts"])
  })

  test("unknown machine feedback evidence with no required classes is excluded", async () => {
    const out = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ scorePressure: 0 })],
      ["SHARED-09", contractFreshness({ scorePressure: 0 })],
      [
        "SHARED-07",
        machineFeedback({
          state: "unknown",
          requiredClasses: [],
          missingClassCount: 0,
          unknownClassCount: 0,
        }),
      ],
    ]))

    const machineFeedbackFactor = out.factors.find(
      (factor) => factor.id === "machine-feedback-coverage",
    )

    expect(out.state).toBe("zero")
    expect(machineFeedbackFactor?.state).toBe("unknown")
    expect(machineFeedbackFactor?.pressure).toBeUndefined()
    expect(out.gaps.map((gap) => gap.factorId)).not.toContain("machine-feedback-coverage")
  })

  test("unknown machine feedback evidence with configured classes is excluded", async () => {
    const out = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ scorePressure: 0 })],
      ["SHARED-09", contractFreshness({ scorePressure: 0 })],
      [
        "SHARED-07",
        machineFeedback({
          state: "unknown",
          requiredClasses: ["build", "test"],
          missingClassCount: 0,
          unknownClassCount: 0,
        }),
      ],
    ]))

    const machineFeedbackFactor = out.factors.find(
      (factor) => factor.id === "machine-feedback-coverage",
    )

    expect(out.state).toBe("zero")
    expect(machineFeedbackFactor?.state).toBe("unknown")
    expect(machineFeedbackFactor?.pressure).toBeUndefined()
    expect(out.gaps.map((gap) => gap.factorId)).not.toContain("machine-feedback-coverage")
  })

  test("property/spec presence does not count contract inventory or model filenames as evidence", async () => {
    const out = await run(new Map<string, unknown>([
      [
        "SHARED-10",
        domainConstruction({
          scorePressure: 1,
          withConstructionEvidence: false,
        }),
      ],
      ["SHARED-09", contractFreshness({ scorePressure: 0 })],
      [
        "SHARED-COV-01",
        coverageFacts({
          lines: 1,
          functions: 1,
          branches: 1,
          sourceFile: "/repo/src/model.ts",
        }),
      ],
    ]))

    const propertySpec = out.factors.find((factor) => factor.id === "property-spec-presence")
    const evidence = propertySpec?.evidence as {
      readonly evidenceCount: number
      readonly constructionEvidence: ReadonlyArray<unknown>
      readonly contractContext: ReadonlyArray<unknown>
      readonly specLikeFiles: ReadonlyArray<string>
    }

    expect(propertySpec?.state).toBe("present")
    expect(propertySpec?.pressure).toBe(1)
    expect(evidence.evidenceCount).toBe(0)
    expect(evidence.constructionEvidence).toEqual([])
    expect(evidence.contractContext).toContainEqual(
      expect.objectContaining({ artifactPath: "src/generated/client.ts" }),
    )
    expect(evidence.specLikeFiles).toEqual([])
  })

  test("unavailable optional coverage and churn facts do not dilute measured pressure", async () => {
    const base = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ scorePressure: 0.5 })],
      ["SHARED-09", contractFreshness({ scorePressure: 0.25 })],
    ]))
    const withUnavailableOptionals = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ scorePressure: 0.5 })],
      ["SHARED-09", contractFreshness({ scorePressure: 0.25 })],
      ["SHARED-COV-01", emptyCoverageFacts()],
      ["SHARED-CHURN-02", emptyRecencyWeightedChurn()],
    ]))
    const coverageFactor = withUnavailableOptionals.factors.find(
      (factor) => factor.id === "coverage-facts",
    )
    const churnFactor = withUnavailableOptionals.factors.find(
      (factor) => factor.id === "ai-churn-pressure",
    )

    expect(coverageFactor?.state).toBe("zero")
    expect(coverageFactor?.pressure).toBeUndefined()
    expect(churnFactor?.state).toBe("absent")
    expect(churnFactor?.pressure).toBeUndefined()
    expect(withUnavailableOptionals.availableFactorWeight).toBeCloseTo(
      base.availableFactorWeight,
    )
    expect(withUnavailableOptionals.theoryGapPressure).toBeCloseTo(
      base.theoryGapPressure,
    )
  })

  test("canonical input ids and aliases produce the same deterministic output", async () => {
    const canonical = await run(new Map<string, unknown>([
      ["SHARED-10-domain-construction-control", domainConstruction({ scorePressure: 0.5 })],
      ["SHARED-09-contract-freshness", contractFreshness({ scorePressure: 0.25 })],
      ["SHARED-07-machine-feedback-coverage", machineFeedback({ missingClassCount: 2 })],
      ["SHARED-COV-01-coverage-facts", coverageFacts({ lines: 0.5, functions: 0.5, branches: 0.5 })],
      ["TS-AD-04-boundary-parser-coverage", boundaryParserCoverage({ findings: 2, covered: 2 })],
      ["TS-LD-09-error-channel-opacity", errorChannelOpacity({ densityPressure: 0.2, boundaryPressure: 0.6 })],
      ["SHARED-CHURN-02-recency-weighted-churn", recencyWeightedChurn({ weightedChurn: 3 })],
    ]))
    const aliases = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ scorePressure: 0.5 })],
      ["SHARED-09", contractFreshness({ scorePressure: 0.25 })],
      ["SHARED-07", machineFeedback({ missingClassCount: 2 })],
      ["SHARED-COV-01", coverageFacts({ lines: 0.5, functions: 0.5, branches: 0.5 })],
      ["TS-AD-04", boundaryParserCoverage({ findings: 2, covered: 2 })],
      ["TS-LD-09", errorChannelOpacity({ densityPressure: 0.2, boundaryPressure: 0.6 })],
      ["SHARED-CHURN-02", recencyWeightedChurn({ weightedChurn: 3 })],
    ]))

    expect(aliasStableOutput(aliases)).toEqual(aliasStableOutput(canonical))
    expect(aliases.explanation.primitiveInputs.map((input) => input.resolvedId)).toEqual([
      "SHARED-10",
      "SHARED-09",
      "SHARED-07",
      "SHARED-COV-01",
      "TS-AD-04",
      "TS-LD-09",
      "SHARED-CHURN-02",
    ])
  })

  test("diagnostics are stable and capped by config", async () => {
    const out = await run(
      new Map<string, unknown>([
        ["SHARED-10", domainConstruction({ scorePressure: 0.5 })],
        ["SHARED-09", contractFreshness({ scorePressure: 0.25 })],
        ["SHARED-07", machineFeedback({ missingClassCount: 2 })],
      ]),
      {
        ...Shared11TheoryEncodingIndex.defaultConfig,
        top_n_diagnostics: 1,
        warn_threshold: 0.4,
      },
    )

    const diagnostics = Shared11TheoryEncodingIndex.diagnose(out)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("Domain construction control"),
    })
  })

  test("normalizes non-finite config and caps summary diagnostics", async () => {
    const out = await run(
      new Map<string, unknown>([
        ["SHARED-10", domainConstruction({ state: "not_configured" })],
        ["SHARED-09", contractFreshness({ state: "not_configured" })],
      ]),
      {
        top_n_diagnostics: Number.POSITIVE_INFINITY,
        warn_threshold: Number.NaN,
        min_available_factor_weight: Number.POSITIVE_INFINITY,
      },
    )

    expect(out.diagnosticLimit).toBe(0)
    expect(out.warnThreshold).toBe(0.35)
    expect(out.minAvailableFactorWeight).toBe(0.25)
    expect(out.requiredFoundationMeasured).toBe(false)
    expect(Shared11TheoryEncodingIndex.diagnose(out)).toEqual([])
  })

  test("is registered in the shared pack with the derived compound ceiling", async () => {
    const registered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-11"),
    )
    expect(registered?.id).toBe("SHARED-11-theory-encoding-index")
    expect(registered?.cacheVersion).toContain(
      Shared11TheoryEncodingIndex.cacheVersion,
    )

    const out = await run(new Map<string, unknown>([
      ["SHARED-10", domainConstruction({ state: "zero", scorePressure: 0 })],
      ["SHARED-09", contractFreshness({ state: "zero", scorePressure: 0 })],
    ]))
    const registry = await Effect.runPromise(buildRegistry(SHARED_SIGNALS))
    const registeredSignal = registry.byId.get("SHARED-11")
    if (registeredSignal === undefined) throw new Error("Theory encoding index is missing")

    expect(registeredSignal.enforcement).toEqual([
      "trend",
      "review-routing",
      "dashboard",
    ])
    expect(out.enforcementCeiling).toEqual(registeredSignal.enforcement)
    expect(out.explanation.enforcementCeiling).toEqual(registeredSignal.enforcement)
  })
})

const aliasStableOutput = (
  out: Awaited<ReturnType<typeof run>>,
) => ({
  state: out.state,
  inputFactStates: out.inputFactStates,
  availableFactorWeight: out.availableFactorWeight,
  evidenceCompleteness: out.evidenceCompleteness,
  theoryGapPressure: out.theoryGapPressure,
  theoryEncodingScore: out.theoryEncodingScore,
  gaps: out.gaps,
  factors: out.factors,
})

const domainConstruction = (args: {
  readonly state?: Shared10DomainConstructionControlOutput["state"]
  readonly scorePressure?: number
  readonly withConstructionEvidence?: boolean
}): Shared10DomainConstructionControlOutput => {
  const state = args.state ?? (args.scorePressure === 0 ? "zero" : "present")
  const weightedFindings = (args.scorePressure ?? 0) * 8
  const withConstructionEvidence = args.withConstructionEvidence ?? true
  const constructs: Shared10DomainConstructionControlOutput["constructs"] = state === "not_configured"
    ? []
    : [{
        constructId: "order-id",
        symbol: "OrderId",
        kind: "brand",
        declarationPath: "src/domain/order-id.ts",
        controlIntent: "controlled",
        sourceHashes: {},
        expectedSourceHashes: {},
        exportedDeclarationDetected: false,
        publicConstructorDetected: false,
        privateConstructorDetected: true,
        allowPublicConstructor: false,
        smartConstructors: withConstructionEvidence
          ? [{
              path: "src/domain/order-id.ts",
              symbol: "makeOrderId",
              present: true,
              matchedSymbol: true,
            }]
          : [],
        parsers: withConstructionEvidence
          ? [{
              path: "src/domain/order-id.ts",
              symbol: "parseOrderId",
              present: true,
              matchedSymbol: true,
            }]
          : [],
        controlledExports: [],
      }]
  const findings: Shared10DomainConstructionControlOutput["findings"] = weightedFindings > 0
    ? [{
        findingId: "order-id:missing-construction-evidence:src/domain/order-id.ts",
        constructId: "order-id",
        symbol: "OrderId",
        kind: "missing-construction-evidence",
        file: "src/domain/order-id.ts",
        severity: "warn",
        weight: weightedFindings,
        evidence: ["test finding"],
      }]
    : []
  return {
    state,
    checkedPaths: ["src/domain/order-id.ts"],
    constructs,
    findings,
    sourceFingerprint: "domain",
    topFindings: findings,
    scoreFindings: findings,
    totalFindings: findings.length,
    weightedFindings,
    maxWeightedFindings: 8,
    scorePressure: args.scorePressure ?? 0,
    diagnosticLimit: 10,
    configuredConstructCount: constructs.length,
    explicitlyOpenConstructCount: 0,
    controlledConstructCount: constructs.length,
    compositeConsumers: ["theory encoding index"],
    cacheContributors: ["test"],
    calibrationSurface: "test",
    evidenceClass: ["repo-owned manifest"],
    claimLimit: "test",
    nonClaimLimit: "test",
    knownFailureModes: [],
    enforcementCeiling: ["soft-warning"],
  }
}

const contractFreshness = (args: {
  readonly state?: Shared09ContractFreshnessOutput["state"]
  readonly scorePressure?: number
}): Shared09ContractFreshnessOutput => {
  const state = args.state ?? (args.scorePressure === 0 ? "zero" : "present")
  const weightedFindings = (args.scorePressure ?? 0) * 8
  const contracts: Shared09ContractFreshnessOutput["contracts"] = state === "not_configured"
    ? []
    : [{
        contractId: "api-client",
        groupId: "api",
        artifactPath: "src/generated/client.ts",
        sourcePaths: ["schema/openapi.yaml"],
        sourceHashes: {},
        expectedSourceHashes: {},
        artifactHash: "artifact",
        expectedArtifactHash: "artifact",
        generator: "openapi",
      }]
  const findings: Shared09ContractFreshnessOutput["findings"] = weightedFindings > 0
    ? [{
        findingId: "api-client:stale-artifact:src/generated/client.ts",
        contractId: "api-client",
        groupId: "api",
        kind: "stale-artifact",
        file: "src/generated/client.ts",
        sourceFile: "schema/openapi.yaml",
        artifactFile: "src/generated/client.ts",
        severity: "warn",
        weight: weightedFindings,
        evidence: ["test finding"],
      }]
    : []
  return {
    state,
    checkedPaths: ["schema/openapi.yaml", "src/generated/client.ts"],
    contracts,
    findings,
    sourceFingerprint: "contract",
    topFindings: findings,
    totalFindings: findings.length,
    weightedFindings,
    maxWeightedFindings: 8,
    scorePressure: args.scorePressure ?? 0,
    diagnosticLimit: 10,
    configuredContractCount: contracts.length,
    sourceFileCount: contracts.length,
    artifactFileCount: contracts.length,
    compositeConsumers: ["theory encoding index"],
    cacheContributors: ["test"],
    calibrationSurface: "test",
    evidenceClass: ["repo-owned manifest"],
    claimLimit: "test",
    nonClaimLimit: "test",
    knownFailureModes: [],
    enforcementCeiling: ["soft-warning"],
  }
}

const machineFeedback = (args: {
  readonly state?: Shared07MachineFeedbackCoverageOutput["state"]
  readonly requiredClasses?: Shared07MachineFeedbackCoverageOutput["requiredClasses"]
  readonly missingClassCount?: number
  readonly unknownClassCount?: number
}): Shared07MachineFeedbackCoverageOutput => ({
  state: args.state ?? "present",
  classes: [],
  configuredClassCount: 4 - (args.missingClassCount ?? 0),
  ciReachableClassCount: 0,
  missingClassCount: args.missingClassCount ?? 0,
  unknownClassCount: args.unknownClassCount ?? 0,
  sourceFingerprint: "feedback",
  requiredClasses: args.requiredClasses ?? ["build", "typecheck", "test", "static_analysis"],
  topDiagnostics: 10,
  compositeConsumers: ["theory encoding index"],
  cacheContributors: ["test"],
  calibrationSurface: "test",
  enforcementCeiling: ["soft-warning"],
})

const coverageFacts = (args: {
  readonly lines: number
  readonly functions: number
  readonly branches: number
  readonly specFile?: boolean
  readonly sourceFile?: string
}): SharedCov01CoverageFactsOutput => ({
  state: "present",
  checkedPaths: [],
  files: [
    {
      file: args.sourceFile ?? "/repo/src/domain.ts",
      lines: { covered: args.lines * 100, total: 100, pct: args.lines },
      functions: { covered: args.functions * 10, total: 10, pct: args.functions },
      branches: { covered: args.branches * 10, total: 10, pct: args.branches },
    },
    ...(args.specFile === true
      ? [{
          file: "/repo/src/domain.spec.ts",
          lines: { covered: 20, total: 20, pct: 1 },
          functions: { covered: 2, total: 2, pct: 1 },
          branches: { covered: 2, total: 2, pct: 1 },
        }]
      : []),
  ],
  summary: {
    lines: { covered: args.lines * 100, total: 100, pct: args.lines },
    functions: { covered: args.functions * 10, total: 10, pct: args.functions },
    branches: { covered: args.branches * 10, total: 10, pct: args.branches },
  },
  topDiagnostics: 10,
  compositeConsumers: ["theory encoding index"],
  cacheContributors: ["test"],
  calibrationSurface: "test",
  enforcementCeiling: ["trend"],
})

const emptyCoverageFacts = (): SharedCov01CoverageFactsOutput => ({
  state: "zero",
  checkedPaths: ["coverage/lcov.info"],
  files: [],
  summary: {
    lines: { covered: 0, total: 0, pct: 1 },
    functions: { covered: 0, total: 0, pct: 1 },
    branches: { covered: 0, total: 0, pct: 1 },
  },
  message: "Coverage report contains zero covered items",
  topDiagnostics: 10,
  compositeConsumers: ["theory encoding index"],
  cacheContributors: ["test"],
  calibrationSurface: "test",
  enforcementCeiling: ["trend"],
})

const boundaryParserCoverage = (args: {
  readonly findings: number
  readonly covered: number
}) => ({
  state: args.findings === 0 ? "zero" : "present",
  boundaryFilesMatched: 1,
  weakBoundaryFunctions: args.findings + args.covered,
  coveredWeakBoundaryFunctions: args.covered,
  findings: Array.from({ length: args.findings }, () => ({})),
})

const errorChannelOpacity = (args: {
  readonly densityPressure: number
  readonly boundaryPressure: number
}) => ({
  state: "present",
  totalFindings: 2,
  boundaryFindings: 1,
  weightedOpacity: 4,
  boundaryWeightedOpacity: 2,
  densityPressure: args.densityPressure,
  boundaryPressure: args.boundaryPressure,
})

const recencyWeightedChurn = (args: {
  readonly weightedChurn: number
}): SharedChurn02Output => ({
  byFile: new Map([[
    "src/domain/order-id.ts",
    {
      touchCount: 4,
      rawWindowChurn: 4,
      weightedChurn: args.weightedChurn,
      lastTouchedAt: "2026-05-16T12:00:00.000Z",
    },
  ]]),
  windowDays: 90,
  halfLifeDays: 14,
  totalCommits: 4,
  maxCommits: 500,
  sampled: false,
  topDiagnostics: 10,
  compositeConsumers: ["theory encoding index"],
  cacheContributors: ["test"],
  calibrationSurface: "test",
  enforcementCeiling: ["trend"],
})

const emptyRecencyWeightedChurn = (): SharedChurn02Output => ({
  byFile: new Map(),
  windowDays: 90,
  halfLifeDays: 14,
  totalCommits: 0,
  maxCommits: 500,
  sampled: false,
  topDiagnostics: 10,
  compositeConsumers: ["theory encoding index"],
  cacheContributors: ["test"],
  calibrationSurface: "test",
  enforcementCeiling: ["trend"],
})
