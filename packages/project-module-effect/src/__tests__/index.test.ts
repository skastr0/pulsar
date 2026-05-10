import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import {
  makeResolvedCalibrationContext,
  type RepoFacts,
} from "@skastr0/pulsar-project-module-sdk"
import {
  EFFECT_CALLBACK_CONTEXT_NAME_RULE_ID,
  EFFECT_OR_ELSE_SUCCEED_NOOP_RULE_ID,
  EFFECT_PROJECT_MODULE_ID,
  EFFECT_PROTOTYPE_FACTORY_NOOP_RULE_ID,
  EFFECT_SERVER_REACTIVE_CONTRACT_NOOP_RULE_ID,
  effectProjectModule,
  isEffectOrElseSucceedNoopCandidate,
  isEffectPrototypeFactoryNoopCandidate,
  isEffectServerReactiveContractNoopCandidate,
  resolveEffectCallbackContextName,
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
        {
          slot: "typescript.noop-classifier",
          processorId: "effect-server-reactive-contract-noops",
          role: "normalizer",
          priority: 20,
          fingerprint: "effect-server-reactive-contract-noops-v1",
        },
        {
          slot: "typescript.noop-classifier",
          processorId: "effect-prototype-factory-noops",
          role: "normalizer",
          priority: 20,
          fingerprint: "effect-prototype-factory-noops-v1",
        },
        {
          slot: "typescript.callback-context-namer",
          processorId: "effect-callback-context-names",
          role: "enricher",
          priority: 20,
          fingerprint: "effect-callback-context-names-v1",
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

  test("detects Effect prototype factory empty shell candidates", () => {
    expect(isEffectPrototypeFactoryNoopCandidate({
      file: "/repo/packages/effect/src/internal/context.ts",
      name: "TagClass",
      line: 91,
      nodeKind: "FunctionDeclaration",
      bodyText: "{}",
      functionText: "function TagClass() {}",
      parentText: [
        "function TagClass() {}",
        "Object.setPrototypeOf(TagClass, TagProto)",
        "TagClass.key = id",
        "return TagClass as any",
      ].join("\n"),
      classification: "stub",
    })).toBe(true)

    expect(isEffectPrototypeFactoryNoopCandidate({
      file: "/repo/packages/effect/src/Pipeable.ts",
      name: "PipeableBase",
      line: 547,
      nodeKind: "FunctionDeclaration",
      bodyText: "{}",
      functionText: "function PipeableBase() {}",
      parentText: [
        "function PipeableBase() {}",
        "PipeableBase.prototype = Prototype",
        "return PipeableBase as any",
      ].join("\n"),
      classification: "stub",
    })).toBe(true)

    expect(isEffectPrototypeFactoryNoopCandidate({
      file: "/repo/packages/ai/ai/src/Toolkit.ts",
      name: "makeProto/Object.assign",
      line: 382,
      nodeKind: "FunctionExpression",
      bodyText: "{}",
      functionText: "function() {}",
      parentText: "Object.assign(function() {}, Proto, { tools }) as any",
      classification: "stub",
    })).toBe(true)

    expect(isEffectPrototypeFactoryNoopCandidate({
      file: "/repo/src/ordinary.ts",
      name: "unfinished",
      line: 1,
      nodeKind: "FunctionDeclaration",
      bodyText: "{}",
      functionText: "function unfinished() {}",
      parentText: "function unfinished() {}",
      classification: "stub",
    })).toBe(false)

    expect(isEffectPrototypeFactoryNoopCandidate({
      file: "/repo/src/ordinary.ts",
      name: "Array.map callback",
      line: 1,
      nodeKind: "FunctionExpression",
      bodyText: "{}",
      functionText: "function() {}",
      parentText: "items.map(function() {})",
      classification: "stub",
    })).toBe(false)
  })

  test("detects Effect server reactive empty contract candidates", () => {
    expect(isEffectServerReactiveContractNoopCandidate({
      file: "/repo/src/server/reactive.ts",
      name: "createEffect",
      line: 1,
      nodeKind: "FunctionDeclaration",
      bodyText: "{}",
      functionText: "export function createEffect<T>(fn: (value?: T) => T): void {}",
      parentText: "export function createEffect<T>(fn: (value?: T) => T): void {}",
      classification: "stub",
    })).toBe(true)
    expect(isEffectServerReactiveContractNoopCandidate({
      file: "/repo/src/app.ts",
      name: "createEffect",
      line: 1,
      nodeKind: "FunctionDeclaration",
      bodyText: "{}",
      functionText: "export function createEffect<T>(fn: (value?: T) => T): void {}",
      parentText: "export function createEffect<T>(fn: (value?: T) => T): void {}",
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

  test("classifies Effect server reactive empty contracts with attribution", async () => {
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [effectProjectModule.activeModule],
      processors: effectProjectModule.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.noop-classifier", {
        file: "/repo/src/server/reactive.ts",
        name: "onMount",
        line: 1,
        nodeKind: "FunctionDeclaration",
        bodyText: "{}",
        functionText: "export function onMount(fn: () => void) {}",
        parentText: "export function onMount(fn: () => void) {}",
        classification: "stub",
      }),
    )

    expect(result.value.classification).toBe("intentional_noop")
    expect(result.value.metadata).toMatchObject({ technology: "effect", framework: "server-reactive" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: EFFECT_PROJECT_MODULE_ID,
      processorId: "effect-server-reactive-contract-noops",
      slot: "typescript.noop-classifier",
      action: "classify-intentional_noop",
      ruleId: EFFECT_SERVER_REACTIVE_CONTRACT_NOOP_RULE_ID,
      confidence: "high",
    })
  })

  test("classifies Effect prototype factory empty shells with attribution", async () => {
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [effectProjectModule.activeModule],
      processors: effectProjectModule.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.noop-classifier", {
        file: "/repo/packages/platform/src/HttpApi.ts",
        name: "HttpApi",
        line: 243,
        nodeKind: "FunctionDeclaration",
        bodyText: "{}",
        functionText: "function HttpApi() {}",
        parentText: [
          "function HttpApi() {}",
          "Object.setPrototypeOf(HttpApi, Proto)",
          "HttpApi.groups = options.groups",
          "return HttpApi as any",
        ].join("\n"),
        classification: "stub",
      }),
    )

    expect(result.value.classification).toBe("intentional_noop")
    expect(result.value.metadata).toMatchObject({ technology: "effect", pattern: "prototype-factory" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: EFFECT_PROJECT_MODULE_ID,
      processorId: "effect-prototype-factory-noops",
      slot: "typescript.noop-classifier",
      action: "classify-intentional_noop",
      ruleId: EFFECT_PROTOTYPE_FACTORY_NOOP_RULE_ID,
      confidence: "high",
    })
  })

  test("resolves Effect callback context names from structural metadata", () => {
    expect(resolveEffectCallbackContextName({
      file: "/repo/src/session.ts",
      line: 1,
      fallbackName: "<anonymous>",
      resolvedName: "create/Effect.fn",
      metadata: {
        calleeText: "Effect.fn",
        effectFnLabel: "Session.create",
        ownerName: "create",
      },
    })).toBe("Session.create")

    expect(resolveEffectCallbackContextName({
      file: "/repo/src/session.ts",
      line: 8,
      fallbackName: "<anonymous>",
      resolvedName: "run/Effect.gen",
      metadata: {
        calleeText: "Effect.gen",
        ownerName: "run",
      },
    })).toBe("run/Effect.gen")

    expect(resolveEffectCallbackContextName({
      file: "/repo/src/session.ts",
      line: 16,
      fallbackName: "<anonymous>",
      resolvedName: "load/Effect.forEach",
      metadata: {
        calleeText: "Effect.forEach",
        ownerName: "load",
        argumentIndex: 1,
      },
    })).toBe("load/Effect.forEach/each")

    expect(resolveEffectCallbackContextName({
      file: "/repo/src/session.ts",
      line: 24,
      fallbackName: "handler",
      resolvedName: "handler",
      metadata: {
        calleeText: "Array.map",
        ownerName: "load",
      },
    })).toBeUndefined()
  })

  test("names Effect callback contexts with attribution", async () => {
    const context = makeResolvedCalibrationContext({
      repoFacts,
      activeModules: [effectProjectModule.activeModule],
      processors: effectProjectModule.processors,
    })

    const result = await Effect.runPromise(
      context.runSlot("typescript.callback-context-namer", {
        file: "/repo/src/session.ts",
        line: 12,
        fallbackName: "<anonymous>",
        resolvedName: "create/Effect.fn",
        metadata: {
          calleeText: "Effect.fn",
          effectFnLabel: "Session.create",
          ownerName: "create",
        },
      }),
    )

    expect(result.value.resolvedName).toBe("Session.create")
    expect(result.value.metadata).toMatchObject({ technology: "effect" })
    expect(result.decisions[0]).toMatchObject({
      moduleId: EFFECT_PROJECT_MODULE_ID,
      processorId: "effect-callback-context-names",
      slot: "typescript.callback-context-namer",
      action: "name-callback-context",
      ruleId: EFFECT_CALLBACK_CONTEXT_NAME_RULE_ID,
      confidence: "high",
    })
  })
})
