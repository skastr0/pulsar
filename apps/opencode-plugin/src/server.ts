import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { Effect, ManagedRuntime } from "effect"
import { PLUGIN_ID } from "./shared/constants"
import { toThrowable } from "./shared/errors"
import { decodePluginOptions } from "./shared/options"
import { chatParams, beforeToolExecute, onEvent } from "./server/hooks"
import { makeServerLayer, type ServerRuntimeEnv } from "./server/layers"
import { makeServerTools } from "./server/tools"

const server: Plugin = async (input, rawOptions) => {
  const options = await Effect.runPromise(
    decodePluginOptions(rawOptions).pipe(Effect.mapError(toThrowable)),
  )
  const runtime = ManagedRuntime.make(makeServerLayer({ input, options }))

  const run = <A>(
    name: string,
    effect: Effect.Effect<A, unknown, ServerRuntimeEnv>,
  ) =>
    runtime
      .runPromise(effect.pipe(Effect.withSpan(`opencode.plugin.server.${name}`)))
      .catch((error) => {
        throw toThrowable(error)
      })

  return {
    event: async (eventInput) => {
      await run("event", onEvent(eventInput))
    },
    "tool.execute.before": async (hookInput, output) => {
      await run(
        "tool.execute.before",
        beforeToolExecute({ input: hookInput, output }),
      )
    },
    "chat.params": async (_hookInput, output) => {
      Object.assign(output, await run("chat.params", chatParams()))
    },
    tool: makeServerTools(run),
  } satisfies Hooks
}

export default {
  id: PLUGIN_ID,
  server,
} satisfies PluginModule
