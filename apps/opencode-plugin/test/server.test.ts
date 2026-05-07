import { describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { createTimeSeriesServices, type TimeSeriesEntry } from "@skastr0/pulsar-core"
import serverModule from "../src/server"

const makeEntry = (score: number, message: string): TimeSeriesEntry => ({
  sha: "abc123",
  timestamp: "2026-04-19T10:00:00.000Z",
  source: "raw",
  observerOutput: {
    categories: {
      "architectural-drift": { score, signals: { A: score } },
      "dependency-entropy": { score: 1, signals: {} },
      "abstraction-bloat": { score: 1, signals: {} },
      "legibility-decay": { score: 1, signals: {} },
      "generated-slop": { score: 1, signals: {} },
      "review-pain": { score: 1, signals: {} },
    },
    minimum: {
      signal: "A",
      category: "architectural-drift",
      score,
      detail: message,
    },
    weighted_mean: score,
    hard_gate_status: "pass",
    hard_gate_violations: [],
  },
  signalDiagnostics: {
    A: [{ severity: "warn", message }],
  },
  inactiveSignals: [],
})

const seedTimeSeries = async (worktree: string, entry: TimeSeriesEntry): Promise<void> => {
  const services = createTimeSeriesServices(worktree)
  await Effect.runPromise(services.writer.append(entry))
}

const fakeServerInput = (worktree = "/tmp/project") => {
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
      directory: worktree,
      worktree,
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

  test("blocks structural edits when backpressure is red", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "pulsar-plugin-red-"))
    try {
      await seedTimeSeries(
        worktree,
        makeEntry(0.45, "Reuse the existing domain term UserAccount instead of inventing a new synonym."),
      )
      const { input } = fakeServerInput(worktree)
      const hooks = await serverModule.server(input, {})

      await expect(
        hooks["tool.execute.before"]?.(
          { tool: "write", sessionID: "session-red", callID: "call-1" } as never,
          { args: { filePath: "src/new-structure.ts" } } as never,
        ),
      ).rejects.toThrow("backpressure is red")
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })

  test("injects qualitative backpressure guidance without exposing numeric scores", async () => {
    const worktree = await mkdtemp(join(tmpdir(), "pulsar-plugin-guidance-"))
    try {
      await seedTimeSeries(
        worktree,
        makeEntry(0.45, "Reuse the existing domain term UserAccount instead of inventing a new synonym."),
      )
      const { input } = fakeServerInput(worktree)
      const hooks = await serverModule.server(input, {})
      const output = { system: [] as Array<string> }

      await hooks["experimental.chat.system.transform"]?.({ model: {} } as never, output as never)

      const rendered = output.system.join("\n")
      expect(rendered).toContain("pulsar-agent-constraints")
      expect(rendered).toContain("backpressure: red")
      expect(rendered).toContain("UserAccount")
      expect(rendered).not.toContain("0.45")
    } finally {
      await rm(worktree, { recursive: true, force: true })
    }
  })
})
