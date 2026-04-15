import { Context, Effect, Layer } from "effect"
import { OpencodeClientError } from "./errors"
import { PLUGIN_SERVICE } from "./constants"
import type { LogLevel } from "./options"

export type LogEntry = {
  readonly level: LogLevel
  readonly message: string
  readonly extra?: unknown
}

export class PluginLogger extends Context.Tag(
  "@opencode-effect-template/PluginLogger",
)<PluginLogger, {
  readonly log: (entry: LogEntry) => Effect.Effect<void, OpencodeClientError>
}>() {}

export const makeServerLoggerLayer = (client: {
  readonly app?: {
    readonly log?: (request?: any) => unknown
  }
}) =>
  Layer.succeed(PluginLogger, {
    log: (entry) =>
      Effect.tryPromise({
        try: async () => {
          await Promise.resolve(
            client.app?.log?.({
              body: {
                service: PLUGIN_SERVICE,
                level: entry.level,
                message: entry.message,
                extra: entry.extra,
              },
            }),
          )
        },
        catch: (cause) =>
          new OpencodeClientError({
            operation: "client.app.log",
            message: "Failed to write to the opencode app log",
            cause,
          }),
      }),
  })

export const makeTuiLoggerLayer = (api: {
  readonly ui?: {
    readonly toast?: (input: {
      message: string
      variant?: "error" | "info" | "success" | "warning"
    }) => void
  }
  readonly client?: {
    readonly app?: {
      readonly log?: (request?: any) => unknown
    }
  }
}) =>
  Layer.succeed(PluginLogger, {
    log: (entry) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          api.ui?.toast?.({
            message: entry.message,
            variant: entry.level === "error" ? "error" : "info",
          })
        })

        yield* Effect.tryPromise({
          try: async () => {
            await Promise.resolve(
              api.client?.app?.log?.({
                body: {
                  service: PLUGIN_SERVICE,
                  level: entry.level,
                  message: entry.message,
                  extra: entry.extra,
                },
              }),
            )
          },
          catch: (cause) =>
            new OpencodeClientError({
              operation: "api.client.app.log",
              message: "Failed to write to the opencode app log",
              cause,
            }),
        })
      }),
  })
