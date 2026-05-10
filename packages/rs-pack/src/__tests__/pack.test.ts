import { describe, expect, test } from "bun:test"
import { RS_PACK_SIGNALS } from "../pack.js"

describe("RS pack signal identity", () => {
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
})
