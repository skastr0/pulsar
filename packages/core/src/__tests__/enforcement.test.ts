import { describe, expect, test } from "bun:test"
import {
  deriveEnforcement,
  enforceSeverityCeiling,
  hasPoisonAuthority,
} from "../enforcement.js"

describe("deriveEnforcement", () => {
  test("Tier 1 structural → hard gate", () => {
    expect(deriveEnforcement(1, "structural")).toEqual(["hard-gate"])
  })

  test("Tier 1 legibility → soft warning + trend", () => {
    expect(deriveEnforcement(1, "legibility")).toEqual(["soft-warning", "trend"])
  })

  test("Tier 1.5 compound → trend + routing + dashboard", () => {
    expect(deriveEnforcement(1.5, "compound")).toEqual([
      "trend",
      "review-routing",
      "dashboard",
    ])
  })

  test("Tier 2 structural → hard gate", () => {
    expect(deriveEnforcement(2, "structural")).toEqual(["hard-gate"])
  })

  test("Tier 2 legibility → soft warning + trend", () => {
    expect(deriveEnforcement(2, "legibility")).toEqual(["soft-warning", "trend"])
  })

  test("Tier 3 legibility → soft warning only", () => {
    expect(deriveEnforcement(3, "legibility")).toEqual(["soft-warning"])
  })

  test("Tier 3 structural → never (empty)", () => {
    expect(deriveEnforcement(3, "structural")).toEqual([])
  })
})

describe("enforceSeverityCeiling", () => {
  test("hard-gate signals keep block severity untouched", () => {
    const diagnostics = [{ severity: "block" as const, message: "real violation" }]
    expect(enforceSeverityCeiling(["hard-gate"], diagnostics)).toBe(diagnostics)
  })

  test("non-gate signals get block downgraded to warn with an explicit note", () => {
    const capped = enforceSeverityCeiling(
      ["soft-warning", "trend"],
      [
        { severity: "block", message: "overclaimed finding" },
        { severity: "info", message: "context" },
      ],
    )
    expect(capped[0]?.severity).toBe("warn")
    expect(capped[0]?.message).toContain("severity capped to warn")
    expect(capped[1]).toEqual({ severity: "info", message: "context" })
  })

  test("non-gate signals without block findings pass through unchanged", () => {
    const diagnostics = [{ severity: "warn" as const, message: "plain warning" }]
    expect(enforceSeverityCeiling([], diagnostics)).toBe(diagnostics)
  })
})

describe("hasPoisonAuthority", () => {
  test("tier 1 may set the headline alone", () => {
    expect(hasPoisonAuthority({ tier: 1 })).toBe(true)
  })

  test("tier 1.5 may set the headline alone", () => {
    expect(hasPoisonAuthority({ tier: 1.5 })).toBe(true)
  })

  test("tier 2 may not — even though tier-2 structural can hard-gate", () => {
    expect(hasPoisonAuthority({ tier: 2 })).toBe(false)
  })

  test("tier 3 may not", () => {
    expect(hasPoisonAuthority({ tier: 3 })).toBe(false)
  })
})
