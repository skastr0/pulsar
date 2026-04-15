import { Context, Effect, Layer, Schema } from "effect"
import { PluginConfig } from "./options"

const BLOCKED_ENV_PATH = /(^|\/)\.env(\..+)?$/
const BLOCKED_TOOLS = new Set(["read", "write", "edit", "apply_patch"])

export const ToolInvocation = Schema.Struct({
  tool: Schema.String,
  filePath: Schema.optional(Schema.String),
})
export type ToolInvocation = typeof ToolInvocation.Type

export type ToolDecision =
  | {
      readonly _tag: "Allow"
    }
  | {
      readonly _tag: "Deny"
      readonly tool: string
      readonly reason: string
      readonly filePath?: string
    }

const extractFilePath = (args: unknown): string | undefined => {
  if (typeof args !== "object" || args === null) return undefined
  if (!("filePath" in args)) return undefined
  return typeof args.filePath === "string" ? args.filePath : undefined
}

export const shouldDenyToolInvocation = (
  invocation: ToolInvocation,
  blockEnvFiles: boolean,
): ToolDecision => {
  if (!blockEnvFiles) return { _tag: "Allow" }
  if (!BLOCKED_TOOLS.has(invocation.tool)) return { _tag: "Allow" }
  if (!invocation.filePath) return { _tag: "Allow" }
  if (!BLOCKED_ENV_PATH.test(invocation.filePath)) return { _tag: "Allow" }

  return {
    _tag: "Deny",
    tool: invocation.tool,
    filePath: invocation.filePath,
    reason: `Access to ${invocation.filePath} is disabled by policy (.env guard).`,
  }
}

export class ToolPolicy extends Context.Tag(
  "@opencode-effect-template/ToolPolicy",
)<ToolPolicy, {
  readonly evaluate: (
    tool: string,
    args: unknown,
  ) => Effect.Effect<ToolDecision>
}>() {}

export const ToolPolicyLive = Layer.effect(
  ToolPolicy,
  Effect.gen(function* () {
    const config = yield* PluginConfig

    const evaluate = Effect.fn("ToolPolicy.evaluate")(function* (
      tool: string,
      args: unknown,
    ) {
      const invocation = yield* Schema.decodeUnknown(ToolInvocation)({
        tool,
        filePath: extractFilePath(args),
      }).pipe(Effect.orDie)

      return shouldDenyToolInvocation(invocation, config.blockEnvFiles)
    })

    return {
      evaluate,
    }
  }),
)
