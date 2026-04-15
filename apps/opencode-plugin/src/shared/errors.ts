import { Schema } from "effect"

export class PluginConfigError extends Schema.TaggedError<PluginConfigError>()(
  "PluginConfigError",
  {
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class OpencodeClientError extends Schema.TaggedError<OpencodeClientError>()(
  "OpencodeClientError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown,
  },
) {}

export class ToolDenied extends Schema.TaggedError<ToolDenied>()(
  "ToolDenied",
  {
    tool: Schema.String,
    reason: Schema.String,
    filePath: Schema.optional(Schema.String),
  },
) {}

export const renderPluginError = (error: unknown): Error | undefined => {
  if (error instanceof ToolDenied) {
    return new Error(error.reason)
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "ToolDenied" &&
    "reason" in error &&
    typeof error.reason === "string"
  ) {
    return new Error(error.reason)
  }

  return undefined
}

export const toThrowable = (error: unknown): Error =>
  renderPluginError(error) ??
  (error instanceof Error ? error : new Error(String(error)))
