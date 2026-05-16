import { describe, expect, test } from "bun:test"
import { summarize } from "@skastr0/pulsar-core/signal"
import { buildRegistry, runSignal } from "@skastr0/pulsar-core/scoring"
import { Effect } from "effect"
import { TsRp01 } from "../signals/ts-rp-01-hotspots.js"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import type {
  Shared02BusFactorOutput,
  SharedChurn01Output,
  SharedChurn02Output,
  SharedCochange01Output,
  SharedCov01CoverageFactsOutput,
} from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS } from "../pack.js"
import type { TsLd01Output } from "../signals/ts-ld-01-complexity.js"

const hotspotInputIds = [
  "TS-LD-01-cyclomatic-complexity",
  "SHARED-CHURN-01-recent-churn",
  "SHARED-CHURN-02-recency-weighted-churn",
  "SHARED-02-bus-factor",
  "SHARED-COV-01-coverage-facts",
  "SHARED-COCHANGE-01-logical-coupling",
] as const

const optionalHotspotInputIds = hotspotInputIds.slice(2)

const mockComplexityOut: TsLd01Output = {
  functions: [],
  calibrationDecisions: [],
  byFile: new Map([
    ["/repo/a.ts", summarize([5])],
    ["/repo/b.ts", summarize([25])],
    ["/repo/c.ts", summarize([15])],
    ["/repo/d.ts", summarize([30])],
  ]),
  overThresholdCount: 2,
  totalFunctions: 4,
  maxComplexity: 30,
  ratioPressure: 1,
  maxComplexityPressure: 1 / 3,
}

// Churn now emits absolute paths — aligned with ts-morph at produce time.
const mockChurnOut: SharedChurn01Output = {
  byFile: new Map([
    ["/repo/a.ts", 10],
    ["/repo/b.ts", 3],
    ["/repo/c.ts", 20],
    ["/repo/d.ts", 25],
  ]),
  windowDays: 90,
  totalCommits: 58,
}

const mockCompositeExplanation = {
  primitiveInputs: [],
  missingInputs: [],
  weights: [],
  finalScore: 1,
  rationale: "test fixture",
  enforcementCeiling: ["trend", "review-routing", "dashboard"] as const,
}

const coverageMetric = (covered: number, total: number) => ({
  covered,
  total,
  pct: total === 0 ? 1 : covered / total,
})

const mockWeightedChurnOut: SharedChurn02Output = {
  byFile: new Map([
    ["/repo/a.ts", {
      touchCount: 5,
      rawWindowChurn: 5,
      weightedChurn: 5,
      lastTouchedAt: "2026-05-16T00:00:00.000Z",
    }],
    ["/repo/b.ts", {
      touchCount: 5,
      rawWindowChurn: 5,
      weightedChurn: 5,
      lastTouchedAt: "2026-05-16T00:00:00.000Z",
    }],
  ]),
  windowDays: 90,
  halfLifeDays: 14,
  totalCommits: 10,
  maxCommits: 500,
  sampled: false,
  topDiagnostics: 10,
  compositeConsumers: ["risk hotspot"],
  cacheContributors: ["test"],
  calibrationSurface: "test fixture",
  enforcementCeiling: ["soft-warning", "trend"],
}

const mockOwnershipOut: Shared02BusFactorOutput = {
  byFile: new Map(),
  siloed: [{ file: "/repo/b.ts", author: "solo", loc: 200 }],
  distribution: summarize([1, 2]),
  windowDays: 180,
  maxCommits: 5000,
  touchedFileCount: 2,
  touchedLoc: 400,
  repoAuthors: ["peer", "solo"],
  effectiveSiloed: [
    {
      file: "/repo/b.ts",
      author: "solo",
      loc: 200,
      visible: true,
      severity: "warn",
      penaltyWeight: 0.8,
      factorPathPrefix: "bus_factor.repo_b",
      policyDecisions: [],
    },
  ],
  calibrationDecisions: [],
}

