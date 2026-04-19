import { describe, expect, test } from "bun:test"
import {
  baselineViolationCount,
  compareToBaseline,
  createBaseline,
  decodeBaselineSync,
  type HardGateViolation,
} from "../index.js"

const makeViolation = (opts: {
  readonly signalId: string
  readonly hash: string
  readonly file?: string
  readonly message?: string
}): HardGateViolation => ({
  signalId: opts.signalId,
  category: "architectural-drift",
  diagnostic: {
    severity: "block",
    message: opts.message ?? `Violation ${opts.hash}`,
    location: { file: opts.file ?? "src/a.ts" },
    data: { hash: opts.hash },
  },
})

describe("baseline", () => {
  test("schema round-trips baseline JSON", () => {
    const baseline = createBaseline({
      baselineSha: "abc123",
      createdAt: "2026-04-15T10:00:00Z",
      violations: [
        makeViolation({ signalId: "TS-AD-02", hash: "h1", file: "src/a.ts" }),
        makeViolation({ signalId: "TS-AD-02", hash: "h2", file: "src/b.ts" }),
      ],
    })

    const roundTripped = decodeBaselineSync(JSON.parse(JSON.stringify(baseline)))
    expect(roundTripped).toEqual(baseline)
    expect(baselineViolationCount(roundTripped)).toBe(2)
  })

  test("detects only hashes absent from the baseline as new violations", () => {
    const baseline = createBaseline({
      baselineSha: "abc123",
      violations: [makeViolation({ signalId: "TS-AD-02", hash: "h1" })],
    })

    const compared = compareToBaseline(baseline, [
      makeViolation({ signalId: "TS-AD-02", hash: "h1" }),
      makeViolation({ signalId: "TS-AD-02", hash: "h2", file: "src/new.ts" }),
    ])

    expect(compared.tolerated.map((violation) => violation.hash)).toEqual(["h1"])
    expect(compared.newViolations.map((violation) => violation.hash)).toEqual(["h2"])
    expect(compared.paidDebt).toEqual([])
  })

  test("reports paid debt when a baseline violation disappears", () => {
    const baseline = createBaseline({
      baselineSha: "abc123",
      violations: [
        makeViolation({ signalId: "TS-AD-02", hash: "h1" }),
        makeViolation({ signalId: "TS-AD-02", hash: "h2", file: "src/legacy.ts" }),
      ],
    })

    const compared = compareToBaseline(baseline, [
      makeViolation({ signalId: "TS-AD-02", hash: "h1" }),
    ])

    expect(compared.newViolations).toEqual([])
    expect(compared.paidDebt.map((violation) => violation.hash)).toEqual(["h2"])
    expect(compared.paidDebt[0]?.file).toBe("src/legacy.ts")
  })
})
