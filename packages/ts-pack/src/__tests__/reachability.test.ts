import { describe, expect, test } from "bun:test"
import { computeReachabilityCounts } from "../graph/reachability.js"

describe("graph reachability", () => {
  test("bitset mode computes exact transitive counts", () => {
    const dag = new Map<number, ReadonlySet<number>>([
      [0, new Set([1])],
      [1, new Set([2])],
      [2, new Set()],
    ])

    const result = computeReachabilityCounts(dag, [[0], [1], [2]], 3)
    expect(result.mode).toBe("bitset")
    expect(result.counts).toEqual([2, 1, 0])
  })

  test("bloom mode stays stable on small deterministic graphs", () => {
    const dag = new Map<number, ReadonlySet<number>>([
      [0, new Set([1])],
      [1, new Set([2])],
      [2, new Set()],
    ])

    const result = computeReachabilityCounts(dag, [[0], [1], [2]], 3, {
      probabilisticThresholdNodes: 1,
      bloomBitCount: 256,
      bloomHashCount: 3,
    })
    expect(result.mode).toBe("bloom")
    expect(result.counts).toEqual([2, 1, 0])
  })

  test("component member weighting counts modules, not just SCCs", () => {
    const dag = new Map<number, ReadonlySet<number>>([
      [0, new Set([1])],
      [1, new Set()],
    ])

    const result = computeReachabilityCounts(dag, [[0, 1], [2, 3]], 4)
    expect(result.counts).toEqual([2, 0])
  })
})
