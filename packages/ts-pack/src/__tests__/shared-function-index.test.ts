import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { createTempRepo, type TempRepo } from "./test-repo.js"
import { TsAnalysisLayer, TsAnalysisTag } from "../ts-analysis.js"
import {
  getFunctionLikeEntriesForSourceFile,
  getFunctionName,
} from "../signals/shared-function-index.js"

describe("shared function index", () => {
  let repo: TempRepo

  beforeEach(async () => {
    repo = await createTempRepo("pulsar-function-index-")
  })

  afterEach(async () => {
    await repo.cleanup()
  })

  test("names API option callbacks with enclosing operation context", async () => {
    await repo.write(
      "src/session.ts",
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

    const names = await Effect.runPromise(
      Effect.gen(function* () {
        const analysis = yield* TsAnalysisTag
        const sourceFiles = yield* analysis.mapFiles(async (context) => context.sourceFile)
        return sourceFiles.flatMap((sourceFile) =>
          getFunctionLikeEntriesForSourceFile(sourceFile).map((entry) => getFunctionName(entry.fn)),
        )
      }).pipe(Effect.provide(TsAnalysisLayer(repo.root))),
    )

    expect(names).toContain("readSessionLogMarkers/Effect.tryPromise/try")
    expect(names).toContain("readSessionLogMarkers/Effect.tryPromise/catch")
    expect(names).not.toContain("try")
    expect(names).not.toContain("catch")
  })
})
