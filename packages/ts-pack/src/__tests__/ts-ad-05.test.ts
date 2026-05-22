import { describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAd05 } from "../signals/ts-ad-05-boundary-trust-breach.js"
import { TsAd04, type TsAd04Output } from "../signals/ts-ad-04-boundary-parser-coverage.js"
import type { TsLd07Output } from "../signals/ts-ld-07-unsafe-type-erosion.js"

const FILE = "/repo/src/api/user.ts"
const OTHER_FILE = "/repo/src/api/order.ts"

const run = (inputs: ReadonlyMap<string, unknown>, config = TsAd05.defaultConfig) =>
  Effect.runPromise(TsAd05.compute(config, inputs))

describe("TS-AD-05 (boundary trust breach)", () => {
  test("declares compound identity, inputs, and cache fingerprints", () => {
    expect(TsAd05).toMatchObject({
      id: "TS-AD-05-boundary-trust-breach",
      aliases: ["TS-AD-05"],
      category: "architectural-drift",
      kind: "compound",
      tier: 1.5,
      cacheVersion:
        "boundary-trust-breach-composite-policy-v1-diagnostic-limit-v1-warn-threshold-v1",
    })
    expect(TsAd05.inputs).toEqual([
      {
        id: "TS-AD-04-boundary-parser-coverage",
        cacheFingerprint: "ee0ea0ab51fc1be46f41035e0a9ffee05051d1f9991e0759c939802a65187cd2",
      },
      {
        id: "TS-LD-07-unsafe-type-erosion",
        optional: true,
        cacheFingerprint: "4ddd1fb5e4af15cb699d805fc71644f6a8a28f45cb776a93dc7c38959d7a5802",
      },
      {
        id: "TS-AD-01-boundary-violations",
        optional: true,
        cacheFingerprint: "ed99bd872127c060a410f4769ac6caed8fcaf321afe6f5e683eafb92d7d2be1c",
      },
      {
        id: "TS-LD-05-domain-term-consistency",
        optional: true,
        cacheFingerprint: "1120228bd6d2a95816abb89a2e94173b901ec07e93b69592f030ec981e3af95f",
      },
    ])
    expect(new Set(TsAd05.inputs?.map((input) => input.cacheFingerprint)).size).toBe(4)
  })

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsAd05.configSchema)(TsAd05.defaultConfig)

    expect(decoded.top_n_diagnostics).toBe(10)
    expect(decoded.warn_threshold).toBe(0.35)
  })

  test("reports insufficient evidence when required parser coverage is missing", async () => {
    const out = await run(new Map())

    expect(out.state).toBe("insufficient_evidence")
    expect(TsAd05.score(out)).toBe(1)
    expect(out.inputFactStates).toEqual({
      boundaryParserCoverage: "missing_required",
      unsafeTypeErosion: "missing_optional",
      boundaryViolations: "missing_optional",
      domainTermConsistency: "missing_optional",
    })
    expect(out.explanation.missingInputs).toEqual([
      "TS-AD-04-boundary-parser-coverage",
      "TS-LD-07-unsafe-type-erosion",
      "TS-AD-01-boundary-violations",
      "TS-LD-05-domain-term-consistency",
    ])
    expect(TsAd05.outputMetadata?.(out)).toEqual({
      applicability: "insufficient_evidence",
    })
  })

  test("reports insufficient evidence when parser coverage is absent or not configured", async () => {
    for (const state of ["absent", "not_configured"] as const) {
      const out = await run(new Map<string, unknown>([
        ["TS-AD-04", parserCoverage({ state, findings: [] })],
      ]))

      expect(out.state).toBe("insufficient_evidence")
      expect(out.inputFactStates.boundaryParserCoverage).toBe(state)
      expect(TsAd05.outputMetadata?.(out)).toEqual({
        applicability: "insufficient_evidence",
      })
      expect(TsAd05.score(out)).toBe(1)
    }
  })

  test("required parser coverage not_applicable remains measured neutral", async () => {
    const out = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ state: "not_applicable", findings: [] })],
    ]))

    expect(out.state).toBe("zero")
    expect(out.inputFactStates.boundaryParserCoverage).toBe("not_applicable")
    expect(out.availableFactorWeight).toBe(0.35)
    expect(out.evidenceCompleteness).toBe(0.35)
    expect(out.explanation.primitiveInputs[0]).toMatchObject({
      id: "TS-AD-04-boundary-parser-coverage",
      resolvedId: "TS-AD-04",
      state: "present",
      rawValue: {
        state: "not_applicable",
        weakBoundaryFunctions: 0,
        findings: 0,
        covered: 0,
      },
      normalizedValue: 0,
    })
    expect(TsAd05.outputMetadata?.(out)).toBeUndefined()
    expect(TsAd05.score(out)).toBe(1)
    expect(TsAd05.diagnose(out)).toEqual([])
  })

  test("ranks all-factor boundary breaches ahead of single-factor parser gaps", async () => {
    const out = await run(new Map<string, unknown>([
      [
        "TS-AD-04",
        parserCoverage({
          findings: [
            parserFinding(FILE, "POST"),
            parserFinding(OTHER_FILE, "POST"),
          ],
        }),
      ],
      ["TS-LD-07", unsafeTypes({ file: FILE, weight: 48 })],
      ["TS-AD-01", boundaryViolations({ file: FILE, violations: 1 })],
      ["TS-LD-05", domainTerms({ file: FILE, conflicts: 1 })],
    ]))

    expect(out.state).toBe("present")
    expect(out.breaches.map((breach) => breach.file)).toEqual([FILE, OTHER_FILE])
    expect(out.breaches[0]).toMatchObject({
      file: FILE,
      rank: 1,
      factors: {
        parserCoverage: 1,
        unsafeBoundaryTypes: 1,
        boundaryViolations: 1 / 3,
        domainLanguageDrift: 0.2,
      },
      evidence: {
        parserFindings: 1,
        unsafeBoundaryOccurrences: 1,
        boundaryViolations: 1,
        domainTermDrift: 1,
      },
    })
    expect(out.breaches[0]?.score).toBeGreaterThan(out.breaches[1]?.score ?? 0)
    expect(TsAd05.score(out)).toBeLessThan(1)
    expect(out.explanation.weights).toEqual([
      { id: "TS-AD-04-boundary-parser-coverage", weight: 0.35 },
      { id: "TS-LD-07-unsafe-type-erosion", weight: 0.3 },
      { id: "TS-AD-01-boundary-violations", weight: 0.25 },
      { id: "TS-LD-05-domain-term-consistency", weight: 0.1 },
    ])
    expect(out.explanation.primitiveInputs[0]).toMatchObject({
      id: "TS-AD-04-boundary-parser-coverage",
      resolvedId: "TS-AD-04",
      state: "present",
      normalizedValue: 1,
    })
    expect(out.explanation.finalScore).toBe(TsAd05.score(out))
    expect(out.explanation.rationale).toContain("Ranks boundary trust risk")
    expect(TsAd05.diagnose(out)[0]).toMatchObject({
      severity: "warn",
      message: expect.stringContaining("src/api/user.ts"),
      location: { file: FILE },
      data: expect.objectContaining({
        file: FILE,
        rank: 1,
        evidence: expect.objectContaining({
          parserFindings: 1,
          unsafeBoundaryOccurrences: 1,
          boundaryViolations: 1,
          domainTermDrift: 1,
        }),
      }),
    })
  })

  test("unsafe boundary types and boundary violations independently anchor breaches", async () => {
    const unsafeOnly = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ state: "zero", findings: [], covered: 1 })],
      ["TS-LD-07", unsafeTypes({ file: FILE, weight: 48 })],
    ]))
    const violationOnly = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ state: "zero", findings: [], covered: 1 })],
      ["TS-AD-01", boundaryViolations({ file: OTHER_FILE, violations: 1 })],
    ]))

    expect(unsafeOnly.state).toBe("present")
    expect(unsafeOnly.breaches).toHaveLength(1)
    expect(unsafeOnly.breaches[0]).toMatchObject({
      file: FILE,
      factors: {
        parserCoverage: 0,
        unsafeBoundaryTypes: 1,
      },
      evidence: {
        unsafeBoundaryOccurrences: 1,
        unsafeBoundaryWeight: 48,
      },
    })
    expect(Object.keys(unsafeOnly.breaches[0]?.evidence ?? {}).sort()).toEqual([
      "unsafeBoundaryOccurrences",
      "unsafeBoundaryWeight",
    ])
    expect(TsAd05.score(unsafeOnly)).toBeLessThan(1)

    expect(violationOnly.state).toBe("present")
    expect(violationOnly.breaches).toHaveLength(1)
    expect(violationOnly.breaches[0]).toMatchObject({
      file: OTHER_FILE,
      factors: {
        parserCoverage: 0,
        boundaryViolations: 1 / 3,
      },
      evidence: {
        boundaryViolations: 1,
      },
    })
    expect(Object.keys(violationOnly.breaches[0]?.evidence ?? {})).toEqual([
      "boundaryViolations",
    ])
    expect(TsAd05.score(violationOnly)).toBeLessThan(1)
  })

  test("canonical and alias input ids produce equivalent breach rankings", async () => {
    const payload = parserCoverage({
      findings: [parserFinding(FILE, "POST")],
    })
    const aliasOutput = await run(new Map<string, unknown>([
      ["TS-AD-04", payload],
    ]))
    const canonicalOutput = await run(new Map<string, unknown>([
      ["TS-AD-04-boundary-parser-coverage", payload],
    ]))

    expect(aliasOutput.state).toBe("present")
    expect(canonicalOutput.state).toBe("present")
    expect(canonicalOutput.breaches).toEqual(aliasOutput.breaches)
    expect(canonicalOutput.riskPressure).toBe(aliasOutput.riskPressure)
    expect(canonicalOutput.explanation.primitiveInputs[0]).toMatchObject({
      id: "TS-AD-04-boundary-parser-coverage",
      state: "present",
      normalizedValue: 1,
    })
  })

  test("parser coverage ratio changes breach pressure with other factors held constant", async () => {
    const lowParserGap = await run(new Map<string, unknown>([
      [
        "TS-AD-04",
        parserCoverage({
          findings: [parserFinding(FILE, "POST")],
          covered: 4,
        }),
      ],
      ["TS-LD-07", unsafeTypes({ file: FILE, weight: 24 })],
      ["TS-AD-01", boundaryViolations({ file: FILE, violations: 1 })],
    ]))
    const highParserGap = await run(new Map<string, unknown>([
      [
        "TS-AD-04",
        parserCoverage({
          findings: [
            parserFinding(FILE, "POST"),
            parserFinding(FILE, "PUT"),
            parserFinding(FILE, "PATCH"),
            parserFinding(FILE, "DELETE"),
            parserFinding(FILE, "OPTIONS"),
          ],
        }),
      ],
      ["TS-LD-07", unsafeTypes({ file: FILE, weight: 24 })],
      ["TS-AD-01", boundaryViolations({ file: FILE, violations: 1 })],
    ]))

    expect(lowParserGap.breaches[0]?.factors.parserCoverage).toBe(1 / 5)
    expect(highParserGap.breaches[0]?.factors.parserCoverage).toBe(1)
    expect(highParserGap.breaches[0]?.score).toBeGreaterThan(
      lowParserGap.breaches[0]?.score ?? 0,
    )
    expect(TsAd05.score(highParserGap)).toBeLessThan(TsAd05.score(lowParserGap))
  })

  test("measured zero inputs produce a neutral score and no breach diagnostics", async () => {
    const out = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ state: "zero", findings: [], covered: 1 })],
      ["TS-LD-07", unsafeTypes({ file: FILE, weight: 0, boundaryOccurrences: 0 })],
      ["TS-AD-01", boundaryViolations({ file: FILE, violations: 0 })],
      ["TS-LD-05", domainTerms({ file: FILE, conflicts: 0, duplicates: 0 })],
    ]))

    expect(out.state).toBe("zero")
    expect(out.breaches).toEqual([])
    expect(out.riskPressure).toBe(0)
    expect(TsAd05.score(out)).toBe(1)
    expect(TsAd05.diagnose(out)).toEqual([])
  })

  test("reference-data absence is explicit and not treated as measured zero", async () => {
    const out = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ state: "zero", findings: [], covered: 1 })],
      ["TS-AD-01", boundaryViolations({ file: FILE, violations: 0, referenceDataStatus: "missing" })],
      ["TS-LD-05", domainTerms({ file: FILE, conflicts: 0, referenceDataStatus: "missing" })],
    ]))

    expect(out.state).toBe("zero")
    expect(out.inputFactStates).toMatchObject({
      boundaryParserCoverage: "zero",
      unsafeTypeErosion: "missing_optional",
      boundaryViolations: "not_configured",
      domainTermConsistency: "not_configured",
    })
    expect(out.availableFactorWeight).toBe(0.35)
    expect(out.evidenceCompleteness).toBe(0.35)
    expect(out.explanation.primitiveInputs.find(
      (input) => input.id === "TS-AD-01-boundary-violations",
    )).toMatchObject({
      state: "present",
      rawValue: { state: "not_configured" },
    })
  })

  test("not-applicable optional inputs remain available without creating breaches", async () => {
    const out = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ state: "zero", findings: [], covered: 1 })],
      [
        "TS-LD-07",
        unsafeTypes({
          file: FILE,
          weight: 0,
          boundaryOccurrences: 0,
          analyzedFiles: 0,
          analyzedLines: 0,
        }),
      ],
      ["TS-AD-01", boundaryViolations({ file: FILE, violations: 0, totalImports: 0 })],
      ["TS-LD-05", domainTerms({ file: FILE, conflicts: 0, totalIdentifiers: 0 })],
    ]))

    expect(out.state).toBe("zero")
    expect(out.inputFactStates).toEqual({
      boundaryParserCoverage: "zero",
      unsafeTypeErosion: "not_applicable",
      boundaryViolations: "not_applicable",
      domainTermConsistency: "not_applicable",
    })
    expect(out.availableFactorWeight).toBeCloseTo(1)
    expect(out.evidenceCompleteness).toBeCloseTo(1)
    expect(out.breaches).toEqual([])
  })

  test("domain language drift alone does not produce a boundary breach", async () => {
    const out = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ state: "zero", findings: [], covered: 1 })],
      ["TS-LD-05", domainTerms({ file: FILE, conflicts: 3 })],
    ]))

    expect(out.inputFactStates.domainTermConsistency).toBe("present")
    expect(out.explanation.primitiveInputs.find(
      (input) => input.id === "TS-LD-05-domain-term-consistency",
    )?.normalizedValue).toBeGreaterThan(0)
    expect(out.state).toBe("zero")
    expect(out.breaches).toEqual([])
    expect(TsAd05.score(out)).toBe(1)
  })

  test("diagnostics are stable and capped by config", async () => {
    const out = await run(
      new Map<string, unknown>([
        [
          "TS-AD-04",
          parserCoverage({
            findings: [
              parserFinding(OTHER_FILE, "POST"),
              parserFinding(FILE, "POST"),
            ],
          }),
        ],
      ]),
      { ...TsAd05.defaultConfig, top_n_diagnostics: 1 },
    )

    expect(out.breaches.map((breach) => breach.file)).toEqual([OTHER_FILE, FILE])
    expect(TsAd05.diagnose(out)).toHaveLength(1)
  })

  test("diagnostics honor top_n_diagnostics as a sanitized breach cap", async () => {
    const inputs = new Map<string, unknown>([
      [
        "TS-AD-04",
        parserCoverage({
          findings: [
            parserFinding(FILE, "POST"),
            parserFinding(OTHER_FILE, "POST"),
            parserFinding("/repo/src/api/payment.ts", "POST"),
          ],
        }),
      ],
    ])
    const fractional = await run(inputs, {
      ...TsAd05.defaultConfig,
      top_n_diagnostics: 1.8,
    })
    const negative = await run(inputs, {
      ...TsAd05.defaultConfig,
      top_n_diagnostics: -1,
    })
    const nanLimit = await run(inputs, {
      ...TsAd05.defaultConfig,
      top_n_diagnostics: Number.NaN,
    })
    const infiniteLimit = await run(inputs, {
      ...TsAd05.defaultConfig,
      top_n_diagnostics: Infinity,
    })

    expect(fractional.breaches).toHaveLength(3)
    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsAd05.diagnose(fractional)).toHaveLength(1)
    expect(negative.breaches).toHaveLength(3)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsAd05.diagnose(negative)).toEqual([])
    expect(nanLimit.breaches).toHaveLength(3)
    expect(nanLimit.diagnosticLimit).toBe(0)
    expect(TsAd05.diagnose(nanLimit)).toEqual([])
    expect(infiniteLimit.breaches).toHaveLength(3)
    expect(infiniteLimit.diagnosticLimit).toBe(0)
    expect(TsAd05.diagnose(infiniteLimit)).toEqual([])
  })

  test("diagnostic severity follows warn_threshold without changing score", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ findings: [parserFinding(FILE, "POST")], covered: 4 })],
    ])
    const warnOutput = await run(inputs, {
      ...TsAd05.defaultConfig,
      warn_threshold: 0.1,
    })
    const infoOutput = await run(inputs, {
      ...TsAd05.defaultConfig,
      warn_threshold: 1.1,
    })

    expect(TsAd05.score(warnOutput)).toBe(TsAd05.score(infoOutput))
    expect(warnOutput.warnThreshold).toBe(0.1)
    expect(infoOutput.warnThreshold).toBe(1)
    expect(TsAd05.diagnose(warnOutput)[0]?.severity).toBe("warn")
    expect(TsAd05.diagnose(infoOutput)[0]?.severity).toBe("info")
  })

  test("warn_threshold is sanitized before diagnostic severity is derived", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ findings: [parserFinding(FILE, "POST")] })],
    ])
    const nanThreshold = await run(inputs, {
      ...TsAd05.defaultConfig,
      warn_threshold: Number.NaN,
    })
    const infiniteThreshold = await run(inputs, {
      ...TsAd05.defaultConfig,
      warn_threshold: Infinity,
    })
    const negativeThreshold = await run(inputs, {
      ...TsAd05.defaultConfig,
      warn_threshold: -1,
    })

    expect(nanThreshold.warnThreshold).toBe(TsAd05.defaultConfig.warn_threshold)
    expect(infiniteThreshold.warnThreshold).toBe(TsAd05.defaultConfig.warn_threshold)
    expect(negativeThreshold.warnThreshold).toBe(0)
    expect(TsAd05.diagnose(nanThreshold)[0]?.severity).toBe("warn")
    expect(TsAd05.diagnose(infiniteThreshold)[0]?.severity).toBe("warn")
    expect(TsAd05.diagnose(negativeThreshold)[0]?.severity).toBe("warn")
  })

  test("pack registration exposes identity, cache version, and config factor ledger", async () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-AD-05"),
    )
    const out = await run(new Map<string, unknown>([
      ["TS-AD-04", parserCoverage({ findings: [parserFinding(FILE, "POST")] })],
    ]))
    const factorLedger = registered?.factorLedger?.(out)

    expect(registered?.id).toBe("TS-AD-05-boundary-trust-breach")
    expect(registered?.title).toBe("Boundary trust breach")
    expect(registered?.cacheVersion).toContain(TsAd05.cacheVersion)
    expect(factorLedger?.signalId).toBe(TsAd05.id)
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
  })

  test("registry enforcement matches the declared composite ceiling", async () => {
    const out = await run(new Map<string, unknown>([
      [
        "TS-AD-04",
        parserCoverage({ findings: [parserFinding(FILE, "POST")] }),
      ],
    ]))
    const registry = await Effect.runPromise(buildRegistry([TsAd04, TsAd05]))
    const registered = registry.byId.get("TS-AD-05")
    if (registered === undefined) throw new Error("TS-AD-05 is missing from the registry")

    expect(registered.enforcement).toEqual(["trend", "review-routing", "dashboard"])
    expect(out.enforcementCeiling).toEqual(registered.enforcement)
    expect(out.explanation.enforcementCeiling).toEqual(registered.enforcement)
  })
})

