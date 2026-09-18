import { Config, Context, Effect, Layer, Redacted } from "effect"
import { JevConfigError, JevHttpError, JevTransportError } from "./errors.js"
import type { JevRequest } from "./protocol.js"

export const JEV_ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export const JEV_DEFAULT_TIMEOUT_MS = 30_000

export interface JevReceipt {
  readonly status: number
  readonly raw: string
  readonly requestId: string | null
  readonly elapsedMs: number
}

export interface JevClientService {
  readonly evaluate: (
    request: JevRequest,
  ) => Effect.Effect<JevReceipt, JevTransportError | JevHttpError>
}

export class JevClient extends Context.Service<JevClient, JevClientService>()("pulsar/cli/JevClient") {}

export interface JevClientOptions {
  readonly apiKey: Redacted.Redacted<string>
  readonly fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  readonly timeoutMs?: number
  readonly endpoint?: string
}

const evaluateRequest = (
  options: JevClientOptions,
  request: JevRequest,
): Effect.Effect<JevReceipt, JevTransportError | JevHttpError> => {
  const fetcher = options.fetcher ?? fetch
  const timeoutMs = options.timeoutMs ?? JEV_DEFAULT_TIMEOUT_MS
  const endpoint = options.endpoint ?? JEV_ENDPOINT
  const start = performance.now()
  return Effect.tryPromise({
    try: async (signal) => {
      const httpResponse = await fetcher(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${Redacted.value(options.apiKey)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      })
      return {
        status: httpResponse.status,
        raw: await httpResponse.text(),
        requestId: httpResponse.headers.get("x-typesafe-request-id"),
        elapsedMs: performance.now() - start,
      } satisfies JevReceipt
    },
    catch: () => new JevTransportError({ reason: "network_or_timeout" }),
  }).pipe(
    Effect.flatMap((receipt) =>
      receipt.status === 200
        ? Effect.succeed(receipt)
        : Effect.fail(
            new JevHttpError({
              status: receipt.status,
              requestId: receipt.requestId,
            }),
          ),
    ),
  )
}

export const makeJevClient = (options: JevClientOptions): JevClientService => ({
  evaluate: Effect.fn("JevClient.evaluate")(function* (request: JevRequest) {
    return yield* evaluateRequest(options, request)
  }),
})

export const jevClientLayer = (options: JevClientOptions): Layer.Layer<JevClient> =>
  Layer.succeed(JevClient, makeJevClient(options))

export const jevClientLayerFromEnv: Layer.Layer<JevClient, JevConfigError> = Layer.effect(
  JevClient,
  Effect.gen(function* () {
    const apiKey = yield* Config.redacted("TYPESAFE_API_KEY").pipe(
      Effect.mapError(
        () =>
          new JevConfigError({
            reason: "missing_api_key",
            message: "TYPESAFE_API_KEY is not set",
          }),
      ),
    )
    return makeJevClient({ apiKey })
  }),
)
