import { describe, expect, test } from "bun:test"
import { join } from "node:path"
import {
  buildAbsentCoverageFacts,
  buildUnknownCoverageFacts,
  parseCoverageCandidate,
} from "../coverage-facts.js"

describe("coverage facts", () => {
  test("parses lcov reports with line, function, and branch totals", () => {
    const repoRoot = "/repo"
    const facts = parseCoverageCandidate(
      repoRoot,
      {
        relativePath: "coverage/lcov.info",
        content: [
          "TN:",
          "SF:src/a.ts",
          "FN:1,main",
          "FNDA:1,main",
          "DA:1,1",
          "DA:2,0",
          "BRDA:1,0,0,1",
          "BRDA:1,0,1,0",
          "end_of_record",
        ].join("\n"),
      },
      ["coverage/lcov.info", "coverage/coverage-final.json"],
    )

    expect(facts.state).toBe("present")
    expect(facts.tool).toBe("lcov")
    expect(facts.files[0]?.file).toBe(join(repoRoot, "src/a.ts"))
    expect(facts.summary.lines).toEqual({ covered: 1, total: 2, pct: 0.5 })
    expect(facts.summary.functions).toEqual({ covered: 1, total: 1, pct: 1 })
    expect(facts.summary.branches).toEqual({ covered: 1, total: 2, pct: 0.5 })
  })

  test("parses Istanbul coverage-final JSON reports", () => {
    const repoRoot = "/repo"
    const facts = parseCoverageCandidate(
      repoRoot,
      {
        relativePath: "coverage/coverage-final.json",
        content: JSON.stringify({
          "src/a.ts": {
            path: "src/a.ts",
            s: { "0": 1, "1": 0 },
            f: { "0": 0 },
            b: { "0": [1, 0] },
          },
        }),
      },
      ["coverage/lcov.info", "coverage/coverage-final.json"],
    )

    expect(facts.state).toBe("present")
    expect(facts.tool).toBe("istanbul")
    expect(facts.files[0]?.file).toBe(join(repoRoot, "src/a.ts"))
    expect(facts.summary.lines).toEqual({ covered: 1, total: 2, pct: 0.5 })
    expect(facts.summary.functions).toEqual({ covered: 0, total: 1, pct: 0 })
    expect(facts.summary.branches).toEqual({ covered: 1, total: 2, pct: 0.5 })
  })

  test("distinguishes parsed zero coverage from absence", () => {
    const facts = parseCoverageCandidate(
      "/repo",
      {
        relativePath: "coverage/lcov.info",
        content: [
          "SF:src/a.ts",
          "DA:1,0",
          "FNDA:0,main",
          "BRDA:1,0,0,0",
          "end_of_record",
        ].join("\n"),
      },
      ["coverage/lcov.info"],
    )

    expect(facts.state).toBe("zero")
    expect(facts.summary.lines).toEqual({ covered: 0, total: 1, pct: 0 })
  })

  test("empty but existing coverage reports are zero, not absent", () => {
    const facts = parseCoverageCandidate(
      "/repo",
      {
        relativePath: "coverage/lcov.info",
        content: "",
      },
      ["coverage/lcov.info"],
    )

    expect(facts.state).toBe("zero")
    expect(facts.files).toEqual([])
  })

  test("unavailable coverage facts do not masquerade as full coverage", () => {
    const absent = buildAbsentCoverageFacts(["coverage/lcov.info"])
    const unknown = buildUnknownCoverageFacts(
      ["coverage/lcov.info", "coverage/coverage-final.json"],
      "Malformed coverage report",
      "/repo/coverage/coverage-final.json",
    )

    expect(absent.state).toBe("absent")
    expect(absent.summary.lines).toEqual({ covered: 0, total: 0, pct: 0 })
    expect(absent.summary.functions).toEqual({ covered: 0, total: 0, pct: 0 })
    expect(absent.summary.branches).toEqual({ covered: 0, total: 0, pct: 0 })
    expect(unknown.state).toBe("unknown")
    expect(unknown.summary.lines).toEqual({ covered: 0, total: 0, pct: 0 })
    expect(unknown.message).toBe("Malformed coverage report")
    expect(unknown.sourcePath).toBe("/repo/coverage/coverage-final.json")
  })
})
