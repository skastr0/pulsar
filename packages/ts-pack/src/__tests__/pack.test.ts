import { describe, expect, test } from "bun:test"
import { TS_PACK_SIGNALS, TsAd02, TsDe04, TsLd01, TsSl01, TsSl03, TsSl04 } from "../pack.js"

describe("TS pack cache versions", () => {
  test("pack wrapper preserves signal-specific cache versions", () => {
    const ad02 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-AD-02")
    const de04 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-DE-04")
    const ld01 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-LD-01")
    const sl01 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-SL-01")
    const sl03 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-SL-03")
    const sl04 = TS_PACK_SIGNALS.find((signal) => signal.id === "TS-SL-04")

    expect(ad02?.cacheVersion).toContain(TsAd02.cacheVersion)
    expect(de04?.cacheVersion).toContain(TsDe04.cacheVersion)
    expect(ld01?.cacheVersion).toContain(TsLd01.cacheVersion)
    expect(sl01?.cacheVersion).toContain(TsSl01.cacheVersion)
    expect(sl03?.cacheVersion).toContain(TsSl03.cacheVersion)
    expect(sl04?.cacheVersion).toContain(TsSl04.cacheVersion)
  })
})
