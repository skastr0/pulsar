import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@skastr0/pulsar-project-module-sdk"
import {
  EFFECT_OR_ELSE_SUCCEED_NOOP_RULE_ID,
  EFFECT_PROJECT_MODULE_ID,
  effectProjectModule,
  isEffectOrElseSucceedNoopCandidate,
} from "../index.js"

const repoFacts: RepoFacts = {
  repoRoot: "/repo",
  fingerprint: "repo-facts-v1",
  detectedTechnologies: ["effect", "typescript"],
  sourceExtensions: [".ts"],
}

describe("effect project module", () => {
  test("exports a technology-scoped noop classifier contribution", () => {
    expect(effectProjectModule.descriptor).toMatchObject({
      id: EFFECT_PROJECT_MODULE_ID,
      scope: "technology",
      source: "package",
      contributions: [
        {
          slot: "typescript.noop-classifier",
          processorId: "effect-or-else-succeed-noops",
          role: "normalizer",
          priority: 20,
          fingerprint: "effect-or-else-succeed-noops-v1",
        },
      ],
    })
  })

  test("detects Effect.orElseSucceed empty fallback candidates", () => {
    expect(isEffectOrElseSucceedNoopCandidate({
      file: "/repo/src/effect.ts",
      name: "fallback",
      line: 1,
      nodeKind: "ArrowFunction",
      functionText: "() => {}",
      parentText: "Effect.orElseSucceed(() => {})",
      classification: "stub",
    })).toBe(true)
    expect(isEffectOrElseSucceedNoopCandidate({
      file: "/repo/src/effect.ts",
      name: "fallback",
      line: 1,
      nodeKind: "ArrowFunction",
      functionText: "() => { return 1 }",
      parentText: "Effect.orElseSucceed(() => { return 1 })",
      classification: "stub",
    })).toBe(false)
  })

  test("classifies Effect.orElseSucceed empty fallback callbacks with attribution", async () => {
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [effectProjectModule.activeModule],
      processors: effectProjectModule.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.noop-classifier", {
        file: "/repo/src/effect.ts",
        name: "fallback",
        line: 1,
        nodeKind: "ArrowFunction",
        functionText: "() => {}",
        parentText: "Effect.orElseSucceed(() => {})",
        classification: "stub",
      }),
    )

    expect(result.value.classification).toBe("intentional_noop")
    expect(result.value.metadata).toMatchObject({ technology: "effect" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: EFFECT_PROJECT_MODULE_ID,
      processorId: "effect-or-else-succeed-noops",
      slot: "typescript.noop-classifier",
      action: "classify-intentional_noop",
      ruleId: EFFECT_OR_ELSE_SUCCEED_NOOP_RULE_ID,
      confidence: "high",
    })
  })
})
