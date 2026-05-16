import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  type AiFactLabelArtifact,
  type AiFactReplayOutput,
  computeAiFactCacheFingerprint,
  decodeAiFactLabelArtifactSync,
  replayAiFactArtifact,
  serializeAiFactReplayOutput,
} from "../ai-facts.js"
import {
  ObserverOutput as ObserverOutputSchema,
  observe,
  toObserverJson,
  type ObserverOutput,
} from "../observer.js"
import { buildRegistry } from "../registry.js"
import type { Signal } from "../signal.js"

const fixturePath = join(
  import.meta.dir,
  "fixtures/ai-facts/architectural-role.sample.json",
)

const readFixture = async () =>
  decodeAiFactLabelArtifactSync(JSON.parse(await readFile(fixturePath, "utf8")))

const makeAiReplaySignal = (
  artifact: AiFactLabelArtifact,
): Signal<Record<string, never>, AiFactReplayOutput, never> => ({
  id: "AI-FACT-ARCHITECTURAL-ROLE",
  tier: 3,
  category: "architectural-drift",
  kind: "structural",
  configSchema: Schema.Struct({}),
  defaultConfig: {},
  inputs: [],
  compute: () => Effect.succeed(replayAiFactArtifact(artifact)),
  score: (output) => 1 - output.label.confidence * 0.1,
  diagnose: (output) => [
    {
      severity: "warn",
      message: `AI fact ${output.label.kind}: ${String(output.label.value)}`,
      data: {
        artifact_id: output.artifact_id,
        cache_fingerprint: output.cache_fingerprint,
        enforcement_ceiling: output.policy.enforcement_ceiling,
        fact_source: output.fact_source,
      },
    },
  ],
  outputMetadata: (output) => ({
    baseConfidence: output.label.confidence,
    computedAt: output.provenance.created_at,
    factSource: output.fact_source,
  }),
})

const observeAiFactArtifact = async (
  artifact: AiFactLabelArtifact,
): Promise<ObserverOutput> => {
  const registry = await Effect.runPromise(buildRegistry([makeAiReplaySignal(artifact)]))
  return Effect.runPromise(
    observe(registry, undefined) as Effect.Effect<ObserverOutput, never, never>,
  )
}

describe("AI fact label artifacts", () => {
  test("offline replay of committed labels is byte-identical", async () => {
    const artifact = await readFixture()

    const first = serializeAiFactReplayOutput(replayAiFactArtifact(artifact))
    const second = serializeAiFactReplayOutput(replayAiFactArtifact(artifact))

    expect(first).toBe(second)
    expect(JSON.parse(JSON.stringify(replayAiFactArtifact(artifact))).fact_source)
      .toBe("ai_classified")
  })

  test("offline replay drives byte-identical scoring without model access", async () => {
    const artifact = await readFixture()

    const first = JSON.stringify(toObserverJson(await observeAiFactArtifact(artifact)))
    const second = JSON.stringify(toObserverJson(await observeAiFactArtifact(artifact)))

    expect(first).toBe(second)

    const observed = await observeAiFactArtifact(artifact)
    const publicJson = toObserverJson(observed)
    const decodedJson = Schema.decodeUnknownSync(ObserverOutputSchema)(publicJson)
    const result = observed.signalResults.get("AI-FACT-ARCHITECTURAL-ROLE")

    expect(result?.output).toMatchObject({
      artifact_id: artifact.artifact_id,
      fact_source: "ai_classified",
      policy: { enforcement_ceiling: "soft-warning" },
    })
    expect(decodedJson.signal_metadata?.["AI-FACT-ARCHITECTURAL-ROLE"]?.factSource)
      .toBe("ai_classified")
    expect(result?.diagnostics[0]?.data).toMatchObject({
      enforcement_ceiling: "soft-warning",
      fact_source: "ai_classified",
    })
  })

  test("cache fingerprint includes content hash, prompt, model, classifier version, and input scope", async () => {
    const artifact = await readFixture()
    const base = computeAiFactCacheFingerprint(artifact)

    expect(computeAiFactCacheFingerprint({
      ...artifact,
      input: { ...artifact.input, content_hash: "sha256:other-content" },
    })).not.toBe(base)
    expect(computeAiFactCacheFingerprint({
      ...artifact,
      classifier: { ...artifact.classifier, prompt_id: "architectural-role.v2" },
    })).not.toBe(base)
    expect(computeAiFactCacheFingerprint({
      ...artifact,
      classifier: { ...artifact.classifier, model_id: "grok-4" },
    })).not.toBe(base)
    expect(computeAiFactCacheFingerprint({
      ...artifact,
      classifier: { ...artifact.classifier, version: "2.0.0" },
    })).not.toBe(base)
    expect(computeAiFactCacheFingerprint({
      ...artifact,
      input: { ...artifact.input, scope: "module" },
    })).not.toBe(base)
  })

  test("artifact policy cannot declare hard-gate enforcement", async () => {
    const artifact = await readFixture()

    expect(artifact.policy.enforcement_ceiling).toBe("soft-warning")
    expect(() =>
      decodeAiFactLabelArtifactSync({
        ...artifact,
        policy: { ...artifact.policy, enforcement_ceiling: "hard-gate" },
      }),
    ).toThrow()
  })
})
