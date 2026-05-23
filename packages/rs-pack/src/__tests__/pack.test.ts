import { describe, expect, test } from "bun:test"
import { RS_PACK_SIGNALS } from "../pack.js"
import { RsAd01 } from "../signals/rs-ad-01-visibility-surface.js"
import { RsAd02 } from "../signals/rs-ad-02-crate-boundaries.js"
import { RsAd03 } from "../signals/rs-ad-03-circular-crate-deps.js"
import { RsAb01 } from "../signals/rs-ab-01-unused-pub.js"
import { RsDe01 } from "../signals/rs-de-01-trait-coupling.js"
import { RsDe02 } from "../signals/rs-de-02-dep-tree.js"
import { RsDe03 } from "../signals/rs-de-03-feature-flags.js"
import { RsDe04 } from "../signals/rs-de-04-fan-in-fan-out.js"

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
    const unusedPublicItems = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-AB-01"),
    )
    const traitCoupling = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-DE-01"),
    )
    const dependencyTree = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-DE-02"),
    )
    const featureFlags = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-DE-03"),
    )
    const fanInFanOut = RS_PACK_SIGNALS.find((signal) =>
      signal.aliases?.includes("RS-DE-04"),
    )

    expect(visibilitySurface?.cacheVersion).toBe(RsAd01.cacheVersion)
    expect(crateBoundaries?.cacheVersion).toBe(RsAd02.cacheVersion)
    expect(circularCrateDependencies?.cacheVersion).toBe(RsAd03.cacheVersion)
    expect(unusedPublicItems?.cacheVersion).toBe(RsAb01.cacheVersion)
    expect(traitCoupling?.cacheVersion).toBe(RsDe01.cacheVersion)
    expect(dependencyTree?.cacheVersion).toBe(RsDe02.cacheVersion)
    expect(featureFlags?.cacheVersion).toBe(RsDe03.cacheVersion)
    expect(fanInFanOut?.cacheVersion).toBe(RsDe04.cacheVersion)
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
