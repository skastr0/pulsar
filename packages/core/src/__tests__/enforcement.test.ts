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
  const signal = (tier: 1 | 1.5 | 2 | 3, kind: "structural" | "legibility" | "compound") => ({
    tier,
    enforcement: deriveEnforcement(tier, kind),
  })

  test("tier-1 structural may set the headline alone", () => {
    expect(hasPoisonAuthority(signal(1, "structural"))).toBe(true)
  })

  test("tier-1 legibility may not — its ceiling cannot even gate a diff", () => {
    expect(hasPoisonAuthority(signal(1, "legibility"))).toBe(false)
  })

  test("tier-1.5 compound may not", () => {
    expect(hasPoisonAuthority(signal(1.5, "compound"))).toBe(false)
  })

  test("tier-2 structural may not — hard-gate-capable but not proof-grade", () => {
    expect(hasPoisonAuthority(signal(2, "structural"))).toBe(false)
  })

  test("tier 3 may not", () => {
    expect(hasPoisonAuthority(signal(3, "structural"))).toBe(false)
    expect(hasPoisonAuthority(signal(3, "legibility"))).toBe(false)
  })
})
