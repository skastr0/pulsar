import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { Effect, ManagedRuntime } from "effect"
import { PLUGIN_ID } from "./shared/constants"
import { toThrowable } from "./shared/errors"
import { decodePluginOptions } from "./shared/options"
import { makeTuiLayer, type TuiRuntimeEnv } from "./tui/layers"
import { commands, setup } from "./tui/program"

const tui: TuiPlugin = async (api, rawOptions, meta) => {
  const options = await Effect.runPromise(
    decodePluginOptions(rawOptions).pipe(Effect.mapError(toThrowable)),
  )
  const runtime = ManagedRuntime.make(makeTuiLayer({ api, options, meta }))
  api.lifecycle.onDispose(() => {
    void runtime.dispose()
  })

  const run = <A>(
    name: string,
    effect: Effect.Effect<A, unknown, TuiRuntimeEnv>,
  ) =>
    runtime
      .runPromise(effect.pipe(Effect.withSpan(`opencode.plugin.tui.${name}`)))
      .catch((error) => {
        throw toThrowable(error)
      })

  try {
    await run("setup", setup())
    const effectCommands = await run("commands", commands())
    const registeredCommands = effectCommands.map((command) => ({
      ...command,
      onSelect: command.onSelect
        ? () =>
            run(`command.${command.value}`, command.onSelect!).catch((error) => {
              api.ui.toast({
                message: error.message,
                variant: "error",
              })
            })
        : undefined,
    }))

    const off = api.command.register(() => registeredCommands)
    api.lifecycle.onDispose(off)
  } catch (error) {
    void runtime.dispose()
    throw toThrowable(error)
  }
}

export default {
  id: PLUGIN_ID,
  tui,
} satisfies TuiPluginModule
