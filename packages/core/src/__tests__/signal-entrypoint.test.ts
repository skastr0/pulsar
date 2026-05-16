import { describe, expect, test } from "bun:test"

describe("@skastr0/pulsar-core/signal entrypoint", () => {
  test("publishes the composite SDK helpers from the built signal API", async () => {
    const signalApi = await import("@skastr0/pulsar-core/signal")

    expect(typeof signalApi.compositeSignalInputs).toBe("function")
    expect(typeof signalApi.resolveCompositeInputs).toBe("function")
    expect(typeof signalApi.buildCompositeExplanation).toBe("function")
  })
})

describe("@skastr0/pulsar-core/ai-facts entrypoint", () => {
  test("publishes AI fact artifact replay helpers", async () => {
    const aiFacts = await import("@skastr0/pulsar-core/ai-facts")

    expect(typeof aiFacts.decodeAiFactLabelArtifactSync).toBe("function")
    expect(typeof aiFacts.computeAiFactCacheFingerprint).toBe("function")
    expect(typeof aiFacts.replayAiFactArtifact).toBe("function")
  })
})
