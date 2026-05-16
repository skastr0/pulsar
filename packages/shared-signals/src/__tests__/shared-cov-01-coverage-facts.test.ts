import { describe, expect, test } from "bun:test"
import { ReferenceDataTag, makeReferenceData } from "@skastr0/pulsar-core/signal"
import {
  COVERAGE_REFERENCE_DATA_KEY,
  buildAbsentCoverageFacts,
  parseCoverageCandidate,
} from "@skastr0/pulsar-core/reference-data"
import { Effect, Layer } from "effect"
import { SharedCov01CoverageFacts } from "../shared-cov-01-coverage-facts.js"

const runCoverageSignal = async (entries: ReadonlyMap<string, unknown>) =>
  Effect.runPromise(
    SharedCov01CoverageFacts.compute(SharedCov01CoverageFacts.defaultConfig, new Map()).pipe(
      Effect.provide(Layer.succeed(ReferenceDataTag, makeReferenceData(entries))),
    ) as Effect.Effect<any, any, never>,
  )

describe("SHARED-COV-01 coverage facts", () => {
  test("emits present coverage facts from reference data", async () => {
    const facts = parseCoverageCandidate(
      "/repo",
      {
        relativePath: "coverage/lcov.info",
        content: ["SF:src/a.ts", "DA:1,1", "DA:2,0", "end_of_record"].join("\n"),
      },
      ["coverage/lcov.info"],
    )

    const out = await runCoverageSignal(new Map([[COVERAGE_REFERENCE_DATA_KEY, facts]]))
    expect(out.state).toBe("present")
    expect(out.summary.lines.pct).toBe(0.5)
    expect(out.compositeConsumers).toContain("risk hotspot")
  })

  test("distinguishes absent coverage from not configured reference data", async () => {
    const absent = await runCoverageSignal(
      new Map([[COVERAGE_REFERENCE_DATA_KEY, buildAbsentCoverageFacts(["coverage/lcov.info"])]]),
    )
    const notConfigured = await runCoverageSignal(new Map())

    expect(absent.state).toBe("absent")
    expect(notConfigured.state).toBe("not_configured")
  })
})
