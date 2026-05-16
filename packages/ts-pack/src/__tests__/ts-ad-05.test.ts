import { describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"
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
      cacheVersion: "boundary-trust-breach-composite-policy-v1",
    })
    expect(TsAd05.inputs?.map((input) => input.id)).toEqual([
      "TS-AD-04-boundary-parser-coverage",
      "TS-LD-07-unsafe-type-erosion",
      "TS-AD-01-boundary-violations",
      "TS-LD-05-domain-term-consistency",
    ])
    expect(TsAd05.inputs?.every((input) => (input.cacheFingerprint ?? "").length > 0)).toBe(true)
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
    expect(TsAd05.diagnose(out)[0]).toMatchObject({
      severity: "warn",
      location: { file: FILE },
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
    expect(out.explanation.primitiveInputs.find(
      (input) => input.id === "TS-AD-01-boundary-violations",
    )).toMatchObject({
      state: "present",
      rawValue: { state: "not_configured" },
    })
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

  test("is registered in the TypeScript pack", () => {
    const registered = TS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("TS-AD-05"),
    )
    expect(registered?.id).toBe("TS-AD-05-boundary-trust-breach")
    expect(registered?.cacheVersion).toContain(TsAd05.cacheVersion)
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
    analyzedFiles: 1,
    analyzedLines: 100,
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
  readonly referenceDataStatus?: "loaded" | "missing"
}) => ({
  violations: Array.from({ length: args.violations }, () => ({
    fromFile: args.file,
  })),
  totalImports: 6,
  referenceDataStatus: args.referenceDataStatus ?? "loaded",
})

const domainTerms = (args: {
  readonly file: string
  readonly conflicts: number
  readonly duplicates?: number
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
  totalIdentifiers: 10,
  duplicateCount: args.duplicates ?? 0,
  conflictCount: args.conflicts,
  referenceDataStatus: args.referenceDataStatus ?? "loaded",
})
