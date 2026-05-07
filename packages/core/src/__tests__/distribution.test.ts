import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import {
  DistributionalSummary,
  emptySummary,
  summarize,
} from "../distribution.js"

describe("DistributionalSummary", () => {
  test("summarize empty array returns neutral summary", () => {
    expect(summarize([])).toEqual(emptySummary)
  })

  test("summarize single value", () => {
    const s = summarize([42])
    expect(s.max).toBe(42)
    expect(s.avg).toBe(42)
    expect(s.sum).toBe(42)
    expect(s.count).toBe(1)
  })

  test("summarize ordered population — max, avg, sum, count", () => {
    const s = summarize([1, 2, 3, 4, 5])
    expect(s.max).toBe(5)
    expect(s.avg).toBe(3)
    expect(s.sum).toBe(15)
    expect(s.count).toBe(5)
  })

  test("max is independent of input ordering", () => {
    const a = summarize([3, 1, 4, 1, 5, 9, 2, 6])
    const b = summarize([9, 6, 5, 4, 3, 2, 1, 1])
    expect(a.max).toBe(b.max)
    expect(a.avg).toBe(b.avg)
  })

  test("p95 sits above avg in a skewed distribution", () => {
    // Eighteen 1s plus two 100s — long right tail.
    // avg near 11; p95 should cross into the tail; max is 100.
    const values = [...new Array(18).fill(1), 100, 100]
    const s = summarize(values)
    expect(s.max).toBe(100)
    expect(s.p95).toBeGreaterThan(s.avg)
    expect(s.avg).toBeLessThan(15)
  })

  test("round-trips through Schema", () => {
    const s = summarize([10, 20, 30])
    const encoded = Schema.encodeSync(DistributionalSummary)(s)
    const decoded = Schema.decodeSync(DistributionalSummary)(encoded)
    expect(decoded).toEqual(s)
  })

  test("exposing max distinguishes peak-complexity files from low-avg siblings", () => {
    // File A: 20 small helpers (avg ~1). File B: one 119-complexity function (avg = 119).
    // Averaging-only would rank A ≈ B at low churn. Max-based picks B.
    const a = summarize(new Array(20).fill(1))
    const b = summarize([119])
    expect(a.avg).toBeLessThan(2)
    expect(b.max).toBeGreaterThan(a.max)
  })
})
