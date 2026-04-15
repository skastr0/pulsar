import { describe, expect, test } from "bun:test"
import standaloneTool from "../.opencode/tools/effect-status"

describe("standalone Effect tool", () => {
  test("uses one module-scoped ManagedRuntime across executions", async () => {
    const metadataCalls: unknown[] = []
    const context = {
      sessionID: "session-1",
      messageID: "message-1",
      agent: "test",
      directory: "/tmp/project",
      worktree: "/tmp/project",
      abort: new AbortController().signal,
      metadata: (input: unknown) => {
        metadataCalls.push(input)
      },
      ask: () => ({}) as never,
    } as never

    const first = JSON.parse(
      await standaloneTool.execute({ label: "first" }, context),
    )
    const second = JSON.parse(
      await standaloneTool.execute({ label: "second" }, context),
    )

    expect(first).toMatchObject({ label: "first", execution: 1 })
    expect(second).toMatchObject({ label: "second", execution: 2 })
    expect(metadataCalls).toHaveLength(2)
  })
})
