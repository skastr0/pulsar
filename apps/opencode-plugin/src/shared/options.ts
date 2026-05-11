import { Context, Effect, Layer, Schema } from "effect"
import { PluginConfigError } from "./errors"

const logLevelSchema = Schema.Literal("debug", "info", "warn", "error")
export type LogLevel = typeof logLevelSchema.Type

const pluginOptionsSchema = Schema.Struct({
  blockEnvFiles: Schema.optionalWith(Schema.Boolean, { default: () => true }),
  chatTemperature: Schema.optionalWith(
    Schema.Number.pipe(Schema.between(0, 2)),
    { default: () => 0.2 },
  ),
  idleLogLevel: Schema.optionalWith(logLevelSchema, { default: () => "info" }),
  statusMessage: Schema.optionalWith(Schema.String, {
    default: () => "Effect runtime active",
  }),
})
export type PluginOptions = typeof pluginOptionsSchema.Type

export class PluginConfig extends Context.Tag(
  "@opencode-effect-template/PluginConfig",
)<PluginConfig, PluginOptions>() {}

export const pluginConfigLayer = (
  options: PluginOptions,
): Layer.Layer<PluginConfig> =>
  Layer.succeed(PluginConfig, options)

export const decodePluginOptions = (
  rawOptions: unknown,
): Effect.Effect<PluginOptions, PluginConfigError> =>
  Schema.decodeUnknown(pluginOptionsSchema)(rawOptions ?? {}).pipe(
    Effect.mapError(
      (cause) =>
        new PluginConfigError({
          message: `Invalid plugin options: ${String(cause)}`,
          cause,
        }),
    ),
  )
