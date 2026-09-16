import { Context, Data, Effect, Layer } from "effect"
import type { Request } from "./model.ts"

export const ENDPOINT = "https://api.typesafe.ai/v1/systemone"
export class TransportError extends Data.TaggedError("TransportError")<{
  readonly reason: "network_or_timeout"
}> {}

export interface Receipt {
  readonly status: number
  readonly raw: string
  readonly requestId: string | null
  readonly elapsedMs: number
}

export class JudgmentProvider extends Context.Service<JudgmentProvider, {
  readonly evaluate: (request: Request) => Effect.Effect<Receipt, TransportError>
}>()("jev-spike/JudgmentProvider") {}

export function jevLayer(apiKey: string, fetcher: typeof fetch = fetch, timeoutMs = 30_000) {
  return Layer.succeed(JudgmentProvider, {
    evaluate: Effect.fn("Jev.evaluate")(function* (request: Request) {
      const start = performance.now()
      // No retries in the research epoch: retain failures rather than favorable reruns.
      return yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetcher(ENDPOINT, {
            method: "POST",
            redirect: "error",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(request),
            signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
          })
          return {
            status: response.status,
            raw: await response.text(),
            requestId: response.headers.get("x-typesafe-request-id"),
            elapsedMs: performance.now() - start,
          }
        },
        // Do not serialize fetch exceptions, which may contain request headers.
        catch: () => new TransportError({ reason: "network_or_timeout" }),
      })
    }),
  })
}
