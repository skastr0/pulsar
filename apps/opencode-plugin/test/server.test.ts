import { describe, expect, test } from "bun:test"
import serverModule from "../src/server"

const fakeServerInput = () => {
  const logCalls: unknown[] = []

  return {
    input: {
      client: {
        app: {
          log: (request: unknown) => {
            logCalls.push(request)
          },
        },
      },
      project: { id: "test" },
      directory: "/tmp/project",
      worktree: "/tmp/project",
      experimental_workspace: { register: () => undefined },
      serverUrl: new URL("http://localhost:4096"),
      $: (() => undefined) as never,
    } as never,
    logCalls,
  }
}

describe("native server plugin", () => {
  test("rejects .env file tool access through Effect policy", async () => {
    const { input } = fakeServerInput()
    const hooks = await serverModule.server(input, {
      blockEnvFiles: true,
    })

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "read" } as never,
        { args: { filePath: ".env.local" } } as never,
      ),
    ).rejects.toThrow("Access to .env.local is disabled")
  })

  test("mutates chat params using an Effect hook result", async () => {
    const { input } = fakeServerInput()
    const hooks = await serverModule.server(input, {
      chatTemperature: 0.4,
    })
    const output = { temperature: 1 }

    await hooks["chat.params"]?.({} as never, output as never)

    expect(output.temperature).toBe(0.4)
  })

  test("registers an Effect-backed custom tool", async () => {
    const { input, logCalls } = fakeServerInput()
    const hooks = await serverModule.server(input, {
      statusMessage: "ready from test",
    })
    const metadataCalls: unknown[] = []

    const output = await hooks.tool?.template_status.execute(
      { includeOptions: true },
      {
        sessionID: "session-1",
        messageID: "message-1",
        agent: "test",
        directory: "/tmp/project",
        worktree: "/tmp/project",
        abort: new AbortController().signal,
        metadata: (info: unknown) => {
          metadataCalls.push(info)
        },
        ask: () => ({}) as never,
      } as never,
    )

    expect(JSON.parse(output ?? "{}")).toMatchObject({
      status: "ready from test",
      sessionID: "session-1",
      options: {
        statusMessage: "ready from test",
      },
    })
    expect(metadataCalls).toHaveLength(1)
    expect(logCalls).toHaveLength(1)
  })
})
