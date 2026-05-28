import { describe, expect, test } from "bun:test"
import { resolveCurrentHistoryPath } from "../shared-history-renames.js"

describe("shared history rename resolution", () => {
  test("follows rename chains to the current path", () => {
    const renameTargets = new Map([
      ["src/old.ts", "src/moved.ts"],
      ["src/moved.ts", "src/current.ts"],
    ])

    expect(resolveCurrentHistoryPath("src/old.ts", renameTargets)).toBe("src/current.ts")
    expect(resolveCurrentHistoryPath("src/moved.ts", renameTargets)).toBe("src/current.ts")
  })

  test("stops deterministically when rename metadata cycles", () => {
    const renameTargets = new Map([
      ["src/a.ts", "src/b.ts"],
      ["src/b.ts", "src/a.ts"],
    ])

    expect(resolveCurrentHistoryPath("src/a.ts", renameTargets)).toBe("src/a.ts")
  })
})
