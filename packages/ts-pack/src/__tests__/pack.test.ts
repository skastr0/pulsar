import { describe, expect, test } from "bun:test"
import { TS_PACK_SIGNALS } from "../pack.js"
import { TsAb01 } from "../signals/ts-ab-01-public-export-surface.js"
import { TsAb02 } from "../signals/ts-ab-02-unused-exports-reachability.js"
import { TsAb03 } from "../signals/ts-ab-03-type-indirection-depth.js"
import { TsAb04 } from "../signals/ts-ab-04-interface-impl-ratio.js"
import { TsAb05 } from "../signals/ts-ab-05-generic-proliferation.js"
import { TsAd02 } from "../signals/ts-ad-02-circular-deps.js"
import { TsAd03 } from "../signals/ts-ad-03-reexport-depth.js"
import { TsAd04 } from "../signals/ts-ad-04-boundary-parser-coverage.js"
import { TsAd05 } from "../signals/ts-ad-05-boundary-trust-breach.js"
import { TsDe01 } from "../signals/ts-de-01-type-level-coupling.js"
import { TsDe02 } from "../signals/ts-de-02-fan-in-out.js"
import { TsDe03 } from "../signals/ts-de-03-propagation-cost.js"
import { TsDe04 } from "../signals/ts-de-04-package-dependency-health.js"
import { TsDe05 } from "../signals/ts-de-05-duplicate-versions.js"
import { TsLd01 } from "../signals/ts-ld-01-complexity.js"
import { TsLd06 } from "../signals/ts-ld-06-annotation-coverage.js"
import { TsLd09 } from "../signals/ts-ld-09-error-channel-opacity.js"
import { TsRp01 } from "../signals/ts-rp-01-hotspots.js"
import { TsSl01 } from "../signals/ts-sl-01-duplication.js"
import { TsSl03 } from "../signals/ts-sl-03-suppressions.js"
import { TsSl04 } from "../signals/ts-sl-04-empty-implementations.js"

describe("TS pack cache versions", () => {
  test("pack wrapper preserves signal-specific cache versions", () => {
    const ad02 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AD-02"))
    const ad03 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AD-03"))
    const ad04 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AD-04"))
    const ad05 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AD-05"))
    const de01 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-DE-01"))
    const de02 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-DE-02"))
    const de03 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-DE-03"))
    const de04 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-DE-04"))
    const de05 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-DE-05"))
    const ld01 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-LD-01"))
    const ld06 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-LD-06"))
    const ld09 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-LD-09"))
    const rp01 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-RP-01"))
    const sl01 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-SL-01"))
    const sl03 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-SL-03"))
    const sl04 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-SL-04"))
    const ab01 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AB-01"))
    const ab02 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AB-02"))
    const ab03 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AB-03"))
    const ab04 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AB-04"))
    const ab05 = TS_PACK_SIGNALS.find((signal) => signal.aliases?.includes("TS-AB-05"))

    expect(ad02?.cacheVersion).toContain(TsAd02.cacheVersion)
    expect(ad03?.cacheVersion).toContain(TsAd03.cacheVersion)
    expect(ad04?.cacheVersion).toContain(TsAd04.cacheVersion)
    expect(ad05?.cacheVersion).toContain(TsAd05.cacheVersion)
    expect(de01?.cacheVersion).toContain(TsDe01.cacheVersion)
    expect(de02?.cacheVersion).toContain(TsDe02.cacheVersion)
    expect(de03?.cacheVersion).toContain(TsDe03.cacheVersion)
    expect(ab01?.cacheVersion).toContain(TsAb01.cacheVersion)
    expect(ab02?.cacheVersion).toContain(TsAb02.cacheVersion)
    expect(ab03?.cacheVersion).toContain(TsAb03.cacheVersion)
    expect(ab04?.cacheVersion).toContain(TsAb04.cacheVersion)
    expect(ab05?.cacheVersion).toContain(TsAb05.cacheVersion)
    expect(de04?.cacheVersion).toContain(TsDe04.cacheVersion)
    expect(de05?.cacheVersion).toContain(TsDe05.cacheVersion)
    expect(ld01?.cacheVersion).toContain(TsLd01.cacheVersion)
    expect(ld06?.cacheVersion).toContain(TsLd06.cacheVersion)
    expect(ld09?.cacheVersion).toContain(TsLd09.cacheVersion)
    expect(rp01?.cacheVersion).toContain(TsRp01.cacheVersion)
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
