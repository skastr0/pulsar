import { describe, expect, test } from "bun:test"

describe("@skastr0/pulsar-core/signal entrypoint", () => {
  test("publishes the composite SDK helpers from the built signal API", async () => {
    const signalApi = await import("@skastr0/pulsar-core/signal")

    expect(typeof signalApi.compositeSignalInputs).toBe("function")
    expect(typeof signalApi.resolveCompositeInputs).toBe("function")
    expect(typeof signalApi.buildCompositeExplanation).toBe("function")
  })
})
