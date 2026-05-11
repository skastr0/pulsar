import { Effect } from "effect"
import type { TuiCommand } from "@opencode-ai/plugin/tui"
import { PluginLogger } from "../shared/logger"
import { PluginConfig } from "../shared/options"
import { TuiHost, type TuiRuntimeEnv } from "./layers"

type EffectTuiCommand = Omit<TuiCommand, "onSelect"> & {
  readonly onSelect?: Effect.Effect<void, unknown, TuiRuntimeEnv>
}

export const setup = Effect.fn("TuiProgram.setup")(function* () {
  const logger = yield* PluginLogger

  yield* logger.log({
    level: "info",
    message: "TUI plugin registered",
  })
})

export const commands = Effect.fn("TuiProgram.commands")(function* () {
  const config = yield* PluginConfig
  const host = yield* TuiHost

  return [
    {
      title: "Effect Template Status",
      value: "effect-template.status",
      description: "Show the Effect-backed plugin status",
      category: "Effect",
      slash: { name: "effect-template", aliases: ["effect"] },
      onSelect: Effect.fn("TuiProgram.commands.status.onSelect")(
        function* () {
          const logger = yield* PluginLogger

          yield* Effect.sync(() => {
            host.api.ui.toast({
              message: config.statusMessage,
              variant: "info",
            })
          })

          yield* logger.log({
            level: "info",
            message: "Effect template status command selected",
            extra: {
              meta: host.meta,
            },
          })
        },
      )(),
    },
  ] satisfies ReadonlyArray<EffectTuiCommand>
})
