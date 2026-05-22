import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { TS_PACK_SIGNALS } from "../pack.js"
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
  test("empty repo with glossary has no identifiers and scores neutral", async () => {
    const out = await runSignal(repo.root, TsLd05, TsLd05.defaultConfig, {
      glossary: GLOSSARY,
    })

    expect(out.referenceDataStatus).toBe("loaded")
    expect(out.totalIdentifiers).toBe(0)
    expect(out.identifiers).toEqual([])
    expect(TsLd05.score(out)).toBe(1)
    expect(TsLd05.diagnose(out)).toEqual([])
  })

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
    expect(out).toMatchObject({
      totalIdentifiers: 4,
      matchCount: 1,
      newUniqueCount: 1,
      duplicateCount: 1,
      conflictCount: 1,
    })
    expect(TsLd05.score(out)).toBeCloseTo(0.6125)

    const diagnostics = TsLd05.diagnose(out)
    expect(diagnostics).toHaveLength(3)
    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
      "info",
      "warn",
      "info",
    ])
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        message:
          "Identifier `LineOrder` classified as duplicates-canonical (suggested canonical: order line)",
        location: expect.objectContaining({
          file: expect.stringContaining("src/terms.ts"),
        }),
        data: expect.objectContaining({
          name: "LineOrder",
          classification: "duplicates-canonical",
          suggestedCanonical: "order line",
        }),
      }),
    )
    expect(diagnostics).toContainEqual(
      expect.objectContaining({
        message:
          "Identifier `OrdrLine` classified as conflicts-with-canonical (suggested canonical: order line)",
        severity: "warn",
        data: expect.objectContaining({
          name: "OrdrLine",
          classification: "conflicts-with-canonical",
          suggestedCanonical: "order line",
        }),
      }),
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

  test("configSchema decodes defaults round-trip", () => {
    const decoded = Schema.decodeUnknownSync(TsLd05.configSchema)(TsLd05.defaultConfig)

    expect(decoded.top_n_diagnostics).toBe(20)
    expect(decoded.exclude_globs).toContain("**/*.test.ts")
  })

  test("pack registration exposes identity, cache version, and config factor ledger", async () => {
    await repo.write("src/terms.ts", "export class OrderLine {}\n")
    const registered = registeredTsLd05()
    const out = await runSignal(repo.root, TsLd05, TsLd05.defaultConfig, {
      glossary: GLOSSARY,
    })
    const factorLedger = registered.factorLedger?.(out)

    expect(registered.id).toBe("TS-LD-05-domain-term-consistency")
    expect(registered.aliases).toContain("TS-LD-05")
    expect(registered.title).toBe("Domain term consistency")
    expect(registered.cacheVersion).toContain(TsLd05.cacheVersion)
    expect(factorLedger?.signalId).toBe(TsLd05.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 20,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
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
    expect(TsLd05.outputMetadata?.(out)).toEqual({ applicability: "insufficient_evidence" })
    expect(TsLd05.score(out)).toBe(1)
    expect(TsLd05.diagnose(out)).toEqual([{ severity: "info", message: "no glossary configured" }])
  })
})

const registeredTsLd05 = () => {
  const signal = TS_PACK_SIGNALS.find((candidate) => candidate.id === TsLd05.id)
  if (signal === undefined) throw new Error("TS-LD-05 is not registered")
  return signal
}