const parserFinding = (file: string, symbol: string) => ({
  file,
  line: 1,
  symbol,
  weakParameters: [{
    name: "input",
    typeText: "unknown",
    reason: "unknown" as const,
  }],
  missingEvidence: "No parse/decode/schema/assertion call matched parser_call_patterns.",
})

const parserCoverage = (args: {
  readonly state?: TsAd04Output["state"]
  readonly findings?: TsAd04Output["findings"]
  readonly covered?: number
}): TsAd04Output => ({
  state: args.state ?? "present",
  boundaryFilesMatched: 1,
  boundaryFunctionsAnalyzed: Math.max(1, (args.findings?.length ?? 0) + (args.covered ?? 0)),
  weakBoundaryFunctions: (args.findings?.length ?? 0) + (args.covered ?? 0),
  coveredWeakBoundaryFunctions: args.covered ?? 0,
  findings: args.findings ?? [],
  covered: Array.from({ length: args.covered ?? 0 }, (_, index) => ({
    file: FILE,
    line: index + 1,
    symbol: `covered${index}`,
    parserEvidence: ["Schema.decodeUnknownSync(UserSchema)"],
    weakParameters: [{
      name: "input",
      typeText: "unknown",
      reason: "unknown" as const,
    }],
  })),
  diagnosticLimit: 10,
  compositeConsumers: ["boundary trust breach"],
  cacheContributors: ["test"],
  calibrationSurface: "test",
  enforcementCeiling: ["soft-warning"],
})

