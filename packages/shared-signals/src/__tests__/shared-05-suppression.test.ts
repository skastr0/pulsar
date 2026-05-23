import { describe, expect, test } from "bun:test"
import { buildRegistry } from "@skastr0/pulsar-core/scoring"
import { Effect, Schema } from "effect"
import { SHARED_SIGNALS } from "../pack.js"
import {
  Shared05Suppression,
  type Shared05SuppressionOutput,
} from "../shared-05-suppression.js"

const tsSuppressions = {
  suppressions: [{}],
  unjustifiedCount: 1,
  expiredCount: 0,
  missingJustificationCount: 1,
}

const tsExpiredSuppression = {
  suppressions: [{}],
  unjustifiedCount: 1,
  expiredCount: 1,
  missingJustificationCount: 0,
}

const tsJustifiedSuppression = {
  suppressions: [{}],
  unjustifiedCount: 0,
  expiredCount: 0,
  missingJustificationCount: 0,
}

const rsSuppressions = {
  suppressions: [{}],
  missingJustificationCount: 1,
  expiredJustificationCount: 0,
}

const rsExpiredSuppression = {
  suppressions: [{}],
  missingJustificationCount: 0,
  expiredJustificationCount: 1,
}

const rsJustifiedSuppression = {
  suppressions: [{}],
  missingJustificationCount: 0,
  expiredJustificationCount: 0,
}

const noRustSuppressions = {
  suppressions: [],
  missingJustificationCount: 0,
  expiredJustificationCount: 0,
}

const runSuppression = (
  inputs: ReadonlyMap<string, unknown>,
  config: Partial<typeof Shared05Suppression.defaultConfig> = {},
): Promise<Shared05SuppressionOutput> =>
  Effect.runPromise(
    Shared05Suppression.compute(
      { ...Shared05Suppression.defaultConfig, ...config },
      new Map(inputs),
    ) as Effect.Effect<Shared05SuppressionOutput, unknown, never>,
  )

