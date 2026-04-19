import { describe, expect, test } from "bun:test"
import {
  parseBypasses,
  toExpiredBypassDiagnostic,
} from "../bypass.js"

describe("taste-allow bypass parsing", () => {
  test("parses active and expired bypass comments", () => {
    const bypasses = parseBypasses(
      [
        "// taste-allow ENG-123 until:2099-01-01 migration in progress",
        "const a = 1",
        "// taste-allow ENG-124 until:2000-01-01 stale suppression",
      ].join("\n"),
      new Date("2026-04-19T00:00:00Z"),
    )

    expect(bypasses).toHaveLength(2)
    expect(bypasses[0]).toMatchObject({
      ticket: "ENG-123",
      status: "active",
      line: 1,
    })
    expect(bypasses[1]).toMatchObject({
      ticket: "ENG-124",
      status: "expired",
      line: 3,
    })
  })

  test("expired bypasses become block diagnostics with stable hashes", () => {
    const bypass = parseBypasses(
      "// taste-allow ENG-124 until:2000-01-01 stale suppression",
      new Date("2026-04-19T00:00:00Z"),
    )[0]!

    const diagnostic = toExpiredBypassDiagnostic("TS-AD-02", "src/a.ts", bypass)
    expect(diagnostic.severity).toBe("block")
    expect(diagnostic.message).toContain("Expired taste-allow ENG-124")
    expect(typeof diagnostic.data?.hash).toBe("string")
  })
})