const mockCoverageOut: SharedCov01CoverageFactsOutput = {
  state: "present",
  tool: "lcov",
  checkedPaths: ["coverage/lcov.info"],
  files: [
    {
      file: "/repo/a.ts",
      lines: coverageMetric(10, 10),
      functions: coverageMetric(2, 2),
      branches: coverageMetric(2, 2),
    },
    {
      file: "/repo/b.ts",
      lines: coverageMetric(2, 10),
      functions: coverageMetric(1, 2),
      branches: coverageMetric(0, 2),
    },
  ],
  summary: {
    lines: coverageMetric(12, 20),
    functions: coverageMetric(3, 4),
    branches: coverageMetric(2, 4),
  },
  topDiagnostics: 10,
  compositeConsumers: ["risk hotspot"],
  cacheContributors: ["test"],
  calibrationSurface: "test fixture",
  enforcementCeiling: ["trend"],
}

const mockCochangeOut: SharedCochange01Output = {
  pairs: [
    {
      leftFile: "/repo/b.ts",
      rightFile: "/repo/support.ts",
      coChangeCount: 4,
      leftTouchCount: 4,
      rightTouchCount: 4,
      support: 0.4,
      confidence: 1,
      lastCoChangedAt: "2026-05-16T00:00:00.000Z",
    },
  ],
  byPair: new Map(),
  windowDays: 90,
  totalCommits: 10,
  maxCommits: 500,
  sampled: false,
  topDiagnostics: 10,
  compositeConsumers: ["risk hotspot"],
  cacheContributors: ["test"],
  calibrationSurface: "test fixture",
  enforcementCeiling: ["soft-warning", "trend"],
}

