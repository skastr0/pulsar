import { describe, expect, test } from "bun:test"
import {
  buildCompositeExplanation,
  compositeSignalInputs,
  resolveCompositeInputs,
  type CompositeInputSpec,
} from "../composite.js"

const inputSpecs = [
  {
    id: "MOCK-COMPLEXITY",
    aliases: ["MOCK-LD-01"],
    factorPath: "inputs.complexity",
    weight: 0.6,
    cacheFingerprint: "mock-complexity-policy-v1",
    rawValue: (value) => ({ max: (value as { max: number }).max }),
    normalize: (value) => (value as { max: number }).max / 10,
  },
  {
    id: "MOCK-CHURN",
    aliases: ["MOCK-CHURN-LEGACY"],
    factorPath: "inputs.churn",
    weight: 0.4,
    cacheFingerprint: "mock-churn-policy-v1",
    rawValue: (value) => ({ commits: (value as { commits: number }).commits }),
    normalize: (value) => (value as { commits: number }).commits / 20,
  },
  {
    id: "MOCK-COVERAGE",
    aliases: ["MOCK-COV"],
    optional: true,
    factorPath: "inputs.coverage",
    weight: 0.2,
  },
] satisfies ReadonlyArray<CompositeInputSpec>

describe("composite SDK", () => {
  test("converts composite specs to signal input dependencies", () => {
    expect(compositeSignalInputs(inputSpecs)).toEqual([
      { id: "MOCK-COMPLEXITY", cacheFingerprint: expect.any(String) },
      { id: "MOCK-CHURN", cacheFingerprint: expect.any(String) },
      {
        id: "MOCK-COVERAGE",
        optional: true,
        cacheFingerprint: expect.any(String),
      },
    ])
  })

  test("fingerprints input-level composite policy", () => {
    const firstInputSpec = inputSpecs[0] as CompositeInputSpec
    const [base] = compositeSignalInputs(inputSpecs)
    const [reweighted] = compositeSignalInputs([
      {
        ...firstInputSpec,
        weight: 0.7,
      },
    ])
    const [renormalized] = compositeSignalInputs([
      {
        ...firstInputSpec,
        cacheFingerprint: "mock-complexity-policy-v2",
      },
    ])
    const [aliasChanged] = compositeSignalInputs([
      {
        ...firstInputSpec,
        aliases: ["MOCK-LD-01", "MOCK-LEGACY-COMPLEXITY"],
      },
    ])
    const [factorPathChanged] = compositeSignalInputs([
      {
        ...firstInputSpec,
        factorPath: "inputs.renamed_complexity",
      },
    ])

    expect(base?.cacheFingerprint).toEqual(expect.any(String))
    expect(reweighted?.cacheFingerprint).not.toBe(base?.cacheFingerprint)
    expect(renormalized?.cacheFingerprint).not.toBe(base?.cacheFingerprint)
    expect(aliasChanged?.cacheFingerprint).not.toBe(base?.cacheFingerprint)
    expect(factorPathChanged?.cacheFingerprint).not.toBe(base?.cacheFingerprint)
  })

  test("requires a semantic fingerprint for callback-backed policy", () => {
    expect(() =>
      compositeSignalInputs([
        {
          id: "MOCK-COMPLEXITY",
          rawValue: (value) => value,
        },
      ]),
    ).toThrow(/must declare cacheFingerprint/)
  })

  test("resolves canonical ids, aliases, optional inputs, weights, and factor paths", () => {
    const resolution = resolveCompositeInputs(
      inputSpecs,
      new Map<string, unknown>([
        ["MOCK-LD-01", { max: 8 }],
        ["MOCK-CHURN", { commits: 12 }],
      ]),
    )

    expect(resolution.hasMissingRequiredInputs).toBe(false)
    expect(resolution.missingInputs).toEqual(["MOCK-COVERAGE"])
    expect(resolution.valueOf<{ max: number }>("MOCK-COMPLEXITY")?.max).toBe(8)
    expect(resolution.inputs.map((input) => input.state)).toEqual([
      "present",
      "present",
      "missing_optional",
    ])
    expect(resolution.inputs[0]).toMatchObject({
      id: "MOCK-COMPLEXITY",
      resolvedId: "MOCK-LD-01",
      factorPath: "inputs.complexity",
      weight: 0.6,
      rawValue: { max: 8 },
      normalizedValue: 0.8,
    })
  })

  test("tracks missing required inputs separately from optional gaps", () => {
    const resolution = resolveCompositeInputs(
      inputSpecs,
      new Map<string, unknown>([["MOCK-COV", { coverage: 0.8 }]]),
    )

    expect(resolution.hasMissingRequiredInputs).toBe(true)
    expect(resolution.missingRequiredInputs).toEqual([
      "MOCK-COMPLEXITY",
      "MOCK-CHURN",
    ])
    expect(resolution.missingInputs).toEqual(["MOCK-COMPLEXITY", "MOCK-CHURN"])
  })

  test("builds an explanation with primitive values, missing inputs, weights, and ceiling", () => {
    const resolution = resolveCompositeInputs(
      inputSpecs,
      new Map<string, unknown>([
        ["MOCK-COMPLEXITY", { max: 6 }],
        ["MOCK-CHURN-LEGACY", { commits: 10 }],
      ]),
    )

    const explanation = buildCompositeExplanation({
      inputs: resolution,
      finalScore: 0.72,
      rationale: "complexity and churn are both elevated",
      enforcementCeiling: ["trend", "review-routing", "dashboard"],
    })

    expect(explanation).toMatchObject({
      missingInputs: ["MOCK-COVERAGE"],
      finalScore: 0.72,
      rationale: "complexity and churn are both elevated",
      enforcementCeiling: ["trend", "review-routing", "dashboard"],
    })
    expect(explanation.weights).toEqual([
      { id: "MOCK-COMPLEXITY", weight: 0.6 },
      { id: "MOCK-CHURN", weight: 0.4 },
      { id: "MOCK-COVERAGE", weight: 0.2 },
    ])
    expect(explanation.primitiveInputs[1]).toMatchObject({
      id: "MOCK-CHURN",
      resolvedId: "MOCK-CHURN-LEGACY",
      rawValue: { commits: 10 },
      normalizedValue: 0.5,
    })
  })
})
