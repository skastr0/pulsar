import { expect, test } from "bun:test"
import { canAdvanceFromHandoff } from "../lifecycle.js"
import type { CalibrationWriteResult } from "../types.js"

const completedWrite: CalibrationWriteResult = {
  written: ["/repo/.pulsar/vector.json"],
  receipts: [],
  baseline: "reject",
}

test("handoff advances only after persistence succeeds", () => {
  expect(canAdvanceFromHandoff(null, null)).toBe(false)
  expect(canAdvanceFromHandoff(null, "disk full")).toBe(false)
  expect(canAdvanceFromHandoff(completedWrite, null)).toBe(true)
  expect(canAdvanceFromHandoff(completedWrite, "late failure")).toBe(false)
})
