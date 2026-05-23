import { describe, expect, test } from "bun:test"
import { ReferenceDataTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import {
  COVERAGE_REFERENCE_DATA_KEY,
  buildAbsentCoverageFacts,
  buildUnknownCoverageFacts,
  parseCoverageCandidate,
} from "@skastr0/pulsar-core/reference-data"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Layer, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import {
  SharedCov01CoverageFacts,
  type SharedCov01CoverageFactsOutput,
} from "../shared-cov-01-coverage-facts.js"

const runCoverageSignal = async (
  entries: ReadonlyMap<string, unknown>,
  config = SharedCov01CoverageFacts.defaultConfig,
) =>
  Effect.runPromise(
    SharedCov01CoverageFacts.compute(config, new Map()).pipe(
      Effect.provide(Layer.succeed(ReferenceDataTag, makeReferenceData(entries))),
    ) as Effect.Effect<SharedCov01CoverageFactsOutput, unknown, never>,
  )

describe("SHARED-COV-01 coverage facts", () => {
  test("declares identity, config, cache, pack registration, and factor ledger", async () => {
    const registry = await Effect.runPromise(buildRegistry(SHARED_SIGNALS))
    const registered = registry.byId.get("SHARED-COV-01")
    const decoded = Schema.decodeUnknownSync(SharedCov01CoverageFacts.configSchema)(
      SharedCov01CoverageFacts.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as SharedCov01CoverageFactsOutput)

    expect(SharedCov01CoverageFacts).toMatchObject({
      id: "SHARED-COV-01-coverage-facts",
      aliases: ["SHARED-COV-01"],
      title: "Coverage facts",
      tier: 2,
      category: "review-pain",
      kind: "legibility",
      cacheVersion: "reference-data-v3-unavailable-unmeasured-config",
      inputs: [],
    })
    expect(decoded).toEqual({ top_n_diagnostics: 10 })
    expect(registered?.id).toBe(SharedCov01CoverageFacts.id)
    expect(registered?.cacheVersion).toContain(SharedCov01CoverageFacts.cacheVersion)
    expect(registry.byId.get("SHARED-COV-01")?.id).toBe(SharedCov01CoverageFacts.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("emits present LCOV coverage facts from reference data", async () => {
    const facts = lcovFacts()
    const out = await runCoverageSignal(new Map([[COVERAGE_REFERENCE_DATA_KEY, facts]]))

    expect(out.state).toBe("present")
    expect(out.tool).toBe("lcov")
    expect(out.summary.lines.pct).toBe(0.5)
    expect(out.topDiagnostics).toBe(10)
    expect(out.cacheContributors).toContain("reference-data.coverage")
    expect(out.compositeConsumers).toContain("risk hotspot")
    expect(SharedCov01CoverageFacts.score(out)).toBe(1)
    expect(SharedCov01CoverageFacts.outputMetadata?.(out)).toBeUndefined()
    expect(SharedCov01CoverageFacts.diagnose(out)[0]).toMatchObject({
      severity: "info",
      message: "Coverage facts: present from /repo/coverage/lcov.info",
      data: {
        state: "present",
        sourcePath: "/repo/coverage/lcov.info",
        checkedPaths: ["coverage/lcov.info", "coverage/coverage-final.json"],
        lineCoverage: 0.5,
        files: 1,
      },
    })
  })

  test("emits present Istanbul coverage facts from reference data", async () => {
    const out = await runCoverageSignal(new Map([[COVERAGE_REFERENCE_DATA_KEY, istanbulFacts()]]))

    expect(out.state).toBe("present")
    expect(out.tool).toBe("istanbul")
    expect(out.summary).toEqual({
      lines: { covered: 1, total: 2, pct: 0.5 },
      functions: { covered: 0, total: 1, pct: 0 },
      branches: { covered: 1, total: 2, pct: 0.5 },
    })
    expect(SharedCov01CoverageFacts.outputMetadata?.(out)).toBeUndefined()
  })

  test("keeps parsed zero coverage measured instead of insufficient", async () => {
    const out = await runCoverageSignal(new Map([[COVERAGE_REFERENCE_DATA_KEY, zeroCoverageFacts()]]))

    expect(out.state).toBe("zero")
    expect(out.summary.lines).toEqual({ covered: 0, total: 1, pct: 0 })
    expect(out.message).toBe("Coverage report contains zero covered items")
    expect(SharedCov01CoverageFacts.score(out)).toBe(1)
    expect(SharedCov01CoverageFacts.outputMetadata?.(out)).toBeUndefined()
    expect(SharedCov01CoverageFacts.diagnose(out)[0]?.data).toMatchObject({
      state: "zero",
      message: "Coverage report contains zero covered items",
    })
  })

  test("distinguishes absent, unknown, and not configured reference data", async () => {
    const absent = await runCoverageSignal(
      new Map([[COVERAGE_REFERENCE_DATA_KEY, buildAbsentCoverageFacts(["coverage/lcov.info"])]]),
    )
    const unknown = await runCoverageSignal(new Map([[
      COVERAGE_REFERENCE_DATA_KEY,
      buildUnknownCoverageFacts(
        ["coverage/lcov.info", "coverage/coverage-final.json"],
        "Failed to parse coverage reference data: SyntaxError",
        "/repo/coverage/coverage-final.json",
      ),
    ]]))
    const notConfigured = await runCoverageSignal(new Map())

    expect(absent.state).toBe("absent")
    expect(unknown.state).toBe("unknown")
    expect(notConfigured.state).toBe("not_configured")
    expect(absent.summary.lines).toEqual({ covered: 0, total: 0, pct: 0 })
    expect(unknown.summary.lines).toEqual({ covered: 0, total: 0, pct: 0 })
    expect(notConfigured.summary.lines).toEqual({ covered: 0, total: 0, pct: 0 })
    expect(SharedCov01CoverageFacts.outputMetadata?.(absent)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(SharedCov01CoverageFacts.outputMetadata?.(unknown)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(SharedCov01CoverageFacts.outputMetadata?.(notConfigured)).toEqual({
      applicability: "insufficient_evidence",
    })
    expect(SharedCov01CoverageFacts.diagnose(unknown)[0]).toMatchObject({
      severity: "warn",
      message: "Coverage facts: unknown from /repo/coverage/coverage-final.json",
      data: {
        message: "Failed to parse coverage reference data: SyntaxError",
      },
    })
    expect(SharedCov01CoverageFacts.diagnose(absent)[0]?.data).toMatchObject({
      state: "absent",
      message: "No supported coverage report found",
      checkedPaths: ["coverage/lcov.info"],
    })
    expect(SharedCov01CoverageFacts.diagnose(notConfigured)[0]?.data).toMatchObject({
      state: "not_configured",
      message: "Coverage reference data was not loaded",
      checkedPaths: [],
    })
    expect(SharedCov01CoverageFacts.diagnose(absent)[0]?.data).not.toHaveProperty("lineCoverage")
    expect(SharedCov01CoverageFacts.diagnose(unknown)[0]?.data).not.toHaveProperty("lineCoverage")
    expect(SharedCov01CoverageFacts.diagnose(notConfigured)[0]?.data).not.toHaveProperty("lineCoverage")
  })

  test("normalizes diagnostic limits and caps diagnostics", async () => {
    const visible = await runCoverageSignal(
      new Map([[COVERAGE_REFERENCE_DATA_KEY, lcovFacts()]]),
      { top_n_diagnostics: 1.9 },
    )
    const hiddenNegative = await runCoverageSignal(
      new Map([[COVERAGE_REFERENCE_DATA_KEY, lcovFacts()]]),
      { top_n_diagnostics: -1 },
    )
    const hiddenNaN = await runCoverageSignal(
      new Map([[COVERAGE_REFERENCE_DATA_KEY, lcovFacts()]]),
      { top_n_diagnostics: Number.NaN },
    )
    const hiddenInfinity = await runCoverageSignal(
      new Map([[COVERAGE_REFERENCE_DATA_KEY, lcovFacts()]]),
      { top_n_diagnostics: Number.POSITIVE_INFINITY },
    )

    expect(visible.topDiagnostics).toBe(1)
    expect(SharedCov01CoverageFacts.diagnose(visible)).toHaveLength(1)
    expect(hiddenNegative.topDiagnostics).toBe(0)
    expect(hiddenNaN.topDiagnostics).toBe(0)
    expect(hiddenInfinity.topDiagnostics).toBe(0)
    expect(SharedCov01CoverageFacts.diagnose(hiddenNegative)).toEqual([])
    expect(SharedCov01CoverageFacts.diagnose(hiddenNaN)).toEqual([])
    expect(SharedCov01CoverageFacts.diagnose(hiddenInfinity)).toEqual([])
  })
})

const lcovFacts = () =>
  parseCoverageCandidate(
    "/repo",
    {
      relativePath: "coverage/lcov.info",
      content: [
        "TN:",
        "SF:src/a.ts",
        "FN:1,main",
        "FNDA:1,main",
        "DA:1,1",
        "DA:2,0",
        "BRDA:1,0,0,1",
        "BRDA:1,0,1,0",
        "end_of_record",
      ].join("\n"),
    },
    ["coverage/lcov.info", "coverage/coverage-final.json"],
  )

const istanbulFacts = () =>
  parseCoverageCandidate(
    "/repo",
    {
      relativePath: "coverage/coverage-final.json",
      content: JSON.stringify({
        "src/a.ts": {
          path: "src/a.ts",
          s: { "0": 1, "1": 0 },
          f: { "0": 0 },
          b: { "0": [1, 0] },
        },
      }),
    },
    ["coverage/lcov.info", "coverage/coverage-final.json"],
  )

const zeroCoverageFacts = () =>
  parseCoverageCandidate(
    "/repo",
    {
      relativePath: "coverage/lcov.info",
      content: [
        "SF:src/a.ts",
        "DA:1,0",
        "FNDA:0,main",
        "BRDA:1,0,0,0",
        "end_of_record",
      ].join("\n"),
    },
    ["coverage/lcov.info"],
  )
