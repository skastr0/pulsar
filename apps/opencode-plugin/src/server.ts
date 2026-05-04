import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { Effect, ManagedRuntime } from "effect"
import { PLUGIN_ID } from "./shared/constants"
import { ToolDenied, toThrowable } from "./shared/errors"
import { decodePluginOptions } from "./shared/options"
import {
  evaluateAgentConstraints,
  renderAgentConstraintSystemPrompt,
} from "./server/agent-constraints"
import { loadTasteVectorForWorktree } from "./server/codec-observer"
import { chatParams, beforeToolExecute, onEvent } from "./server/hooks"
import { makeServerLayer, type ServerRuntimeEnv } from "./server/layers"
import { maybeHandleProbeSessionOpen } from "./server/probe-bridge"
import { createTasteCodecState, afterToolExecute } from "./server/taste-codec-hooks"
import { makeServerTools } from "./server/tools"

const server: Plugin = async (input, rawOptions) => {
  const options = await Effect.runPromise(
    decodePluginOptions(rawOptions).pipe(Effect.mapError(toThrowable)),
  )
  const runtime = ManagedRuntime.make(makeServerLayer({ input, options }))
  const tasteCodecState = createTasteCodecState()

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
      await run(
        "tool.execute.before.constraints",
        Effect.tryPromise({
          try: async () => {
            const vector = await loadTasteVectorForWorktree(input.worktree)
            const decision = await evaluateAgentConstraints({
              tool: hookInput.tool,
              args: toRecord(output.args),
              worktree: input.worktree,
              vector,
            })
            if (!decision.allowed) {
              throw new ToolDenied({
                tool: hookInput.tool,
                reason:
                  decision.message ??
                  "Taste Codec backpressure blocked this structural change.",
              })
            }
          },
          catch: (error) => error,
        }),
      )
    },
    "tool.execute.after": async (hookInput, output) => {
      await run(
        "tool.execute.after",
        afterToolExecute({
          input: hookInput,
          output,
          worktree: input.worktree,
          state: tasteCodecState,
        }),
      )
      await run(
        "tool.execute.after.probe",
        Effect.tryPromise({
          try: async () => {
            const vector = await loadTasteVectorForWorktree(input.worktree)
            await maybeHandleProbeSessionOpen({
              tool: hookInput.tool,
              args: toRecord(hookInput.args),
              output: output.output,
              worktree: input.worktree,
              vector,
            })
          },
          catch: (error) => error,
        }),
      )
    },
    "chat.params": async (_hookInput, output) => {
      Object.assign(output, await run("chat.params", chatParams()))
    },
    "experimental.chat.system.transform": async (hookInput, output) => {
      const vector = await loadTasteVectorForWorktree(input.worktree)
      const constraintContext = await renderAgentConstraintSystemPrompt({
        worktree: input.worktree,
        vector,
      })
      if (constraintContext && !output.system.includes(constraintContext)) {
        output.system.push(constraintContext)
      }
    },
    tool: makeServerTools(run),
  } satisfies Hooks
}

const toRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

export default {
  id: PLUGIN_ID,
  server,
} satisfies PluginModule
