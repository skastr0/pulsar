import { describe, expect, test } from "bun:test"
import {
  Shared02BusFactor,
  Shared03ChurnRate,
  SharedChurn01,
  SharedChurn02,
  SharedCochange01,
} from "../index.js"
import { SHARED_SIGNALS } from "../pack.js"

describe("shared signal identity", () => {
  test("pack wrapper preserves signal-specific cache versions", () => {
    const churn01 = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-CHURN-01"),
    )
    const churn02 = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-CHURN-02"),
    )
    const cochange01 = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-COCHANGE-01"),
    )
    const busFactor = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-02"),
    )
    const churnRate = SHARED_SIGNALS.find((signal) =>
      signal.aliases?.includes("SHARED-03"),
    )

    expect(churn01?.cacheVersion).toContain(SharedChurn01.cacheVersion)
    expect(churn02?.cacheVersion).toContain(SharedChurn02.cacheVersion)
    expect(cochange01?.cacheVersion).toContain(SharedCochange01.cacheVersion)
    expect(busFactor?.cacheVersion).toContain(Shared02BusFactor.cacheVersion)
    expect(churnRate?.cacheVersion).toContain(Shared03ChurnRate.cacheVersion)
  })

  test("all shared signals expose semantic ids, aliases, and titles", () => {
    for (const signal of SHARED_SIGNALS) {
      expect(signal.id).toMatch(/^SHARED(?:-[A-Z]+)?-\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(signal.aliases?.[0]).toMatch(/^SHARED(?:-[A-Z]+)?-\d{2}$/)
      expect(signal.title).toBeTruthy()
    }
  })

  test("all shared signals expose config factor definitions", () => {
    for (const signal of SHARED_SIGNALS) {
      expect(signal.factorDefinitions?.some((factor) => factor.path.startsWith("config."))).toBe(true)
    }
  })

  test("all shared compound inputs declare cache fingerprints", () => {
    for (const signal of SHARED_SIGNALS.filter((signal) => signal.kind === "compound")) {
      for (const input of signal.inputs) {
        expect(typeof input.cacheFingerprint).toBe("string")
        expect(input.cacheFingerprint?.length).toBeGreaterThan(0)
      }
    }
  })
})
