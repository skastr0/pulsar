import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { TsLd05 } from "../signals/ts-ld-05-domain-term-consistency.js"
import { createTempRepo, runSignal, type TempRepo } from "./test-repo.js"

let repo: TempRepo
type TsLd05Result = Parameters<typeof TsLd05.score>[0]

const GLOSSARY = {
  schema_version: 1,
  extracted_at_sha: "HEAD",
  confirmed_at: "2026-04-19T00:00:00.000Z",
  terms: [
    { canonical: "order line", aliases: [], frequency: 3, provenance: [] },
    { canonical: "parse", aliases: [], frequency: 1, provenance: [] },
    { canonical: "value", aliases: [], frequency: 1, provenance: [] },
  ],
  rejected_terms: [],
}

beforeEach(async () => {
  repo = await createTempRepo("pulsar-ts-ld-05-")
})

afterEach(async () => {
  await repo.cleanup()
})

describe("TS-LD-05 (domain term consistency)", () => {
  test("classifies identifiers across all glossary drift cases", async () => {
    await repo.write(
      "src/terms.ts",
      [
        "export class OrderLine {}",
        "export class LineOrder {}",
        "export class OrdrLine {}",
        "export class TelemetryProbe {}",
        "",
      ].join("\n"),
    )

    const out = await runSignal(repo.root, TsLd05, TsLd05.defaultConfig, {
      glossary: GLOSSARY,
    })

    expect(out.referenceDataStatus).toBe("loaded")
    expect(out.identifiers.find((item) => item.name === "OrderLine")?.classification).toBe(
      "matches-glossary",
    )
    expect(out.identifiers.find((item) => item.name === "LineOrder")?.classification).toBe(
      "duplicates-canonical",
    )
    expect(out.identifiers.find((item) => item.name === "OrdrLine")?.classification).toBe(
      "conflicts-with-canonical",
    )
    expect(
      out.identifiers.find((item) => item.name === "TelemetryProbe")?.classification,
    ).toBe("new-unique")
    expect(out.identifiers.find((item) => item.name === "OrdrLine")?.suggestedCanonical).toBe(
      "order line",
    )
  })

  test("weights conflicts more harshly than novel but unique terms", () => {
    const conflictOutput: TsLd05Result = {
      identifiers: [
        {
          file: "src/terms.ts",
          line: 1,
          kind: "class",
          name: "OrdrLine",
          classification: "conflicts-with-canonical",
          suggestedCanonical: "order line",
        },
      ],
      totalIdentifiers: 1,
      matchCount: 0,
      newUniqueCount: 0,
      duplicateCount: 0,
      conflictCount: 1,
      referenceDataStatus: "loaded",
      diagnosticLimit: 10,
    }
    const newUniqueOutput: TsLd05Result = {
      ...conflictOutput,
      identifiers: [
        {
          file: "src/terms.ts",
          line: 1,
          kind: "class",
          name: "TelemetryProbe",
          classification: "new-unique",
          suggestedCanonical: undefined,
        },
      ],
      newUniqueCount: 1,
      conflictCount: 0,
    }

    expect(TsLd05.score(conflictOutput)).toBeLessThan(TsLd05.score(newUniqueOutput))
  })

  test("diagnostics honor top_n_diagnostics as a sanitized total cap", async () => {
    await repo.write(
      "src/terms.ts",
      [
        "export class LineOrder {}",
        "export class OrdrLine {}",
        "export class TelemetryProbe {}",
        "",
      ].join("\n"),
    )

    const fractional = await runSignal(repo.root, TsLd05, {
      ...TsLd05.defaultConfig,
      top_n_diagnostics: 1.8,
    }, {
      glossary: GLOSSARY,
    })
    const negative = await runSignal(repo.root, TsLd05, {
      ...TsLd05.defaultConfig,
      top_n_diagnostics: -1,
    }, {
      glossary: GLOSSARY,
    })
    const nanLimit = await runSignal(repo.root, TsLd05, {
      ...TsLd05.defaultConfig,
      top_n_diagnostics: Number.NaN,
    }, {
      glossary: GLOSSARY,
    })
    const infiniteLimit = await runSignal(repo.root, TsLd05, {
      ...TsLd05.defaultConfig,
      top_n_diagnostics: Infinity,
    }, {
      glossary: GLOSSARY,
    })

    expect(fractional.identifiers).toHaveLength(3)
    expect(fractional.diagnosticLimit).toBe(1)
    expect(TsLd05.diagnose(fractional)).toHaveLength(1)
    expect(negative.identifiers).toHaveLength(3)
    expect(negative.diagnosticLimit).toBe(0)
    expect(TsLd05.diagnose(negative)).toEqual([])
    expect(nanLimit.identifiers).toHaveLength(3)
    expect(nanLimit.diagnosticLimit).toBe(0)
    expect(TsLd05.diagnose(nanLimit)).toEqual([])
    expect(infiniteLimit.identifiers).toHaveLength(3)
    expect(infiniteLimit.diagnosticLimit).toBe(0)
    expect(TsLd05.diagnose(infiniteLimit)).toEqual([])
  })

  test("gracefully degrades when no glossary is configured", async () => {
    await repo.write("src/terms.ts", "export class TelemetryProbe {}\n")

    const out = await runSignal(repo.root, TsLd05, TsLd05.defaultConfig)

    expect(out.referenceDataStatus).toBe("missing")
    expect(TsLd05.score(out)).toBe(1)
    expect(TsLd05.diagnose(out)).toEqual([{ severity: "info", message: "no glossary configured" }])
  })
})
