import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  assertValidFactorDefinitions,
  applyFactorOverrides,
  buildRegistry,
  computeConfigHash,
  makeFactorEntry,
  makeFactorLedger,
  SignalFactorPolicyTag,
  overriddenFactorValue,
  runSignal,
  validateFactorDefinitions,
  type Signal,
  type SignalFactorDefinition,
} from "../index.js"

const FactorConfig = Schema.Struct({})
type FactorConfig = typeof FactorConfig.Type

const scoreCapDefinition: SignalFactorDefinition = {
  path: "stub_kinds.throw-not-implemented.score_cap",
  title: "Throw-not-implemented score cap",
  valueKind: "number",
  scoreRole: "score-cap",
  defaultValue: 0.8,
}

const makeSignal = (
  factorDefinitions: ReadonlyArray<SignalFactorDefinition>,
): Signal<
  FactorConfig,
  { readonly count: number; readonly visibleVectorOverrideCount?: number },
  any
> => ({
  id: "TEST-FACTORS",
  title: "Factor test signal",
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  configSchema: FactorConfig,
  defaultConfig: {},
  factorDefinitions,
  inputs: [],
  compute: () =>
    Effect.gen(function* () {
      const factorPolicy = yield* Effect.serviceOption(SignalFactorPolicyTag)
      return {
        count: 1,
        ...(factorPolicy._tag === "Some"
          ? {
              visibleVectorOverrideCount: Object.keys(
                factorPolicy.value.vectorOverrides,
              ).length,
            }
          : {}),
      }
    }),
  score: () => 0.8,
  diagnose: () => [],
  factorLedger: () =>
    makeFactorLedger("TEST-FACTORS", [makeFactorEntry(scoreCapDefinition, 0.8)]),
})

describe("factor ledger", () => {
  test("validates stable factor paths and duplicate declarations", () => {
    expect(validateFactorDefinitions([scoreCapDefinition])).toEqual([])
    expect(() => assertValidFactorDefinitions([scoreCapDefinition])).not.toThrow()

    const issues = validateFactorDefinitions([
      scoreCapDefinition,
      { ...scoreCapDefinition },
      { ...scoreCapDefinition, path: "Bad Path" },
    ])

    expect(issues.map((issue) => issue.path)).toEqual([
      "stub_kinds.throw-not-implemented.score_cap",
      "Bad Path",
    ])
  })

  test("returns a JSON-serializable factor ledger from runSignal", async () => {
    const registry = await Effect.runPromise(buildRegistry([makeSignal([scoreCapDefinition])]))
    const result = await Effect.runPromise(
      runSignal(registry, "TEST-FACTORS") as Effect.Effect<any, any, never>,
    )

    expect(result.factorLedger).toEqual({
      signalId: "TEST-FACTORS",
      entries: [
        {
          path: "stub_kinds.throw-not-implemented.score_cap",
          title: "Throw-not-implemented score cap",
          scoreRole: "score-cap",
          value: 0.8,
          source: "computed",
          affectsScore: true,
        },
      ],
    })
    expect(JSON.parse(JSON.stringify(result.factorLedger))).toEqual(result.factorLedger)
  })

  test("applies vector factor overrides while preserving ledger paths", () => {
    const entries = [
      makeFactorEntry(scoreCapDefinition, 0.8, { source: "signal-default" }),
    ]

    expect(
      applyFactorOverrides(entries, {
        "stub_kinds.throw-not-implemented.score_cap": 0.6,
      }),
    ).toMatchObject([
      {
        path: "stub_kinds.throw-not-implemented.score_cap",
        title: "Throw-not-implemented score cap",
        scoreRole: "score-cap",
        value: 0.6,
        source: "vector",
        affectsScore: true,
        attribution: {
          ruleId: "vector.factor-override",
        },
        mutations: [
          {
            path: "stub_kinds.throw-not-implemented.score_cap",
            source: "vector",
            action: "override-factor",
            before: 0.8,
            after: 0.6,
            ruleId: "vector.factor-override",
          },
        ],
      },
    ])
    expect(
      overriddenFactorValue("stub_kinds.throw-not-implemented.score_cap", 0.8, {
        "stub_kinds.throw-not-implemented.score_cap": 0.6,
      }),
    ).toBe(0.6)
  })

  test("includes factor definitions in config cache hashes", async () => {
    const first = await Effect.runPromise(buildRegistry([makeSignal([scoreCapDefinition])]))
    const second = await Effect.runPromise(
      buildRegistry([
        makeSignal([
          { ...scoreCapDefinition, defaultValue: 0.6 },
        ]),
      ]),
    )

    expect(computeConfigHash("TEST-FACTORS", first, undefined)).not.toBe(
      computeConfigHash("TEST-FACTORS", second, undefined),
    )
  })

  test("includes vector factor overrides in config cache hashes", async () => {
    const registry = await Effect.runPromise(buildRegistry([makeSignal([scoreCapDefinition])]))
    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: {
        "TEST-FACTORS": {
          factors: { "stub_kinds.throw-not-implemented.score_cap": 0.6 },
        },
      },
    }

    expect(computeConfigHash("TEST-FACTORS", registry, undefined)).not.toBe(
      computeConfigHash("TEST-FACTORS", registry, vector),
    )
  })

  test("vector factor overrides win over module ledger entries with visible provenance", async () => {
    const moduleEntrySignal = makeSignal([scoreCapDefinition])
    const registry = await Effect.runPromise(buildRegistry([moduleEntrySignal]))
    const vector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: {
        "TEST-FACTORS": {
          factors: { "stub_kinds.throw-not-implemented.score_cap": 0.6 },
        },
      },
    }

    const result = await Effect.runPromise(
      runSignal(registry, "TEST-FACTORS", vector) as Effect.Effect<any, any, never>,
    )

    expect(result.output.visibleVectorOverrideCount).toBe(1)
    expect(result.factorLedger?.entries[0]).toMatchObject({
      path: "stub_kinds.throw-not-implemented.score_cap",
      value: 0.6,
      source: "vector",
      mutations: [
        {
          action: "override-factor",
          before: 0.8,
          after: 0.6,
          ruleId: "vector.factor-override",
        },
      ],
    })
  })

  test("vector overrides deterministically supersede module factor mutations", () => {
    const entries = [
      makeFactorEntry(scoreCapDefinition, 0.7, {
        source: "module",
        attribution: {
          moduleId: "acme.effect",
          processorId: "effect-unfinished-policy",
          ruleId: "effect.unfinished.accepted-placeholder.v1",
        },
      }),
    ]

    expect(
      applyFactorOverrides(entries, {
        "stub_kinds.throw-not-implemented.score_cap": 0.6,
      }),
    ).toMatchObject([
      {
        path: "stub_kinds.throw-not-implemented.score_cap",
        value: 0.6,
        source: "vector",
        attribution: {
          moduleId: "acme.effect",
          processorId: "effect-unfinished-policy",
          ruleId: "vector.factor-override",
        },
        mutations: [
          {
            action: "override-module-factor",
            before: 0.7,
            after: 0.6,
          },
        ],
      },
    ])
  })
})
