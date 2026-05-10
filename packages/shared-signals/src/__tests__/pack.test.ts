import { describe, expect, test } from "bun:test"
import { SHARED_SIGNALS } from "../pack.js"

describe("shared signal identity", () => {
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
})