describe("TS-RP-01 (compound)", () => {
  test("combines churn and complexity into ranked hotspots", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    expect(out.totalFilesConsidered).toBe(4)
    expect(out.riskModel).toBe("legacy-churn-complexity")
    expect(out.inputFactStates).toEqual({
      recencyWeightedChurn: "not_configured",
      ownership: "not_configured",
      coverage: "not_configured",
      cochange: "not_configured",
    })
    expect(out.explanation.primitiveInputs.map((input) => input.id)).toEqual([
      ...hotspotInputIds,
    ])
    expect(out.explanation.missingInputs).toEqual([...optionalHotspotInputIds])
    expect(out.explanation.weights).toEqual([
      { id: "TS-LD-01-cyclomatic-complexity", weight: 0.5 },
      { id: "SHARED-CHURN-01-recent-churn", weight: 0.5 },
      { id: "SHARED-CHURN-02-recency-weighted-churn", weight: 0.25 },
      { id: "SHARED-02-bus-factor", weight: 0.15 },
      { id: "SHARED-COV-01-coverage-facts", weight: 0.15 },
      { id: "SHARED-COCHANGE-01-logical-coupling", weight: 0.1 },
    ])
    const expectedFinalScore =
      1 - Math.min(1, out.softTopRightShare + out.softTopRightPressure * 2)
    expect(out.explanation.finalScore).toBeCloseTo(expectedFinalScore, 12)
    expect(expectedFinalScore).toBeCloseTo(0.3218255807111624, 12)
    expect(TsRp01.score(out)).toBeCloseTo(expectedFinalScore, 12)
    expect(out.explanation).toMatchObject({
      missingInputs: [...optionalHotspotInputIds],
      rationale:
        "Ranks files by the composite pressure of recent churn and cyclomatic complexity.",
      enforcementCeiling: ["trend", "review-routing", "dashboard"],
    })
    expect(out.explanation.primitiveInputs[0]).toMatchObject({
      id: "TS-LD-01-cyclomatic-complexity",
      aliases: ["TS-LD-01"],
      optional: false,
      factorPath: "inputs.complexity",
      weight: 0.5,
      state: "present",
      resolvedId: "TS-LD-01",
      rawValue: {
        files: 4,
        totalFunctions: 4,
        maxComplexity: 30,
      },
      normalizedValue: 0.6,
    })
    expect(out.explanation.primitiveInputs[1]).toMatchObject({
      id: "SHARED-CHURN-01-recent-churn",
      aliases: ["SHARED-CHURN-01"],
      optional: false,
      factorPath: "inputs.churn",
      weight: 0.5,
      state: "present",
      resolvedId: "SHARED-CHURN-01",
      rawValue: {
        files: 4,
        totalCommits: 58,
        windowDays: 90,
      },
      normalizedValue: 25 / 90,
    })
    expect(out.hotspots[0]?.rank).toBe(1)
    expect(out.hotspots[0]?.hotspotScore).toBeGreaterThanOrEqual(
      out.hotspots[1]?.hotspotScore ?? 0,
    )
  })

  test("classifies quadrants around the median", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    const dHotspot = out.hotspots.find((h) => h.file === "/repo/d.ts")
    expect(dHotspot?.quadrant).toBe("top-right")
  })

  test("empty input history: score is neutral (1)", async () => {
    const inputs = new Map<string, unknown>([
      [
        "TS-LD-01",
        {
          functions: [],
          calibrationDecisions: [],
          byFile: new Map(),
          overThresholdCount: 0,
          totalFunctions: 0,
          maxComplexity: 0,
          ratioPressure: 0,
          maxComplexityPressure: 0,
        } satisfies TsLd01Output,
      ],
      [
        "SHARED-CHURN-01",
        {
          byFile: new Map(),
          windowDays: 90,
          totalCommits: 0,
        } satisfies SharedChurn01Output,
      ],
    ])
    const out = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    expect(out.totalFilesConsidered).toBe(0)
    expect(out.explanation.missingInputs).toEqual([...optionalHotspotInputIds])
    expect(TsRp01.score(out)).toBe(1)
  })

  test("missing required primitive inputs are explicit and neutral", async () => {
    const out = await Effect.runPromise(
      TsRp01.compute(TsRp01.defaultConfig, new Map<string, unknown>()),
    )
    expect(out.totalFilesConsidered).toBe(0)
    expect(out.explanation.missingInputs).toEqual([
      "TS-LD-01-cyclomatic-complexity",
      "SHARED-CHURN-01-recent-churn",
      ...optionalHotspotInputIds,
    ])
    expect(out.explanation.primitiveInputs.map((input) => input.state)).toEqual([
      "missing_required",
      "missing_required",
      "missing_optional",
      "missing_optional",
      "missing_optional",
      "missing_optional",
    ])
    expect(TsRp01.score(out)).toBe(1)
  })

  test("risk hotspot v2 ranks identical churn and complexity by ownership, coverage, and co-change risk", async () => {
    const equalComplexity: TsLd01Output = {
      functions: [],
      calibrationDecisions: [],
      byFile: new Map([
        ["/repo/a.ts", summarize([10])],
        ["/repo/b.ts", summarize([10])],
      ]),
      overThresholdCount: 2,
      totalFunctions: 2,
      maxComplexity: 10,
      ratioPressure: 1,
      maxComplexityPressure: 0.2,
    }
    const equalChurn: SharedChurn01Output = {
      byFile: new Map([
        ["/repo/a.ts", 5],
        ["/repo/b.ts", 5],
      ]),
      windowDays: 90,
      totalCommits: 10,
    }

    const out = await Effect.runPromise(
      TsRp01.compute(
        TsRp01.defaultConfig,
        new Map<string, unknown>([
          ["TS-LD-01", equalComplexity],
          ["SHARED-CHURN-01", equalChurn],
          ["SHARED-CHURN-02", mockWeightedChurnOut],
          ["SHARED-02", mockOwnershipOut],
          ["SHARED-COV-01", mockCoverageOut],
          ["SHARED-COCHANGE-01", mockCochangeOut],
        ]),
      ),
    )

    expect(out.riskModel).toBe("risk-hotspot-v2")
    expect(out.inputFactStates).toEqual({
      recencyWeightedChurn: "present",
      ownership: "present",
      coverage: "present",
      cochange: "present",
    })
    expect(out.hotspots[0]?.file).toBe("/repo/b.ts")
    expect(out.hotspots[0]).toMatchObject({
      ownershipRisk: 0.8,
      coverageGap: 0.8,
      cochangeRisk: 1,
      riskFactors: {
        ownership: 0.8,
        coverage: 0.8,
        cochange: 1,
      },
    })
    expect(out.hotspots[0]?.hotspotScore).toBeGreaterThan(
      out.hotspots[1]?.hotspotScore ?? 0,
    )
    expect(out.explanation.rationale).toContain("recency-weighted churn")
    expect(out.explanation.primitiveInputs.find(
      (input) => input.id === "SHARED-COV-01-coverage-facts",
    )?.rawValue).toMatchObject({ state: "present", lineCoverage: 0.6 })
    expect(TsRp01.score(out)).toBeLessThan(1)
  })

  test("risk hotspot v2 keeps risk-ranked output after the legacy stabilization window", async () => {
    const files = Array.from({ length: 13 }, (_, index) =>
      index === 0 ? "/repo/a.ts" : index === 1 ? "/repo/b.ts" : `/repo/c${index}.ts`
    )
    const equalComplexity: TsLd01Output = {
      functions: [],
      calibrationDecisions: [],
      byFile: new Map(files.map((file) => [file, summarize([10])] as const)),
      overThresholdCount: files.length,
      totalFunctions: files.length,
      maxComplexity: 10,
      ratioPressure: 1,
      maxComplexityPressure: 0.2,
    }
    const equalChurn: SharedChurn01Output = {
      byFile: new Map(files.map((file) => [file, 5] as const)),
      windowDays: 90,
      totalCommits: 10,
    }

    const out = await Effect.runPromise(
      TsRp01.compute(
        TsRp01.defaultConfig,
        new Map<string, unknown>([
          ["TS-LD-01", equalComplexity],
          ["SHARED-CHURN-01", equalChurn],
          ["SHARED-CHURN-02", mockWeightedChurnOut],
          ["SHARED-02", mockOwnershipOut],
          ["SHARED-COV-01", mockCoverageOut],
          ["SHARED-COCHANGE-01", mockCochangeOut],
        ]),
      ),
    )

    expect(out.riskModel).toBe("risk-hotspot-v2")
    expect(out.stabilizationWeight).toBe(0)
    expect(out.hotspots[0]?.file).toBe("/repo/b.ts")
    expect(out.riskFilesConsidered).toBe(files.length)
  })

  test("optional risk facts distinguish absent, unknown, zero, and not-applicable states", async () => {
    const optionalFacts = {
      recencyWeightedChurn: {
        ...mockWeightedChurnOut,
        byFile: new Map(),
      },
      ownership: {
        ...mockOwnershipOut,
        siloed: [],
        effectiveSiloed: [],
        touchedFileCount: 0,
        touchedLoc: 0,
      },
      cochange: {
        ...mockCochangeOut,
        pairs: [],
        byPair: new Map(),
      },
    }

    for (const coverageState of ["absent", "unknown"] as const) {
      const out = await Effect.runPromise(
        TsRp01.compute(
          TsRp01.defaultConfig,
          new Map<string, unknown>([
            ["TS-LD-01", mockComplexityOut],
            ["SHARED-CHURN-01", mockChurnOut],
            ["SHARED-CHURN-02", optionalFacts.recencyWeightedChurn],
            ["SHARED-02", optionalFacts.ownership],
            [
              "SHARED-COV-01",
              {
                ...mockCoverageOut,
                state: coverageState,
                files: [],
              } satisfies SharedCov01CoverageFactsOutput,
            ],
            ["SHARED-COCHANGE-01", optionalFacts.cochange],
          ]),
        ),
      )

      expect(out.riskModel).toBe("legacy-churn-complexity")
      expect(out.inputFactStates).toEqual({
        recencyWeightedChurn: "zero",
        ownership: "not_applicable",
        coverage: coverageState,
        cochange: "zero",
      })
      expect(out.explanation.primitiveInputs.find(
        (input) => input.id === "SHARED-COV-01-coverage-facts",
      )?.rawValue).toMatchObject({ state: coverageState })
    }
  })

  test("score is deterministic given the same output", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const outA = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    const outB = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    expect(TsRp01.score(outA)).toBe(TsRp01.score(outB))
  })

  test("changing top_n threshold does NOT change raw output", async () => {
    const inputs = new Map<string, unknown>([
      ["TS-LD-01", mockComplexityOut],
      ["SHARED-CHURN-01", mockChurnOut],
    ])
    const a = await Effect.runPromise(TsRp01.compute(TsRp01.defaultConfig, inputs))
    const b = await Effect.runPromise(
      TsRp01.compute({ ...TsRp01.defaultConfig, top_n: 3 }, inputs),
    )
    expect(a.hotspots.length).toBe(b.hotspots.length)
    expect(TsRp01.diagnose(b)).toHaveLength(3)
  })

  test("soft threshold pressure creates multiple score levels near small-repo cutoffs", async () => {
    const thresholdComplexity: TsLd01Output = {
      functions: [],
      calibrationDecisions: [],
      byFile: new Map([
        ["/repo/a.ts", summarize([4])],
        ["/repo/b.ts", summarize([5])],
        ["/repo/c.ts", summarize([6])],
        ["/repo/d.ts", summarize([7])],
      ]),
      overThresholdCount: 2,
      totalFunctions: 4,
      maxComplexity: 7,
      ratioPressure: 1,
      maxComplexityPressure: 3 / 7,
    }

    const variants: ReadonlyArray<SharedChurn01Output> = [
      {
        byFile: new Map([
          ["/repo/a.ts", 1],
          ["/repo/b.ts", 1],
          ["/repo/c.ts", 2],
          ["/repo/d.ts", 2],
        ]),
        windowDays: 90,
        totalCommits: 20,
      },
      {
        byFile: new Map([
          ["/repo/a.ts", 1],
          ["/repo/b.ts", 1],
          ["/repo/c.ts", 2],
          ["/repo/d.ts", 3],
        ]),
        windowDays: 90,
        totalCommits: 21,
      },
      {
        byFile: new Map([
          ["/repo/a.ts", 1],
          ["/repo/b.ts", 2],
          ["/repo/c.ts", 3],
          ["/repo/d.ts", 4],
        ]),
        windowDays: 90,
        totalCommits: 22,
      },
    ]

    const scores = await Promise.all(
      variants.map(async (variant) => {
        const out = await Effect.runPromise(
          TsRp01.compute(
            TsRp01.defaultConfig,
            new Map<string, unknown>([
              ["TS-LD-01", thresholdComplexity],
              ["SHARED-CHURN-01", variant],
            ]),
          ),
        )
        return TsRp01.score(out)
      }),
    )

    expect(new Set(scores.map((score) => score.toFixed(6))).size).toBeGreaterThan(2)
  })

  test("composition via registry: compound sees its inputs after topological sort", async () => {
    const fakeLeaf = {
      ...TsRp01,
      id: "TS-LD-01-cyclomatic-complexity" as const,
      aliases: ["TS-LD-01"],
      tier: 1 as const,
      kind: "legibility" as const,
      inputs: [],
      compute: () => Effect.succeed(mockComplexityOut as unknown),
      score: () => 1,
      diagnose: () => [],
    }
    const fakeChurn = {
      ...TsRp01,
      id: "SHARED-CHURN-01-recent-churn" as const,
      aliases: ["SHARED-CHURN-01"],
      tier: 1 as const,
      kind: "legibility" as const,
      inputs: [],
      compute: () => Effect.succeed(mockChurnOut as unknown),
      score: () => 1,
      diagnose: () => [],
    }
    const registry = await Effect.runPromise(
      buildRegistry([fakeLeaf as any, fakeChurn as any, TsRp01 as any]),
    )
    const result = await Effect.runPromise(
      runSignal(registry, "TS-RP-01") as Effect.Effect<any, any, never>,
    )
    expect(result.signalId).toBe("TS-RP-01-hotspots")
    expect((result.output as any).totalFilesConsidered).toBe(4)
  })

  test("mixed-pack registry canonicalizes composite inputs across shared and TypeScript packs", async () => {
    const registry = await Effect.runPromise(
      buildRegistry([...SHARED_SIGNALS, ...TS_PACK_SIGNALS]),
    )
    const resolved = registry.byId.get("TS-RP-01")

    expect(resolved?.id).toBe("TS-RP-01-hotspots")
    expect(resolved?.inputs).toMatchObject([
      {
        id: "TS-LD-01-cyclomatic-complexity",
        cacheFingerprint: expect.any(String),
      },
      {
        id: "SHARED-CHURN-01-recent-churn",
        cacheFingerprint: expect.any(String),
      },
      {
        id: "SHARED-CHURN-02-recency-weighted-churn",
        optional: true,
        cacheFingerprint: expect.any(String),
      },
      {
        id: "SHARED-02-bus-factor",
        optional: true,
        cacheFingerprint: expect.any(String),
      },
      {
        id: "SHARED-COV-01-coverage-facts",
        optional: true,
        cacheFingerprint: expect.any(String),
      },
      {
        id: "SHARED-COCHANGE-01-logical-coupling",
        optional: true,
        cacheFingerprint: expect.any(String),
      },
    ])
  })

  test("diagnostic hotspot labels stay contiguous when info hotspots are interleaved", () => {
    const diagnostics = TsRp01.diagnose({
      hotspots: [
        {
          file: "/repo/first.ts",
          churn: 10,
          complexity: 30,
          hotspotScore: 300,
          quadrant: "top-right",
          rank: 1,
        },
        {
          file: "/repo/info.ts",
          churn: 10,
          complexity: 2,
          hotspotScore: 200,
          quadrant: "top-left",
          rank: 2,
        },
        {
          file: "/repo/second.ts",
          churn: 8,
          complexity: 25,
          hotspotScore: 180,
          quadrant: "top-right",
          rank: 3,
        },
      ],
      diagnosticLimit: 3,
      totalFilesConsidered: 3,
      topRightShare: 2 / 3,
      topRightPressure: 0,
      medianChurn: 10,
      medianComplexity: 25,
      legacyFilesConsidered: 3,
      legacyTopRightShare: 2 / 3,
      softFilesConsidered: 3,
      softTopRightShare: 2 / 3,
      softTopRightPressure: 0,
      stabilizationWeight: 0,
      riskModel: "legacy-churn-complexity",
      riskFilesConsidered: 0,
      riskPressure: 0,
      inputFactStates: {
        recencyWeightedChurn: "not_configured",
        ownership: "not_configured",
        coverage: "not_configured",
        cochange: "not_configured",
      },
      explanation: mockCompositeExplanation,
    })

    expect(diagnostics.map((diagnostic) => diagnostic.message.split(":")[0])).toEqual([
      "Hotspot #1",
      "Hotspot #2",
      "Hotspot #3",
    ])
    expect(diagnostics.map((diagnostic) => diagnostic.location?.file)).toEqual([
      "/repo/first.ts",
      "/repo/second.ts",
      "/repo/info.ts",
    ])
    expect(diagnostics[1]?.data?.rank).toBe(3)
    expect(diagnostics[1]?.data?.diagnosticRank).toBe(2)
  })

  test("diagnostic messages use compact display paths but keep absolute locations", () => {
    const absoluteFile = "/tmp/work/repo/packages/app/src/provider/provider.ts"
    const diagnostics = TsRp01.diagnose({
      hotspots: [
        {
          file: absoluteFile,
          churn: 10,
          complexity: 30,
          hotspotScore: 300,
          quadrant: "top-right",
          rank: 1,
        },
      ],
      diagnosticLimit: 1,
      totalFilesConsidered: 1,
      topRightShare: 1,
      topRightPressure: 0,
      medianChurn: 10,
      medianComplexity: 30,
      legacyFilesConsidered: 1,
      legacyTopRightShare: 1,
      softFilesConsidered: 1,
      softTopRightShare: 1,
      softTopRightPressure: 0,
      stabilizationWeight: 0,
      riskModel: "legacy-churn-complexity",
      riskFilesConsidered: 0,
      riskPressure: 0,
      inputFactStates: {
        recencyWeightedChurn: "not_configured",
        ownership: "not_configured",
        coverage: "not_configured",
        cochange: "not_configured",
      },
      explanation: mockCompositeExplanation,
    })

    expect(diagnostics[0]?.message).toContain("packages/app/src/provider/provider.ts")
    expect(diagnostics[0]?.message).not.toContain("/tmp/work/repo")
    expect(diagnostics[0]?.location?.file).toBe(absoluteFile)
    expect(diagnostics[0]?.data?.displayFile).toBe("packages/app/src/provider/provider.ts")
  })
})