const unsafeTypes = (args: {
  readonly file: string
  readonly weight: number
  readonly boundaryOccurrences?: number
  readonly analyzedFiles?: number
  readonly analyzedLines?: number
}): TsLd07Output => {
  const boundaryOccurrences = args.boundaryOccurrences ?? 1
  const occurrences = boundaryOccurrences === 0
    ? []
    : [{
      findingId: "unsafe-1",
      file: args.file,
      line: 1,
      kind: "parameter" as const,
      target: "input",
      boundary: true,
      severity: "warn" as const,
      visible: true,
      baseWeight: args.weight,
      weight: args.weight,
    }]
  return {
    byFile: new Map([[args.file, {
      occurrences: occurrences.length,
      boundaryOccurrences,
      weightedUnsafe: args.weight,
      boundaryWeightedUnsafe: args.weight,
    }]]),
    occurrences,
    topOccurrences: occurrences,
    calibrationDecisions: [],
    totalOccurrences: occurrences.length,
    boundaryOccurrences,
    weightedUnsafe: args.weight,
    boundaryWeightedUnsafe: args.weight,
    analyzedFiles: args.analyzedFiles ?? 1,
    analyzedLines: args.analyzedLines ?? 100,
    densityPerKloc: args.weight,
    densityPressure: 0,
    boundaryPressure: args.weight / 48,
    densityThreshold: 10,
    boundaryThreshold: 48,
    diagnosticLimit: 10,
  }
}

const boundaryViolations = (args: {
  readonly file: string
  readonly violations: number
  readonly totalImports?: number
  readonly referenceDataStatus?: "loaded" | "missing"
}) => ({
  violations: Array.from({ length: args.violations }, () => ({
    fromFile: args.file,
  })),
  totalImports: args.totalImports ?? 6,
  referenceDataStatus: args.referenceDataStatus ?? "loaded",
})

const domainTerms = (args: {
  readonly file: string
  readonly conflicts: number
  readonly duplicates?: number
  readonly totalIdentifiers?: number
  readonly referenceDataStatus?: "loaded" | "missing"
}) => ({
  identifiers: [
    ...Array.from({ length: args.conflicts }, () => ({
      file: args.file,
      classification: "conflicts-with-canonical",
    })),
    ...Array.from({ length: args.duplicates ?? 0 }, () => ({
      file: args.file,
      classification: "duplicates-canonical",
    })),
  ],
  totalIdentifiers: args.totalIdentifiers ?? 10,
  duplicateCount: args.duplicates ?? 0,
  conflictCount: args.conflicts,
  referenceDataStatus: args.referenceDataStatus ?? "loaded",
})
