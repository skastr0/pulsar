import { describe, expect, test } from "bun:test"
import { TS_PACK_SIGNALS, TsAd02, TsDe04 } from "../pack.js"

describe("TS pack cache versions", () => {
  test("pack wrapper preserves signal-specific cache versions", () => {
    const ad02 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-AD-02")
    const de04 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-DE-04")

    expect(ad02?.cacheVersion).toContain(TsAd02.cacheVersion)
    expect(de04?.cacheVersion).toContain(TsDe04.cacheVersion)
  })
})
