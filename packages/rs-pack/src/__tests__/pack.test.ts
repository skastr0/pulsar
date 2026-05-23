import { describe, expect, test } from "bun:test"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RsAd01 } from "../signals/rs-ad-01-visibility-surface.js"
import { RsAd02 } from "../signals/rs-ad-02-crate-boundaries.js"
import { RsAd03 } from "../signals/rs-ad-03-circular-crate-deps.js"
import { RsDe01 } from "../signals/rs-de-01-trait-coupling.js"

describe("RS pack signal identity", () => {
  test("pack wrapper preserves signal-specific cache versions", () => {
    const visibilitySurface = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-AD-01"),
    )
    const crateBoundaries = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-AD-02"),
    )
    const circularCrateDependencies = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-AD-03"),
    )
    const traitCoupling = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-DE-01"),
    )

    expect(visibilitySurface?.cacheVersion).toBe(RsAd01.cacheVersion)
    expect(crateBoundaries?.cacheVersion).toBe(RsAd02.cacheVersion)
    expect(circularCrateDependencies?.cacheVersion).toBe(RsAd03.cacheVersion)
    expect(traitCoupling?.cacheVersion).toBe(RsDe01.cacheVersion)
  })

  test("all Rust signals expose semantic ids, aliases, and titles", () => {
    for (const signal of RS_PACK_SIGNALS) {
      expect(signal.id).toMatch(/^RS-[A-Z]{2}-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(signal.aliases?.[0]).toMatch(/^RS-[A-Z]{2}-\d{2}$/)
      expect(signal.title).toBeTruthy()
    }
  })

  test("all Rust signals expose config factor definitions", () => {
    for (const signal of RS_PACK_SIGNALS) {
      expect(signal.factorDefinitions?.some((factor) => factor.path.startsWith("config."))).toBe(true)
    }
  })

  test("all Rust compound inputs declare cache fingerprints", () => {
    for (const signal of RS_PACK_SIGNALS.filter((signal) => signal.kind === "compound")) {
      for (const input of signal.inputs) {
        expect(typeof input.cacheFingerprint).toBe("string")
        expect(input.cacheFingerprint?.length).toBeGreaterThan(0)
      }
    }
  })
})
