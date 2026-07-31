import { describe, expect, test } from "bun:test"
import { requiresChangedScopeObservation } from "../score-diff-observation-plan.js"

describe("score diff observation plan", () => {
  test("skips the changed-scope observation for default worktree diffs", () => {
    expect(requiresChangedScopeObservation(false, true, 1)).toBe(false)
  })

  test("retains the changed-scope observation for changed-only worktree diffs", () => {
    expect(requiresChangedScopeObservation(true, true, 1)).toBe(true)
  })

  test("skips the changed-scope observation without a dirty worktree", () => {
    expect(requiresChangedScopeObservation(true, false, 1)).toBe(false)
    expect(requiresChangedScopeObservation(true, true, 0)).toBe(false)
  })
})