describe("SHARED-05 suppression governance", () => {
  test("declares identity, compound inputs, config schema, cache, and factor ledger", async () => {
    const packRegistered = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-05"),
    )
    expect(packRegistered).toBeDefined()
    const registry = await Effect.runPromise(buildRegistry([packRegistered!]))
    const registered = registry.byId.get("SHARED-05")
    const decoded = Schema.decodeUnknownSync(Shared05Suppression.configSchema)(
      Shared05Suppression.defaultConfig,
    )
    const factorLedger = registered?.factorLedger?.({} as Shared05SuppressionOutput)

    expect(Shared05Suppression).toMatchObject({
      id: "SHARED-05-suppression-governance",
      title: "Suppression governance",
      aliases: ["SHARED-05"],
      tier: 1.5,
      category: "generated-slop",
      kind: "compound",
      cacheVersion: "single-language-applicability-v2-normalized-diagnostics",
    })
    expect(decoded).toEqual({ top_n_diagnostics: 10 })
    expect(Shared05Suppression.inputs).toEqual([
      {
        id: "TS-SL-03-suppressions",
        optional: true,
        cacheFingerprint: "shared-05-typescript-suppression-input-v1",
      },
      {
        id: "RS-SL-02-suppressions",
        optional: true,
        cacheFingerprint: "shared-05-rust-suppression-input-v1",
      },
    ])
    expect(registered?.id).toBe(Shared05Suppression.id)
    expect(registered?.cacheVersion).toContain(Shared05Suppression.cacheVersion)
    expect(registry.byId.get("SHARED-05")?.id).toBe(Shared05Suppression.id)
    expect(factorLedger?.entries).toContainEqual(
      expect.objectContaining({
        path: "config.top_n_diagnostics",
        value: 10,
        source: "signal-default",
        scoreRole: "threshold",
      }),
    )
  })

  test("stays score-neutral for single-language runs", async () => {
    const out = await runSuppression(new Map<string, unknown>([["TS-SL-03", tsSuppressions]]))

    expect(out.languageCount).toBe(1)
    expect(out.unjustifiedCount).toBe(1)
    expect(Shared05Suppression.score(out)).toBe(1)
    expect(Shared05Suppression.outputMetadata?.(out)?.applicability).toBe(
      "not_applicable",
    )
    expect(Shared05Suppression.diagnose(out).map((diagnostic) => diagnostic.severity)).toEqual([
      "info",
      "info",
    ])
  })

  test("stays score-neutral when another language pack has no suppressions", async () => {
    const out = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsSuppressions],
        ["RS-SL-02", noRustSuppressions],
      ]),
    )

    expect(out.languageCount).toBe(1)
    expect(out.unjustifiedCount).toBe(1)
    expect(Shared05Suppression.score(out)).toBe(1)
    expect(Shared05Suppression.outputMetadata?.(out)).toEqual({
      applicability: "not_applicable",
    })
    expect(Shared05Suppression.diagnose(out).map((diagnostic) => diagnostic.severity)).toEqual([
      "info",
      "info",
      "info",
    ])
  })

  test("applies governance pressure when suppressions span language packs", async () => {
    const out = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsSuppressions],
        ["RS-SL-02", rsSuppressions],
      ]),
    )

    expect(out.languageCount).toBe(2)
    expect(out.totalSuppressions).toBe(2)
    expect(out.unjustifiedCount).toBe(2)
    expect(out.missingJustificationCount).toBe(2)
    expect(out.expiredJustificationCount).toBe(0)
    expect(out.byLanguage).toEqual({
      typescript: {
        totalSuppressions: 1,
        unjustifiedCount: 1,
      },
      rust: {
        totalSuppressions: 1,
        unjustifiedCount: 1,
      },
    })
    expect(Shared05Suppression.outputMetadata?.(out)).toBeUndefined()
    expect(Shared05Suppression.score(out)).toBe(0.98)
    expect(Shared05Suppression.diagnose(out).map((diagnostic) => diagnostic.severity)).toEqual([
      "warn",
      "warn",
      "warn",
    ])
  })

  test("canonical input ids and aliases produce the same deterministic output", async () => {
    const canonical = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03-suppressions", tsSuppressions],
        ["RS-SL-02-suppressions", rsSuppressions],
      ]),
    )
    const aliases = await runSuppression(
      new Map<string, unknown>([
        ["RS-SL-02", rsSuppressions],
        ["TS-SL-03", tsSuppressions],
      ]),
    )

    expect(aliases).toEqual(canonical)
    expect(Shared05Suppression.score(aliases)).toBe(Shared05Suppression.score(canonical))
  })

  test("missing optional inputs and all-empty inputs are not applicable", async () => {
    const missing = await runSuppression(new Map())
    const empty = await runSuppression(
      new Map<string, unknown>([
        [
          "TS-SL-03",
          {
            suppressions: [],
            unjustifiedCount: 0,
            expiredCount: 0,
            missingJustificationCount: 0,
          },
        ],
        ["RS-SL-02", noRustSuppressions],
      ]),
    )

    expect(missing).toMatchObject({
      totalSuppressions: 0,
      languageCount: 0,
      unjustifiedCount: 0,
      topDiagnostics: 10,
    })
    expect(empty).toMatchObject({
      totalSuppressions: 0,
      languageCount: 0,
      unjustifiedCount: 0,
      byLanguage: {
        typescript: {
          totalSuppressions: 0,
          unjustifiedCount: 0,
        },
        rust: {
          totalSuppressions: 0,
          unjustifiedCount: 0,
        },
      },
    })
    expect(Shared05Suppression.score(missing)).toBe(1)
    expect(Shared05Suppression.outputMetadata?.(missing)).toEqual({
      applicability: "not_applicable",
    })
  })

  test("justified multi-language suppressions are applicable but lower governance score slightly", async () => {
    const out = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsJustifiedSuppression],
        ["RS-SL-02", rsJustifiedSuppression],
      ]),
    )

    expect(out.languageCount).toBe(2)
    expect(out.unjustifiedCount).toBe(0)
    expect(Shared05Suppression.outputMetadata?.(out)).toBeUndefined()
    expect(Shared05Suppression.score(out)).toBe(0.995)
    expect(Shared05Suppression.diagnose(out).map((diagnostic) => diagnostic.severity)).toEqual([
      "info",
      "info",
      "info",
    ])
  })

  test("expired suppressions carry more pressure than missing justifications", async () => {
    const missing = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsSuppressions],
        ["RS-SL-02", rsJustifiedSuppression],
      ]),
    )
    const expired = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsExpiredSuppression],
        ["RS-SL-02", rsJustifiedSuppression],
      ]),
    )
    const rustExpired = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsJustifiedSuppression],
        ["RS-SL-02", rsExpiredSuppression],
      ]),
    )

    expect(Shared05Suppression.score(expired)).toBeLessThan(
      Shared05Suppression.score(missing),
    )
    expect(Shared05Suppression.score(rustExpired)).toBe(Shared05Suppression.score(expired))
    expect(expired.expiredJustificationCount).toBe(1)
    expect(rustExpired.expiredJustificationCount).toBe(1)
  })

  test("normalizes diagnostic limits and caps ordered payloads", async () => {
    const out = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsSuppressions],
        ["RS-SL-02", rsSuppressions],
      ]),
      { top_n_diagnostics: 2.9 },
    )
    const hiddenNaN = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsSuppressions],
        ["RS-SL-02", rsSuppressions],
      ]),
      { top_n_diagnostics: Number.NaN },
    )
    const hiddenNegative = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsSuppressions],
        ["RS-SL-02", rsSuppressions],
      ]),
      { top_n_diagnostics: -1 },
    )
    const hiddenInfinity = await runSuppression(
      new Map<string, unknown>([
        ["TS-SL-03", tsSuppressions],
        ["RS-SL-02", rsSuppressions],
      ]),
      { top_n_diagnostics: Number.POSITIVE_INFINITY },
    )

    const diagnostics = Shared05Suppression.diagnose(out)

    expect(out.topDiagnostics).toBe(2)
    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]?.message).toContain("2 unjustified suppressions")
    expect(diagnostics[0]?.data).toMatchObject({
      totalSuppressions: 2,
      languageCount: 2,
      unjustifiedCount: 2,
      missingJustificationCount: 2,
      expiredJustificationCount: 0,
    })
    expect(diagnostics[1]?.message).toBe("TypeScript suppressions: 1 unjustified / 1 total")
    expect(diagnostics[1]?.data).toEqual({
      language: "typescript",
      totalSuppressions: 1,
      unjustifiedCount: 1,
    })
    expect(hiddenNaN.topDiagnostics).toBe(0)
    expect(hiddenNegative.topDiagnostics).toBe(0)
    expect(hiddenInfinity.topDiagnostics).toBe(0)
    expect(Shared05Suppression.diagnose(hiddenNaN)).toEqual([])
    expect(Shared05Suppression.diagnose(hiddenNegative)).toEqual([])
    expect(Shared05Suppression.diagnose(hiddenInfinity)).toEqual([])
  })
})
