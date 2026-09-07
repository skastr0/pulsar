import { describe, expect, test } from "bun:test"
import { chooseOwningProject } from "../source-membership.js"

describe("chooseOwningProject", () => {
  test("prefers the containing tsconfig over a deeper unrelated project", () => {
    const owner = chooseOwningProject("/repo/packages/b/src/index.ts", [
      { projectId: "tsconfig.json", configPath: "/repo/tsconfig.json" },
      { projectId: "packages/a/tsconfig.json", configPath: "/repo/packages/a/tsconfig.json" },
    ])
    expect(owner?.projectId).toBe("tsconfig.json")
  })

  test("prefers the nearest containing tsconfig", () => {
    const owner = chooseOwningProject("/repo/packages/core/src/index.ts", [
      { projectId: "tsconfig.json", configPath: "/repo/tsconfig.json" },
      { projectId: "packages/core/tsconfig.json", configPath: "/repo/packages/core/tsconfig.json" },
    ])
    expect(owner?.projectId).toBe("packages/core/tsconfig.json")
  })

  test("returns undefined when no candidate contains the file", () => {
    const owner = chooseOwningProject("/repo/packages/b/src/index.ts", [
      { projectId: "packages/a/tsconfig.json", configPath: "/repo/packages/a/tsconfig.json" },
    ])
    expect(owner).toBeUndefined()
  })
})
