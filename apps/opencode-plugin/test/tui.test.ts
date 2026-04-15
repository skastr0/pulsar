import { describe, expect, test } from "bun:test"
import tuiModule from "../src/tui"

const fakeTuiApi = () => {
  const disposes: Array<() => void> = []
  const toasts: unknown[] = []
  const logs: unknown[] = []
  let commands: ReadonlyArray<{ onSelect?: () => Promise<void> }> = []

  return {
    api: {
      command: {
        register: (factory: () => ReadonlyArray<{ onSelect?: () => Promise<void> }>) => {
          commands = factory()
          return () => undefined
        },
      },
      ui: {
        toast: (input: unknown) => {
          toasts.push(input)
        },
      },
      client: {
        app: {
          log: (request: unknown) => {
            logs.push(request)
          },
        },
      },
      lifecycle: {
        signal: new AbortController().signal,
        onDispose: (fn: () => void) => {
          disposes.push(fn)
          return () => undefined
        },
      },
    },
    get commands() {
      return commands
    },
    disposes,
    logs,
    toasts,
  }
}

describe("native TUI plugin", () => {
  test("registers commands whose callbacks run through Effect", async () => {
    const fixture = fakeTuiApi()

    await tuiModule.tui(
      fixture.api as never,
      { statusMessage: "status from test" },
      {} as never,
    )
    await fixture.commands[0]?.onSelect?.()

    expect(fixture.commands).toHaveLength(1)
    expect(fixture.toasts).toContainEqual({
      message: "status from test",
      variant: "info",
    })
    expect(fixture.logs.length).toBeGreaterThanOrEqual(2)
    expect(fixture.disposes.length).toBeGreaterThanOrEqual(2)
  })
})
