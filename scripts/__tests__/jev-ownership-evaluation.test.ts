import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { compileOwnershipRequestSync } from "../../packages/cli/src/jev/index.ts"
import { EVALUATION_CASES, FORBIDDEN_SOURCE_SUBSTRINGS } from "../jev-ownership-evaluation/cases.ts"
import { HOST_SCENARIOS, SEALED_EXPECTATIONS, expectationOf } from "../jev-ownership-evaluation/expectations.ts"
import {
  aggregateOwnershipAttainment,
  comparisonVersusTarget,
} from "../jev-ownership-evaluation/host-score.ts"
import { FORBIDDEN_REQUEST_KEYS, buildLiveArms } from "../jev-ownership-evaluation/requests.ts"
import {
  CALLER_PREVIEW_COPY,
  CALLER_PREVIEW_DELEGATED,
  CALLER_SAMPLE_COPY,
  CALLER_SUBMIT_COPY,
  OWNER_PUBLISH,
  PUBLISH_PREDICATE,
  SAMPLE_PREDICATE,
  SAMPLE_TABLE,
} from "../jev-ownership-evaluation/sources.ts"

const walkForbiddenKeys = (value: unknown, path: string, hits: Array<string>): void => {
  if (Array.isArray(value)) {
    value.forEach((child, index) => walkForbiddenKeys(child, `${path}[${index}]`, hits))
    return
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if ((FORBIDDEN_REQUEST_KEYS as ReadonlyArray<string>).includes(key)) hits.push(`${path}.${key}`)
      walkForbiddenKeys(child, `${path}.${key}`, hits)
    }
  }
}

describe("independent ownership evaluation fixtures", () => {
  test("source snapshots carry no labels, fixture ids, or preference names", () => {
    for (const spec of EVALUATION_CASES) {
      for (const source of spec.sources) {
        const haystack = `${source.path}\n${source.bytes}`.toLowerCase()
        for (const needle of FORBIDDEN_SOURCE_SUBSTRINGS) {
          expect(haystack.includes(needle.toLowerCase()), `${spec.id} ${source.path} contains ${needle}`).toBe(false)
        }
      }
    }
  })

  test("arrangements are mechanically present in source text", () => {
    const copies = EVALUATION_CASES.find((entry) => entry.arrangement === "identical-copies")!
    expect(copies.sources.map((source) => source.bytes)).toEqual([CALLER_PREVIEW_COPY, CALLER_SUBMIT_COPY])
    expect(copies.sources.every((source) => source.bytes.includes(PUBLISH_PREDICATE))).toBe(true)
    expect(copies.sources.some((source) => source.bytes.includes("from \"./publish-rule.ts\""))).toBe(false)

    const delegated = EVALUATION_CASES.find((entry) => entry.arrangement === "delegated-owner")!
    expect(delegated.sources[0]!.bytes).toBe(OWNER_PUBLISH)
    expect(delegated.sources.slice(1).every((source) => source.bytes.includes("from \"./publish-rule.ts\""))).toBe(true)
    expect(delegated.sources.slice(1).every((source) => source.bytes.includes(PUBLISH_PREDICATE))).toBe(false)

    const mixed = EVALUATION_CASES.find((entry) => entry.arrangement === "mixed-copy-and-delegate")!
    expect(mixed.sources.some((source) => source.bytes === CALLER_PREVIEW_DELEGATED)).toBe(true)
    expect(mixed.sources.some((source) => source.bytes.includes(PUBLISH_PREDICATE) && !source.bytes.includes("export function mayPublish"))).toBe(true)

    const distinct = EVALUATION_CASES.find((entry) => entry.arrangement === "distinct-domain-same-shape")!
    expect(distinct.sources.some((source) => source.bytes.includes(PUBLISH_PREDICATE))).toBe(true)
    expect(distinct.sources.some((source) => source.bytes.includes(SAMPLE_TABLE) && source.bytes.includes(SAMPLE_PREDICATE))).toBe(true)
    expect(distinct.sources.some((source) => source.bytes === CALLER_SAMPLE_COPY)).toBe(true)

    const extracted = EVALUATION_CASES.find((entry) => entry.arrangement === "extracted-owner")!
    expect(extracted.sources.filter((source) => source.bytes.includes("from \"./publish-rule.ts\"")).length).toBe(3)
    expect(extracted.sources.filter((source) => source.bytes.includes(PUBLISH_PREDICATE)).length).toBe(1)
  })

  test("sealed expectations are complete, opposite-policy, and not imported by request construction", () => {
    const requestSource = readFileSync(resolve(import.meta.dir, "../jev-ownership-evaluation/requests.ts"), "utf8")
    expect(requestSource).not.toContain("from \"./expectations")
    expect(requestSource).not.toContain("SEALED")
    const compareSource = readFileSync(resolve(import.meta.dir, "../jev-ownership-evaluation/compare.ts"), "utf8")
    expect(compareSource).toContain("expectationOf")

    for (const spec of EVALUATION_CASES) {
      if (spec.rubricKind === "both") {
        expect(expectationOf(spec.id, "shared_domain_rule").caseId).toBe(spec.id)
        expect(expectationOf(spec.id, "caller_local").caseId).toBe(spec.id)
      } else if (spec.rubricKind === "conflict") {
        expect(expectationOf(spec.id, "conflict").status).toBe("unresolved")
      } else {
        expect(expectationOf(spec.id, "stretch-shared").caseId).toBe(spec.id)
      }
    }
    expect(SEALED_EXPECTATIONS).toHaveLength(EVALUATION_CASES.filter((spec) => spec.rubricKind === "both").length * 2 + 3)
  })

  test("asymmetric labels are not softened: copies stay contrary under shared preference", () => {
    expect(expectationOf("g1", "shared_domain_rule")).toMatchObject({ status: "resolved", anchor: "contrary", hostValue: 0 })
    expect(expectationOf("g1", "caller_local")).toMatchObject({ status: "resolved", anchor: "meets", hostValue: 1 })
    expect(expectationOf("g2", "shared_domain_rule")).toMatchObject({ anchor: "meets" })
    expect(expectationOf("g2", "caller_local")).toMatchObject({ anchor: "contrary" })
    expect(expectationOf("g4", "shared_domain_rule").status).toBe("not_applicable")
    expect(expectationOf("g20", "stretch-shared").anchor).toBe("meets")
    expect(expectationOf("g21", "stretch-shared").anchor).toBe("contrary")
  })

  test("compiled provider state omits group ids, expectations, and local metadata", () => {
    for (const arm of buildLiveArms()) {
      const compiled = compileOwnershipRequestSync(arm.input)
      const hits: Array<string> = []
      walkForbiddenKeys(compiled.request.state, "state", hits)
      expect(hits).toEqual([])
      const encoded = JSON.stringify(compiled.request.state)
      expect(encoded).not.toContain("obl-publish")
      expect(encoded).not.toContain("obl-sample")
      expect(encoded).not.toContain("expected")
      expect(encoded).not.toContain("fixture")
      expect(encoded).not.toContain(arm.caseId)
      expect(compiled.request.questions.ownership?.type).toBe("choice")
      const criteria = compiled.request.questions.ownership?.type === "choice"
        ? compiled.request.questions.ownership.criteria
        : {}
      expect(Object.keys(criteria)).toContain("unknown")
      expect(Object.keys(criteria)).toContain("not_applicable")
    }
  })

  test("live matrix is near 100 independent calls and covers opposite policies", () => {
    const arms = buildLiveArms()
    expect(arms.length).toBeGreaterThanOrEqual(90)
    expect(arms.length).toBeLessThanOrEqual(120)
    const arrangements = new Set(arms.map((arm) => arm.arrangement))
    expect(arrangements.has("identical-copies")).toBe(true)
    expect(arrangements.has("distinct-domain-same-shape")).toBe(true)
    expect(arrangements.has("healthy-padding-with-copy")).toBe(true)
    expect(arrangements.has("conflicting-preference-text")).toBe(true)
    expect(arms.some((arm) => arm.perturbation === "anchor-order")).toBe(true)
    expect(arms.filter((arm) => arm.preference === "shared_domain_rule").length).toBeGreaterThan(30)
    expect(arms.filter((arm) => arm.preference === "caller_local").length).toBeGreaterThan(30)
  })
})

