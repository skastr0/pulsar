import { Context, Effect, Layer, Schema } from "effect"
import { PluginConfigError } from "./errors"

export const LogLevel = Schema.Literal("debug", "info", "warn", "error")
export type LogLevel = typeof LogLevel.Type

export const PluginOptions = Schema.Struct({
  blockEnvFiles: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  chatTemperature: Schema.optionalWith(
    Schema.Number.pipe(Schema.between(0, 2)),
    { default: () => 0.2 },
  ),
  idleLogLevel: Schema.optionalWith(LogLevel, { default: () => "info" }),
  statusMessage: Schema.optionalWith(Schema.String, {
    default: () => "Effect runtime active",
  }),
})
export type PluginOptions = typeof PluginOptions.Type

export class PluginConfig extends Context.Tag(
  "@opencode-effect-template/PluginConfig",
)<PluginConfig, PluginOptions>() {}

export const pluginConfigLayer = (options: PluginOptions) =>
  Layer.succeed(PluginConfig, options)

export const decodePluginOptions = (rawOptions: unknown) =>
  Schema.decodeUnknown(PluginOptions)(rawOptions ?? {}).pipe(
    Effect.mapError(
      (cause) =>
        new PluginConfigError({
          message: `Invalid plugin options: ${String(cause)}`,
          cause,
        }),
    ),
  )
