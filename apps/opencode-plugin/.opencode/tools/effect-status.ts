import { tool } from "@opencode-ai/plugin"
import { Context, Effect, Layer, ManagedRuntime, Ref } from "effect"
import { toThrowable } from "../../src/shared/errors"

class StandaloneToolState extends Context.Tag(
  "@opencode-effect-template/StandaloneToolState",
)<StandaloneToolState, {
  readonly nextExecution: Effect.Effect<number>
}>() {}

const StandaloneToolStateLive = Layer.effect(
  StandaloneToolState,
  Ref.make(0).pipe(
    Effect.map((ref) => ({
      nextExecution: Ref.updateAndGet(ref, (value) => value + 1),
    })),
  ),
)

const runtime = ManagedRuntime.make(StandaloneToolStateLive)

const executeEffect = Effect.fn("StandaloneEffectStatusTool.execute")(function* ({
  args,
  context,
}: {
  readonly args: { readonly label?: string }
  readonly context: Parameters<ReturnType<typeof tool>["execute"]>[1]
}) {
  const state = yield* StandaloneToolState
  const execution = yield* state.nextExecution

  context.metadata({
    title: "Standalone Effect status",
    metadata: { execution },
  })

  return JSON.stringify(
    {
      ok: true,
      label: args.label ?? "standalone",
      execution,
      sessionID: context.sessionID,
      directory: context.directory,
      worktree: context.worktree,
    },
    null,
    2,
  )
})

export default tool({
  description: "Return status from a standalone Effect-authored opencode tool",
  args: {
    label: tool.schema
      .string()
      .optional()
      .describe("Optional label to include in the response"),
  },
  execute: (args, context) =>
    runtime
      .runPromise(
        executeEffect({ args, context }).pipe(
          Effect.withSpan("opencode.tool.standalone.effect-status"),
        ),
      )
      .catch((error) => {
        throw toThrowable(error)
      }),
})
