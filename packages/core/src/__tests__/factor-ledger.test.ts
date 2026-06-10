import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  applySignalFactorPolicy,
  configFactorOverridesOf,
  makeSignalFactorPolicyContext,
} from "../factor-ledger.js"
import {
  assertValidFactorDefinitions,
  applyFactorOverrides,
  makeFactorEntry,
  makeFactorLedger,
  SignalFactorPolicyTag,
  overriddenFactorValue,
  validateFactorDefinitions,
  withConfigFactorLedger,
} from "../factors.js"
import {
  buildRegistry,
  computeConfigHash,
  runSignal,
} from "../scoring.js"
import {
  type Signal,
  type SignalFactorDefinition,
} from "../signal-api.js"
import type {
  SignalFactorLedger,
  SignalFactorValue,
} from "../signal-factor-model.js"
import {
  decodePulsarVector,
  resolvedConfig,
  type PulsarVector,
} from "../vector.js"

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

const makeConfigSignal = (options: {
  readonly id: string
  readonly aliases?: ReadonlyArray<string>
  readonly defaultConfig: Record<string, unknown>
}): Signal<Record<string, unknown>, { readonly count: number }, any> =>
  withConfigFactorLedger({
    id: options.id,
    ...(options.aliases !== undefined ? { aliases: options.aliases } : {}),
    title: `${options.id} config provenance signal`,
    tier: 1,
    category: "generated-slop",
    kind: "structural",
    configSchema: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
    defaultConfig: options.defaultConfig,
    inputs: [],
    compute: () => Effect.succeed({ count: 1 }),
    score: () => 1,
    diagnose: () => [],
  })

const ledgerEntry = (ledger: SignalFactorLedger | undefined, path: string) =>
  ledger?.entries.find((entry) => entry.path === path)

const configLedgerOf = (
  signal: Signal<Record<string, unknown>, { readonly count: number }, any>,
): SignalFactorLedger => signal.factorLedger!({ count: 1 })!

