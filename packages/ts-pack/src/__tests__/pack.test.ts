import { describe, expect, test } from "bun:test"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAb02 } from "../signals/ts-ab-02-unused-exports-reachability.js"
import { TsAd02 } from "../signals/ts-ad-02-circular-deps.js"
import { TsDe04 } from "../signals/ts-de-04-package-dependency-health.js"
import { TsLd01 } from "../signals/ts-ld-01-complexity.js"
import { TsSl01 } from "../signals/ts-sl-01-duplication.js"
import { TsSl03 } from "../signals/ts-sl-03-suppressions.js"
import { TsSl04 } from "../signals/ts-sl-04-empty-implementations.js"

describe("TS pack cache versions", () => {
  test("pack wrapper preserves signal-specific cache versions", () => {
    const ad02 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AD-02"))
    const de04 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-DE-04"))
    const ld01 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-LD-01"))
    const sl01 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-SL-01"))
    const sl03 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-SL-03"))
    const sl04 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-SL-04"))
    const ab02 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AB-02"))

    expect(ad02?.cacheVersion).toContain(TsAd02.cacheVersion)
    expect(ab02?.cacheVersion).toContain(TsAb02.cacheVersion)
    expect(de04?.cacheVersion).toContain(TsDe04.cacheVersion)
    expect(ld01?.cacheVersion).toContain(TsLd01.cacheVersion)
    expect(sl01?.cacheVersion).toContain(TsSl01.cacheVersion)
    expect(sl03?.cacheVersion).toContain(TsSl03.cacheVersion)
    expect(sl04?.cacheVersion).toContain(TsSl04.cacheVersion)
  })

  test("all TypeScript signals expose semantic ids, aliases, and titles", () => {
    for (const signal of TS_PACK_SIGNALS.filter((signal) => signal.id.startsWith("TS-"))) {
      expect(signal.id).toMatch(/^TS-[A-Z]{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(signal.aliases?.[0]).toMatch(/^TS-[A-Z]{2}-\d{2}$/)
      expect(signal.title).toBeTruthy()
    }
  })

  test("all TypeScript signals expose config factor definitions", () => {
    for (const signal of TS_PACK_SIGNALS.filter((signal) => signal.id.startsWith("TS-"))) {
      expect(signal.factorDefinitions?.some((factor) => factor.path.startsWith("config."))).toBe(true)
    }
  })

  test("all TypeScript compound inputs declare cache fingerprints", () => {
    const tsSignals = TS_PACK_SIGNALS.filter((signal) => signal.id.startsWith("TS-"))
    for (const signal of tsSignals.filter((signal) => signal.kind === "compound")) {
      for (const input of signal.inputs) {
        expect(typeof input.cacheFingerprint).toBe("string")
        expect(input.cacheFingerprint?.length).toBeGreaterThan(0)
      }
    }
  })
})
