import { describe, expect, test } from "bun:test"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RsAd01 } from "../signals/rs-ad-01-visibility-surface.js"

describe("RS pack signal identity", () => {
  test("pack wrapper preserves signal-specific cache versions", () => {
    const visibilitySurface = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-AD-01"),
    )

    expect(visibilitySurface?.cacheVersion).toBe(RsAd01.cacheVersion)
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
