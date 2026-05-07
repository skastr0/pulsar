import { describe, expect, test } from "bun:test"
import { Shared06PrDepDelta } from "../shared-06-pr-dep-delta.js"

describe("SHARED-06 PR dependency delta", () => {
  test("line churn without dependency edges is score-neutral context", () => {
    const output = {
      totalNewDependencyEdges: 0,
      crossBoundaryEdges: 0,
      crossPackageEdges: 0,
      crossCrateEdges: 0,
      linesAdded: 1200,
      linesDeleted: 900,
      byLanguage: {
        typescript: {
          newDependencyEdges: 0,
          linesAdded: 1200,
          linesDeleted: 900,
        },
      },
    }

    expect(Shared06PrDepDelta.score(output)).toBe(1)
    expect(Shared06PrDepDelta.outputMetadata?.(output)).toBeUndefined()
    const diagnostic = Shared06PrDepDelta.diagnose(output)[0]
    expect(diagnostic?.severity).toBe("info")
    expect(diagnostic?.message).toContain("0 new dependency edges")
    expect(diagnostic?.message).toContain("+1200 / -900")
  })

  test("dependency edges create review pressure by edge kind", () => {
    const output = {
      totalNewDependencyEdges: 4,
      crossBoundaryEdges: 2,
      crossPackageEdges: 1,
      crossCrateEdges: 1,
      linesAdded: 20,
      linesDeleted: 10,
      byLanguage: {
        typescript: {
          newDependencyEdges: 3,
          linesAdded: 20,
          linesDeleted: 10,
        },
        rust: {
          newDependencyEdges: 1,
          linesAdded: 0,
          linesDeleted: 0,
        },
      },
    }

    expect(Shared06PrDepDelta.score(output)).toBeCloseTo(0.35)
    expect(Shared06PrDepDelta.outputMetadata?.(output)).toBeUndefined()
    const diagnostic = Shared06PrDepDelta.diagnose(output)[0]
    expect(diagnostic?.severity).toBe("warn")
    expect(diagnostic?.data?.crossBoundaryEdges).toBe(2)
    expect(diagnostic?.data?.crossPackageEdges).toBe(1)
    expect(diagnostic?.data?.crossCrateEdges).toBe(1)
  })

  test("empty diff is not applicable instead of a healthy score", () => {
    const output = {
      totalNewDependencyEdges: 0,
      crossBoundaryEdges: 0,
      crossPackageEdges: 0,
      crossCrateEdges: 0,
      linesAdded: 0,
      linesDeleted: 0,
      byLanguage: {},
    }

    expect(Shared06PrDepDelta.score(output)).toBe(1)
    expect(Shared06PrDepDelta.outputMetadata?.(output)?.applicability).toBe(
      "not_applicable",
    )
  })
})