describe("factor ledger config provenance", () => {
  test("vector override.config values appear in the ledger with vector provenance", async () => {
    const registry = await Effect.runPromise(
      buildRegistry([
        makeConfigSignal({
          id: "TEST-CONFIG-PROVENANCE",
          defaultConfig: { max_complexity: 20, allow_recursion: true },
        }),
      ]),
    )
    const vector = await Effect.runPromise(
      decodePulsarVector({
        id: "v1",
        domain: "typescript",
        signal_overrides: {
          "TEST-CONFIG-PROVENANCE": {
            config: { max_complexity: 15, unknown_knob: 4 },
          },
        },
      }),
    )

    const result = await Effect.runPromise(
      runSignal(registry, "TEST-CONFIG-PROVENANCE", vector) as Effect.Effect<any, any, never>,
    )

    expect(ledgerEntry(result.factorLedger, "config.max_complexity")).toMatchObject({
      value: 15,
      source: "vector",
      affectsScore: true,
      attribution: { ruleId: "vector.config-override" },
      mutations: [
        {
          path: "config.max_complexity",
          source: "vector",
          action: "override-factor",
          before: 20,
          after: 15,
          ruleId: "vector.config-override",
        },
      ],
    })
    expect(ledgerEntry(result.factorLedger, "config.allow_recursion")).toMatchObject({
      value: true,
      source: "signal-default",
    })
    expect(ledgerEntry(result.factorLedger, "config.unknown_knob")).toBeUndefined()
  })

  test("reports the enforced config for the groundwork-shaped vector, not signal defaults", async () => {
    const signals = [
      makeConfigSignal({
        id: "TS-LD-01-cyclomatic-complexity",
        aliases: ["TS-LD-01"],
        defaultConfig: { max_complexity: 20 },
      }),
      makeConfigSignal({
        id: "TS-LD-02-file-length",
        aliases: ["TS-LD-02"],
        defaultConfig: { max_file_loc: 300 },
      }),
      makeConfigSignal({
        id: "TS-SL-01-comment-noise",
        aliases: ["TS-SL-01"],
        defaultConfig: { min_tokens: 12 },
      }),
      makeConfigSignal({
        id: "TS-RP-01-churn",
        aliases: ["TS-RP-01"],
        defaultConfig: { min_churn: 2 },
      }),
    ]
    const registry = await Effect.runPromise(buildRegistry(signals))
    const vector = await Effect.runPromise(
      decodePulsarVector({
        id: "groundwork",
        domain: "typescript",
        signal_overrides: {
          "TS-LD-01": { config: { max_complexity: 15 } },
          "TS-LD-02": { config: { max_file_loc: 500 } },
          "TS-SL-01": { config: { min_tokens: 8 } },
          "TS-RP-01": { config: { min_churn: 1 } },
        },
      }),
    )
    const expected = [
      ["TS-LD-01-cyclomatic-complexity", "config.max_complexity", "max_complexity", 15],
      ["TS-LD-02-file-length", "config.max_file_loc", "max_file_loc", 500],
      ["TS-SL-01-comment-noise", "config.min_tokens", "min_tokens", 8],
      ["TS-RP-01-churn", "config.min_churn", "min_churn", 1],
    ] as const

    for (const [signalId, factorPath, configKey, value] of expected) {
      const result = await Effect.runPromise(
        runSignal(registry, signalId, vector) as Effect.Effect<any, any, never>,
      )
      const signal = registry.byId.get(signalId)!
      const effective = resolvedConfig(signal, signal.defaultConfig, vector) as Record<
        string,
        unknown
      >

      expect(effective[configKey]).toBe(value)
      expect(ledgerEntry(result.factorLedger, factorPath)).toMatchObject({
        value,
        source: "vector",
        attribution: { ruleId: "vector.config-override" },
      })
    }
  })

  test("factor-form overrides keep winning over config-form overrides for the same key", () => {
    const signal = makeConfigSignal({
      id: "TEST-CONFIG-LAYERING",
      defaultConfig: { max_complexity: 20 },
    })
    const vector: PulsarVector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: {
        "TEST-CONFIG-LAYERING": {
          config: { max_complexity: 15 },
          factors: { "config.max_complexity": 11 },
        },
      },
    }

    const effective = resolvedConfig(signal, signal.defaultConfig, vector) as Record<
      string,
      unknown
    >
    const ledger = applySignalFactorPolicy(
      configLedgerOf(signal),
      makeSignalFactorPolicyContext(signal, vector),
    )

    expect(effective["max_complexity"]).toBe(11)
    expect(ledgerEntry(ledger, "config.max_complexity")).toMatchObject({
      value: 11,
      source: "vector",
      attribution: { ruleId: "vector.factor-override" },
      mutations: [
        {
          action: "override-factor",
          before: 20,
          after: 11,
          ruleId: "vector.factor-override",
        },
      ],
    })
    expect(configFactorOverridesOf(signal, vector)).toEqual({})
  })

  test("config-form mutations carry the vector source ref", () => {
    const signal = makeConfigSignal({
      id: "TEST-CONFIG-SOURCE-REF",
      defaultConfig: { max_complexity: 20 },
    })
    const vector: PulsarVector = {
      id: "v1",
      domain: "typescript",
      signal_overrides: {
        "TEST-CONFIG-SOURCE-REF": { config: { max_complexity: 15 } },
      },
    }

    const ledger = applySignalFactorPolicy(
      configLedgerOf(signal),
      makeSignalFactorPolicyContext(signal, vector, {
        vectorSourceRef: ".pulsar/vector.json",
      }),
    )

    expect(ledgerEntry(ledger, "config.max_complexity")).toMatchObject({
      value: 15,
      source: "vector",
      attribution: {
        ruleId: "vector.config-override",
        sourceRef: ".pulsar/vector.json",
      },
      mutations: [{ sourceRef: ".pulsar/vector.json" }],
    })
  })

  test("ledger effective values equal resolvedConfig for every override combination", () => {
    const defaults = {
      max_complexity: 20,
      min_tokens: 12,
      strictness: "balanced",
    } as const
    const configFormValues = {
      max_complexity: 15,
      min_tokens: 8,
      strictness: "high",
    } as const
    const factorFormValues = {
      max_complexity: 11,
      min_tokens: 6,
      strictness: "low",
    } as const
    const keys = Object.keys(defaults) as ReadonlyArray<keyof typeof defaults>
    const modes = ["none", "config", "factor", "both"] as const

    const combinations = modes.flatMap((first) =>
      modes.flatMap((second) => modes.map((third) => [first, second, third] as const)),
    )

    for (const combination of combinations) {
      const config: Record<string, unknown> = {}
      const factors: Record<string, unknown> = {}
      keys.forEach((key, index) => {
        const mode = combination[index]!
        if (mode === "config" || mode === "both") config[key] = configFormValues[key]
        if (mode === "factor" || mode === "both") factors[`config.${key}`] = factorFormValues[key]
      })
      const signal = makeConfigSignal({
        id: "TEST-CONFIG-PROPERTY",
        defaultConfig: { ...defaults },
      })
      const vector: PulsarVector = {
        id: `property-${combination.join("-")}`,
        domain: "typescript",
        signal_overrides: {
          "TEST-CONFIG-PROPERTY": {
            ...(Object.keys(config).length > 0 ? { config } : {}),
            ...(Object.keys(factors).length > 0 ? { factors } : {}),
          },
        },
      }

      const effective = resolvedConfig(signal, signal.defaultConfig, vector) as Record<
        string,
        unknown
      >
      const ledger = applySignalFactorPolicy(
        configLedgerOf(signal),
        makeSignalFactorPolicyContext(signal, vector),
      )

      keys.forEach((key, index) => {
        const entry = ledgerEntry(ledger, `config.${key}`)
        const mode = combination[index]!
        expect(entry?.value).toEqual(effective[key] as SignalFactorValue)
        expect(entry?.source).toBe(mode === "none" ? "signal-default" : "vector")
      })
    }
  })
})
