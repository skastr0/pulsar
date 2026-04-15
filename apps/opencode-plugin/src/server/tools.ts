import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin"
import { Effect } from "effect"
import { PluginLogger } from "../shared/logger"
import { PluginConfig } from "../shared/options"
import type { ServerRuntimeEnv } from "./layers"

type TemplateStatusArgs = {
  readonly includeOptions?: boolean
}

export type ServerEffectRunner = <A>(
  name: string,
  effect: Effect.Effect<A, unknown, ServerRuntimeEnv>,
) => Promise<A>

export const templateStatusExecute = Effect.fn(
  "ServerTools.templateStatus.execute",
)(function* ({
  args,
  context,
}: {
  readonly args: TemplateStatusArgs
  readonly context: ToolContext
}) {
  const logger = yield* PluginLogger
  const config = yield* PluginConfig

  context.metadata({
    title: "Reading Effect plugin status",
    metadata: { sessionID: context.sessionID },
  })

  yield* logger.log({
    level: "info",
    message: "template_status tool executed",
    extra: {
      sessionID: context.sessionID,
      agent: context.agent,
    },
  })

  return JSON.stringify(
    {
      status: config.statusMessage,
      sessionID: context.sessionID,
      directory: context.directory,
      worktree: context.worktree,
      options: args.includeOptions ? config : undefined,
    },
    null,
    2,
  )
})

export const makeServerTools = (
  run: ServerEffectRunner,
): Record<string, ToolDefinition> => ({
  template_status: tool({
    description:
      "Return the current status of the Effect-backed opencode plugin template",
    args: {
      includeOptions: tool.schema
        .boolean()
        .optional()
        .describe("Include decoded plugin option values in the response"),
    },
    execute: (args, context) =>
      run("tool.template_status", templateStatusExecute({ args, context })),
  }),
})
