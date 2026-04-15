import type { Hooks } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { PluginLogger } from "../shared/logger"
import { PluginConfig } from "../shared/options"
import { ToolDenied } from "../shared/errors"
import { ToolPolicy } from "../shared/policy"

type EventInput = Parameters<NonNullable<Hooks["event"]>>[0]
type ToolBeforeInput = Parameters<
  NonNullable<Hooks["tool.execute.before"]>
>[0]
type ToolBeforeOutput = Parameters<
  NonNullable<Hooks["tool.execute.before"]>
>[1]
type ChatParamsOutput = Parameters<NonNullable<Hooks["chat.params"]>>[1]

export const onEvent = Effect.fn("ServerHooks.onEvent")(function* (
  input: EventInput,
) {
  if (input.event?.type !== "session.idle") return

  const logger = yield* PluginLogger
  const config = yield* PluginConfig

  yield* Effect.annotateCurrentSpan("event.type", input.event.type)
  yield* logger.log({
    level: config.idleLogLevel,
    message: "session idle",
    extra: input.event.properties,
  })
})

export const beforeToolExecute = Effect.fn("ServerHooks.beforeToolExecute")(
  function* ({
    input,
    output,
  }: {
    readonly input: ToolBeforeInput
    readonly output: ToolBeforeOutput
  }) {
    yield* Effect.annotateCurrentSpan("tool", input.tool)

    const policy = yield* ToolPolicy
    const decision = yield* policy.evaluate(input.tool, output.args)

    if (decision._tag === "Deny") {
      return yield* new ToolDenied({
        tool: decision.tool,
        filePath: decision.filePath,
        reason: decision.reason,
      })
    }
  },
)

export const chatParams = Effect.fn("ServerHooks.chatParams")(function* () {
  const config = yield* PluginConfig

  yield* Effect.annotateCurrentSpan(
    "chat.temperature",
    String(config.chatTemperature),
  )

  const patch: Partial<ChatParamsOutput> = {
    temperature: config.chatTemperature,
  }

  return patch
})
