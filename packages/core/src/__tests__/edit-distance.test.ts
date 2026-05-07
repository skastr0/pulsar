import { describe, expect, test } from "bun:test"
import { levenshteinDistance } from "../edit-distance.js"

describe("levenshteinDistance", () => {
  test("computes stable edit distance for identifier token matching", () => {
    expect(levenshteinDistance("session", "session")).toBe(0)
    expect(levenshteinDistance("", "flow")).toBe(4)
    expect(levenshteinDistance("probe", "probes")).toBe(1)
    expect(levenshteinDistance("kernel", "session")).toBe(6)
  })
})