describe("host min-attainment contract", () => {
  test("padding cannot erase a shortfall and unresolved evidence abstains", () => {
    for (const scenario of HOST_SCENARIOS) {
      const aggregate = aggregateOwnershipAttainment({
        policyPresent: "policyPresent" in scenario ? scenario.policyPresent : true,
        declaredGroupIds: [...scenario.declaredGroupIds],
        labels: scenario.labels.map((label) => ({ ...label })),
        stretchDeclared: scenario.id === "host-stretch-clamp",
      })
      expect(aggregate.applicability, scenario.id).toBe(scenario.expectedApplicability)
      if ("expectedAttainment" in scenario) {
        expect(aggregate.attainment, scenario.id).toBe(scenario.expectedAttainment)
        expect(aggregate.score, scenario.id).toBe(
          "expectedScore" in scenario ? scenario.expectedScore : Math.min(1, scenario.expectedAttainment),
        )
      }
      if ("expectedObserved" in scenario) {
        expect(aggregate.observedAttainment, scenario.id).toBe(scenario.expectedObserved)
        expect(aggregate.score, scenario.id).toBeUndefined()
      }
    }
    const stretch = aggregateOwnershipAttainment({
      policyPresent: true,
      declaredGroupIds: ["a"],
      labels: [{ groupId: "a", status: "resolved", anchorId: "exceeds", anchorValue: 1.2 }],
      stretchDeclared: true,
    })
    expect(comparisonVersusTarget(stretch)).toBe("exceeds")
    expect(stretch.score).toBe(1)
  })

  test("duplicate group ids fail closed", () => {
    expect(() =>
      aggregateOwnershipAttainment({
        policyPresent: true,
        declaredGroupIds: ["a", "a"],
        labels: [],
      }),
    ).toThrow(/duplicate group_id/)
  })
})
