import { describe, expect, test } from "bun:test"
import { Project } from "ts-morph"
import {
  getFunctionLikeEntriesForSourceFile,
  getFunctionName,
} from "../signals/shared-function-index.js"

describe("shared function index", () => {
  test("names API option callbacks with enclosing operation context", () => {
    const project = new Project({ useInMemoryFileSystem: true })
    const sourceFile = project.createSourceFile(
      "/repo/src/session.ts",
      `
const readSessionLogMarkers = (artifactRoot: string) =>
  Effect.tryPromise({
    try: async () => {
      const marksDirectory = artifactRoot + "/logs/marks"
      const entries = await readdir(marksDirectory)
      return entries.filter((entry) => entry.endsWith(".json")).sort()
    },
    catch: (error) => error,
  })
`,
    )

    const names = getFunctionLikeEntriesForSourceFile(sourceFile).map((entry) =>
      getFunctionName(entry.fn),
    )

    expect(names).toContain("readSessionLogMarkers/Effect.tryPromise/try")
    expect(names).toContain("readSessionLogMarkers/Effect.tryPromise/catch")
    expect(names).not.toContain("try")
    expect(names).not.toContain("catch")
  })
})
