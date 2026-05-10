import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import {
  assertValidFactorDefinitions,
  buildRegistry,
  computeConfigHash,
  makeFactorEntry,
  makeFactorLedger,
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
): Signal<FactorConfig, { readonly count: number }> => ({
  id: "TEST-FACTORS",
  title: "Factor test signal",
  tier: 1,
  category: "generated-slop",
  kind: "structural",
  configSchema: FactorConfig,
  defaultConfig: {},
  factorDefinitions,
  inputs: [],
  compute: () => Effect.succeed({ count: 1 }),
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
})
