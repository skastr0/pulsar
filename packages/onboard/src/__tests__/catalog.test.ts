import { RS_PACK_SIGNALS } from "@skastr0/pulsar-rs-pack"
import { SHARED_SIGNALS } from "@skastr0/pulsar-shared-signals"
import { TS_PACK_SIGNALS } from "@skastr0/pulsar-ts-pack"
import { describe, expect, test } from "bun:test"
import { catalogById, loadCatalog } from "../catalog.js"
import { demoScan } from "../demo.js"
import type { CatalogEntry } from "../types.js"
import { normalizeSignalId } from "../util.js"

const REGISTERED_SIGNALS = [
  ...SHARED_SIGNALS,
  ...TS_PACK_SIGNALS,
  ...RS_PACK_SIGNALS,
]

const CATALOG_SIGNAL_ID_PATTERN = /^[A-Z]+(?:-[A-Z]+)*-\d+$/

const inspectCatalogIntegrity = (catalog: ReadonlyArray<CatalogEntry>) => {
  const canonicalIdByRegisteredIdentifier = new Map<string, string>()
  for (const signal of REGISTERED_SIGNALS) {
    for (const identifier of [signal.id, ...(signal.aliases ?? [])]) {
      canonicalIdByRegisteredIdentifier.set(identifier, signal.id)
    }
  }

  const invalidEntryIds: string[] = []
  const matchedCounts = new Map<string, number>()
  for (const entry of catalog) {
    const catalogId = normalizeSignalId(entry.id)
    const canonicalId = canonicalIdByRegisteredIdentifier.get(entry.id)
    if (!CATALOG_SIGNAL_ID_PATTERN.test(catalogId) || canonicalId === undefined) {
      invalidEntryIds.push(entry.id)
      continue
    }
    matchedCounts.set(canonicalId, (matchedCounts.get(canonicalId) ?? 0) + 1)
  }

  const duplicateSignalIds = [...matchedCounts]
    .filter(([, count]) => count > 1)
    .map(([id]) => id)
    .sort()
  const missingSignalIds = REGISTERED_SIGNALS
    .map((signal) => signal.id)
    .filter((id) => !matchedCounts.has(id))
    .sort()
  const resolvedCount = [...matchedCounts.values()].reduce((total, count) => total + count, 0)

  return {
    valid:
      catalog.length === REGISTERED_SIGNALS.length &&
      resolvedCount === REGISTERED_SIGNALS.length &&
      invalidEntryIds.length === 0 &&
      duplicateSignalIds.length === 0 &&
      missingSignalIds.length === 0,
    catalogCount: catalog.length,
    registryCount: REGISTERED_SIGNALS.length,
    resolvedCount,
    invalidEntryIds: invalidEntryIds.sort(),
    duplicateSignalIds,
    missingSignalIds,
  }
}

describe("onboarding catalog identity", () => {
  test("every catalog entry resolves to exactly one registered signal", () => {
    const report = inspectCatalogIntegrity(loadCatalog())

    expect(report).toEqual({
      valid: true,
      catalogCount: 74,
      registryCount: 74,
      resolvedCount: 74,
      invalidEntryIds: [],
      duplicateSignalIds: [],
      missingSignalIds: [],
    })
  })

  test("rejects a generated id that drifts from the registry contract", () => {
    const drifted = loadCatalog().map((entry) =>
      entry.id === "TS-SL-04"
        ? { ...entry, id: "ts-sl-04-onboarding-calibration" }
        : entry,
    )

    expect(inspectCatalogIntegrity(drifted)).toMatchObject({
      valid: false,
      catalogCount: 74,
      registryCount: 74,
      resolvedCount: 73,
      invalidEntryIds: ["ts-sl-04-onboarding-calibration"],
      missingSignalIds: ["TS-SL-04-unfinished-implementations"],
    })
  })

  test("rejects an undeclared uppercase suffix that normalizes to a registered alias", () => {
    const drifted = loadCatalog().map((entry) =>
      entry.id === "TS-SL-04"
        ? { ...entry, id: "TS-SL-04-UNREGISTERED-SUFFIX" }
        : entry,
    )

    expect(inspectCatalogIntegrity(drifted)).toMatchObject({
      valid: false,
      catalogCount: 74,
      registryCount: 74,
      resolvedCount: 73,
      invalidEntryIds: ["TS-SL-04-UNREGISTERED-SUFFIX"],
      missingSignalIds: ["TS-SL-04-unfinished-implementations"],
    })
  })

  test("the demo walk serves the bespoke TS-SL-04 catalog entry", async () => {
    const catalog = loadCatalog()
    const scan = await demoScan()
    const signal = scan.signals.find((item) => normalizeSignalId(item.id) === "TS-SL-04")
    const entry = signal === undefined
      ? undefined
      : catalogById(catalog).get(normalizeSignalId(signal.id))

    expect(signal).toBeDefined()
    expect(entry?.title).toBe("TS-SL-04 — Unfinished implementations")
    expect(entry?.question).toBe("What is true about unfinished implementations in this repo?")
    expect(entry?.question).not.toBe("What's true here?")
    expect(entry?.options).toHaveLength(4)
  })
})
