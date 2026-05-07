import { describe, expect, test } from "bun:test"
import { deriveEnforcement } from "../enforcement.js"

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
