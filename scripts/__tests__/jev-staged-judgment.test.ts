import { afterAll, describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { Schema } from "effect"
import type { Response } from "../jev-spike/model.ts"
import { canonical, sha256, validateResponse } from "../jev-spike/model.ts"
import { buildShapeCandidates } from "../jev-spike/shape-candidates.ts"
import { cleanupTemps, evaluateGate, type GateResult } from "../jev-spike/staged-gate.ts"
import {
  RETAIN_WIDTH,
  answerChoice,
  branchPaths,
  buildBaseState,
  buildChildRequest,
  buildPolicyRequest,
  buildRelationshipRequest,
  interpretDirect,
  interpretStaged,
  loadFixture,
  resolveEligibility,
  retainedRoots,
  type BaseState,
  type StagedInstance,
} from "../jev-spike/staged-judgment.ts"
import {
  Plan as PlanSchema,
  establishedFacts,
  prepare,
  replay,
  validatePlan,
  type Plan,
} from "../jev-staged-judgment.ts"

const REPO = resolve(import.meta.dir, "../..")
const FIXTURE = loadFixture(REPO)
const CANDIDATES = buildShapeCandidates(REPO)

afterAll(() => cleanupTemps())

const variantFiles = (key: string): Record<string, string> => {
  const [subjectId, variant] = key.split(".")
  const bySubject = CANDIDATES[subjectId as keyof typeof CANDIDATES] as Record<string, Record<string, string>>
  const files = bySubject[variant ?? ""]
  if (files === undefined) throw new Error(`Unknown variant slot ${key}`)
  return files
}

const gateFor = async (instanceId: string): Promise<GateResult> => {
  const instance = FIXTURE.instances.find((entry) => entry.id === instanceId)
  if (instance === undefined) throw new Error(`Unknown instance ${instanceId}`)
  const subject = FIXTURE.subjects.find((entry) => entry.id === instance.subject)
  if (subject === undefined) throw new Error(`Unknown subject ${instance.subject}`)
  return evaluateGate(
    REPO,
    subject.id as "extraction" | "consolidation" | "representation",
    subject.obligations,
    { a: variantFiles(instance.variants.a), b: variantFiles(instance.variants.b) },
  )
}

const planCache = new Map<string, Promise<Plan>>()
const getPlan = (only: ReadonlyArray<string> = []): Promise<Plan> => {
  const key = only.join(",")
  let cached = planCache.get(key)
  if (cached === undefined) {
    cached = prepare(only)
    planCache.set(key, cached)
  }
  return cached
}

describe("staged gate: mechanically decidable obligations and relationship", () => {
  test("extraction and its obligation-breaking mutant", async () => {
    const clean = await gateFor("extraction")
    expect(clean.eligible).toEqual({ a: true, b: true })
    expect(clean.violations.a).toEqual([])
    expect(clean.violations.b).toEqual([])
    expect(clean.relationship.root).toBe("ownership_boundary_differs")
    expect(clean.relationship.child).toBe("shared_owner_single_contract")
    expect(clean.relationship.evidence.join(" ")).toContain("construction sites")

    const mutant = await gateFor("extraction-mutation")
    expect(mutant.eligible.a).toBe(true)
    expect(mutant.eligible.b).toBe(false)
    expect(mutant.violations.b.join(" ")).toContain("no_uncapped_block")
    expect(mutant.violations.b.join(" ")).toContain("block")
    expect(mutant.violations.a).toEqual([])
    expect(mutant.relationship.root).toBe("contract_or_behavior_differs")
    expect(mutant.relationship.child).toBe("runtime_behavior_differs")
  }, 180_000)

  test("consolidation and representation", async () => {
    const consolidation = await gateFor("consolidation")
    expect(consolidation.eligible).toEqual({ a: true, b: true })
    expect(consolidation.relationship.root).toBe("internal_decomposition_differs")
    // Directed: in this instance b dropped the helper boundary that a keeps.
    expect(consolidation.relationship.child).toBe("decomposition_not_via_helpers")
    expect(consolidation.relationship.evidence[0]).toContain("4")
    expect(consolidation.relationship.evidence[1]).toContain("exported: 0")

    const representation = await gateFor("representation")
    expect(representation.eligible).toEqual({ a: true, b: true })
    expect(representation.relationship.root).toBe("contract_or_behavior_differs")
    expect(representation.relationship.child).toBe("static_guarantee_differs")
    expect(representation.relationship.evidence.join(" ")).toContain("object literal is assignable")
  }, 180_000)

  test("the mechanical child label follows the direction of the question", async () => {
    const straight = await gateFor("consolidation")
    const swapped = await gateFor("consolidation-swapped")
    expect(straight.eligible).toEqual(swapped.eligible)
    expect(straight.relationship.root).toBe(swapped.relationship.root)
    // Same pair, opposite direction: b keeps the private helpers in the swapped instance.
    expect(straight.relationship.child).toBe("decomposition_not_via_helpers")
    expect(swapped.relationship.child).toBe("helpers_private_single_use")
  }, 180_000)
})

describe("taxonomy composition", () => {
  const instance: StagedInstance = FIXTURE.instances.find((entry) => entry.id === "consolidation")!
  const base: BaseState = buildBaseState(REPO, FIXTURE, instance, CANDIDATES)

  test("the root question carries child subtrees and excludes non-root nodes", () => {
    const request = buildRelationshipRequest(base, FIXTURE.taxonomy, "jev-latest")
    const criteria = request.questions["relationship"]!.criteria as Record<string, Record<string, unknown>>
    expect(Object.keys(criteria).sort()).toEqual([
      "contract_or_behavior_differs",
      "equivalent_organization",
      "insufficient_evidence",
      "internal_decomposition_differs",
      "ownership_boundary_differs",
    ])
    expect(Object.keys(criteria["internal_decomposition_differs"]!["child_options"] as object).sort()).toEqual([
      "decomposition_not_via_helpers",
      "helpers_private_single_use",
      "helpers_shared_or_reused",
    ])
    expect(criteria["equivalent_organization"]!["child_options"]).toEqual({})
    expect(Object.keys(request.questions).sort()).toEqual([
      "obligation_protocol_preserved_a",
      "obligation_protocol_preserved_b",
      "obligation_publication_after_batch_a",
      "obligation_publication_after_batch_b",
      "obligation_single_owner_coordination_a",
      "obligation_single_owner_coordination_b",
      "relationship",
    ])
    expect(Object.keys(request.questions["obligation_protocol_preserved_a"]!.criteria).sort()).toEqual([
      "insufficient_evidence",
      "satisfies",
      "violates",
    ])
  })

  test("the child request exists only for retained parents that have children", () => {
    const withChildren = buildChildRequest(base, FIXTURE.taxonomy, {
      choice: "internal_decomposition_differs",
      probabilities: { internal_decomposition_differs: 0.7, contract_or_behavior_differs: 0.3 },
    }, "jev-latest")
    expect(withChildren).not.toBeNull()
    expect(Object.keys(withChildren!.questions)).toEqual([
      "relationship_child_internal_decomposition_differs",
      "relationship_child_contract_or_behavior_differs",
    ])
    expect(Object.keys(withChildren!.questions["relationship_child_internal_decomposition_differs"]!.criteria).sort()).toEqual([
      "decomposition_not_via_helpers",
      "helpers_private_single_use",
      "helpers_shared_or_reused",
    ])

    const leafOnly = buildChildRequest(base, FIXTURE.taxonomy, {
      choice: "equivalent_organization",
      probabilities: { equivalent_organization: 0.6, insufficient_evidence: 0.4 },
    }, "jev-latest")
    expect(leafOnly).toBeNull()
  })

  test("retention keeps the highest-probability parents and breaks ties deterministically", () => {
    expect(retainedRoots({ a: 0.2, b: 0.2, c: 0.6 })).toEqual(["c", "a"])
    expect(RETAIN_WIDTH).toBe(2)
  })

  test("branch paths use the length-normalized geometric mean and report separation", () => {
    const paths = branchPaths(
      { choice: "internal_decomposition_differs", probabilities: { internal_decomposition_differs: 0.64, contract_or_behavior_differs: 0.36 } },
      {
        internal_decomposition_differs: {
          choice: "helpers_private_single_use",
          probabilities: { helpers_private_single_use: 0.81, decomposition_not_via_helpers: 0.19 },
        },
        contract_or_behavior_differs: {
          choice: "static_guarantee_differs",
          probabilities: { static_guarantee_differs: 0.9, runtime_behavior_differs: 0.1 },
        },
      },
      FIXTURE.taxonomy,
    )
    expect(paths.all.length).toBe(4)
    expect(paths.retained.length).toBe(2)
    expect(paths.retained[0]!.path).toEqual(["internal_decomposition_differs", "helpers_private_single_use"])
    expect(paths.retained[0]!.score).toBeCloseTo(Math.sqrt(0.64 * 0.81), 10)
    expect(paths.retained[1]!.path).toEqual(["contract_or_behavior_differs", "static_guarantee_differs"])
    expect(paths.retained[1]!.score).toBeCloseTo(Math.sqrt(0.36 * 0.9), 10)
    expect(paths.separation).toBeCloseTo(Math.sqrt(0.64 * 0.81) / Math.sqrt(0.36 * 0.9), 10)
    expect(paths.retained[0]!.provenance).toContain("geometric mean")
  })
})

describe("policy consumption", () => {
  const instance: StagedInstance = FIXTURE.instances.find((entry) => entry.id === "extraction-mutation")!
  const base: BaseState = buildBaseState(REPO, FIXTURE, instance, CANDIDATES)
  const facts = (eligibleA: boolean, eligibleB: boolean) => ({
    deterministic_gate: {
      method: "test",
      a: { eligible: eligibleA, violations: [] },
      b: { eligible: eligibleB, violations: ["no_uncapped_block"] },
    },
    consumed_obligation_facts: [],
    provider_relationship: { method: "test", retained: [], separation: null },
    explicit_unknowns: [],
  })

  test("an ineligible variant is not an option, and no eligible candidate yields no request", () => {
    const request = buildPolicyRequest(base, facts(true, false), { a: "eligible", b: "ineligible" }, "jev-latest")
    expect(request).not.toBeNull()
    const criteria = Object.keys(request!.questions["preference_among_eligible"]!.criteria)
    expect(criteria).toEqual(["prefers_a", "no_separation_unresolved_tradeoff", "insufficient_evidence"])
    expect(criteria).not.toContain("prefers_b")
    expect(buildPolicyRequest(base, facts(false, false), { a: "ineligible", b: "ineligible" }, "jev-latest")).toBeNull()
  })

  test("missing policy and unresolved eligibility both suppress the request", () => {
    const noPolicy: BaseState = { ...base, policy: {} }
    expect(buildPolicyRequest(noPolicy, facts(true, false), { a: "eligible", b: "ineligible" }, "jev-latest")).toBeNull()
    expect(buildPolicyRequest(base, facts(true, true), { a: "eligible", b: "unknown" }, "jev-latest")).toBeNull()
  })

  test("the absent-policy instance carries no criterion anywhere in its state", () => {
    const noPolicyInstance = FIXTURE.instances.find((entry) => entry.id === "consolidation-no-policy")!
    const state = buildBaseState(REPO, FIXTURE, noPolicyInstance, CANDIDATES)
    const criterion = FIXTURE.subjects.find((entry) => entry.id === "consolidation")!.policy.selected_criterion
    expect(state.policy).toEqual({})
    expect(state.focus).not.toHaveProperty("criterion")
    expect(JSON.stringify(state)).not.toContain(criterion)
    const withPolicy = buildBaseState(
      REPO,
      FIXTURE,
      FIXTURE.instances.find((entry) => entry.id === "consolidation")!,
      CANDIDATES,
    )
    expect(withPolicy.focus).toHaveProperty("criterion")
  })

  test("semantic obligations are consumed; deterministic ones are recorded but never consumed", () => {
    const gate = {
      checks: { a: [], b: [] },
      eligible: { a: true, b: false },
      violations: { a: [], b: ["no_uncapped_block: block"] },
      relationship: { root: "x", child: null, evidence: [] },
    }
    const state = resolveEligibility(gate as never, [
      { obligation: "no_uncapped_block", kind: "deterministic", variant: "b", consumed: false, choice: "satisfies" },
      { obligation: "pure_construction_step", kind: "semantic", variant: "a", consumed: true, choice: "satisfies" },
      { obligation: "pure_construction_step", kind: "semantic", variant: "b", consumed: true, choice: "satisfies" },
    ])
    // The provider claimed the deterministic obligation held; the gate still decides.
    expect(state).toEqual({ a: "eligible", b: "ineligible" })
    const subject = FIXTURE.subjects.find((entry) => entry.id === "extraction")!
    expect(subject.obligations.some((obligation) => obligation.kind === "semantic")).toBe(true)

    const unknown = resolveEligibility({ ...gate, eligible: { a: true, b: true } } as never, [
      { obligation: "pure_construction_step", kind: "semantic", variant: "a", consumed: true, choice: "insufficient_evidence" },
    ])
    expect(unknown).toEqual({ a: "unknown", b: "eligible" })
  })
})

type Pick = (questionId: string, keys: ReadonlyArray<string>) => { choice: string; probabilities: Record<string, number> }
type RequestLike = { questions: Record<string, { criteria: Record<string, unknown> | ReadonlyArray<unknown> }> }

const spread = (choice: string, keys: ReadonlyArray<string>, primary: number): { choice: string; probabilities: Record<string, number> } => ({
  choice,
  probabilities: Object.fromEntries(keys.map((key) => [key, key === choice ? primary : (1 - primary) / Math.max(1, keys.length - 1)])),
})

const synthesize = (request: RequestLike, pick: Pick) => {
  const answers: Record<string, unknown> = {}
  for (const [id, question] of Object.entries(request.questions)) {
    const keys = Array.isArray(question.criteria)
      ? question.criteria.map((_, index) => String(index))
      : Object.keys(question.criteria)
    const picked = pick(id, keys)
    answers[id] = { type: "choice", choice: picked.choice, probabilities: picked.probabilities, confidence: 1 }
  }
  return { model: "jev-1.13.0", answers, usage: { input_tokens: 100, output_tokens: 10 } }
}

const PREFERENCE_SPREAD = {
  a: 0.5, b: 0.2, equivalent: 0.15, incomparable: 0.1, neither_meets_minimum: 0.03, insufficient_evidence: 0.02,
}

/** Build a synthetic run that exercises the whole composition path without any egress. */
function syntheticRun(plan: Plan, overrides: Record<string, Pick> = {}) {
  const records: Array<Record<string, unknown>> = []
  const defaultPick = (instanceId: string, gate: GateResult, questionId: string, keys: ReadonlyArray<string>) => {
    const mechanical = gate.relationship
    if (questionId === "relationship") return spread(mechanical.root, keys, 0.7)
    if (questionId.startsWith("relationship_child_")) {
      const root = questionId.replace("relationship_child_", "")
      const established = root === mechanical.root && mechanical.child !== null && keys.includes(mechanical.child)
        ? mechanical.child
        : keys[0]!
      return spread(established, keys, 0.8)
    }
    if (questionId.startsWith("obligation_")) {
      const variant = questionId.endsWith("_a") ? "a" : "b"
      return spread(gate.eligible[variant] ? "satisfies" : "violates", keys, 0.9)
    }
    if (questionId === "preference") return { choice: "a", probabilities: PREFERENCE_SPREAD }
    if (questionId === "preference_among_eligible") {
      const preferred = instanceId.startsWith("consolidation") ? "no_separation_unresolved_tradeoff" : "prefers_b"
      return spread(keys.includes(preferred) ? preferred : keys[0]!, keys, 0.6)
    }
    if (questionId === "unresolved_reason") {
      const choice = "criterion_does_not_settle_the_remaining_question"
      return spread(keys.includes(choice) ? choice : keys[0]!, keys, 0.7)
    }
    if (questionId === "policy_readiness") return spread("defined", keys, 1)
    if (questionId === "evidence_readiness") return spread("sufficient", keys, 1)
    return spread(keys[0]!, keys, 1)
  }
  for (const instance of plan.instances) {
    const base = instance.base as unknown as BaseState
    const gate = instance.gate as unknown as GateResult
    const stagedInstance: StagedInstance = {
      id: instance.id, subject: instance.subject, policy: instance.policyState, variants: instance.variants,
    }
    const pick: Pick = (questionId, keys) =>
      overrides[`${instance.id}:${questionId}`]?.(questionId, keys) ?? defaultPick(instance.id, gate, questionId, keys)
    const push = (id: string, stage: string, request: unknown, response: unknown) => {
      records.push({
        id, stage, status: "received", requestHash: sha256(JSON.stringify(request)), response,
        provider: { status: 200, requestId: null, elapsedMs: 100, raw: JSON.stringify(response) },
      })
    }
    push(`${instance.id}:direct`, "direct", instance.direct.request, synthesize(instance.direct.request, pick))
    push(`${instance.id}:relationship`, "relationship", instance.relationship.request, synthesize(instance.relationship.request, pick))
    const relationshipResponse = synthesize(instance.relationship.request, pick) as unknown as Response
    const relationshipAnswer = answerChoice(relationshipResponse, "relationship")
    const childRequest = relationshipAnswer === null ? null : buildChildRequest(base, FIXTURE.taxonomy, relationshipAnswer, plan.model)
    const childResponse = childRequest === null ? null : synthesize(childRequest, pick)
    if (childRequest !== null && childResponse !== null) push(`${instance.id}:child`, "child", childRequest, childResponse)
    const stageAOutcome = interpretStaged(stagedInstance, base, FIXTURE.taxonomy, gate, {
      relationship: relationshipResponse,
      child: childResponse as unknown as Response | null,
      policy: null,
    })
    const policyRequest = buildPolicyRequest(base, establishedFacts(gate, stageAOutcome), stageAOutcome.eligibility, plan.model)
    const policyResponse = policyRequest === null ? null : synthesize(policyRequest, pick)
    if (policyRequest !== null && policyResponse !== null) push(`${instance.id}:policy`, "policy", policyRequest, policyResponse)
  }
  return { schema: "pulsar.jev_staged_run.v1", plan, planHash: sha256(canonical(plan)), records, egress: records.length }
}

describe("plan validation and replay", () => {
  test("every frozen request validates, hashes match, and the plan rejects tampering", async () => {
    const plan = await getPlan()
    expect(validatePlan(plan)).toEqual(plan)
    expect(plan.instances.length).toBe(7)
    expect(plan.maxEgress).toBe(28)
    for (const instance of plan.instances) {
      for (const entry of [instance.direct, instance.relationship]) {
        expect(sha256(JSON.stringify(entry.request))).toBe(entry.requestHash)
        validateResponse(entry.request, synthesize(entry.request, (_, keys) => spread(keys[0]!, keys, 1)))
      }
    }
    const tampered = JSON.parse(JSON.stringify(plan))
    tampered.instances[0].direct.request.questions.preference.instructions.question = "tampered"
    expect(() => validatePlan(tampered)).toThrow(/Request hash mismatch/)
    const budget = JSON.parse(JSON.stringify(plan))
    budget.maxEgress = 99
    expect(() => validatePlan(budget)).toThrow(/budget altered/)
  }, 300_000)

  test("replay re-derives the composed requests and reproduces the verdicts", async () => {
    const plan = await getPlan()
    const run = syntheticRun(plan)
    const bytes = JSON.stringify(run)
    const summary = replay(bytes, sha256(bytes))
    const byInstance = new Map(summary.instances.map((entry) => [entry.instance, entry]))

    expect(summary.egress).toBe(plan.instances.length * 4 - 1)
    expect(summary.latency.samples).toBe(summary.egress)
    expect(summary.inputTokens).toBe(summary.egress * 100)

    const mutation = byInstance.get("extraction-mutation")!
    expect(mutation.staged.eligibility).toEqual({ a: "eligible", b: "ineligible" })
    expect(mutation.staged.verdict.kind).toBe("determined_by_eligibility")
    expect(mutation.staged.verdict.label).toBe("a")
    expect(mutation.staged.policy.options).toEqual(["prefers_a", "no_separation_unresolved_tradeoff", "insufficient_evidence"])
    // The provider claimed the deterministic obligation held; the gate still excluded the mutant.
    expect(mutation.staged.obligationFacts.find((fact) => fact.obligation === "no_uncapped_block" && fact.variant === "b")?.consumed).toBe(false)
    expect(summary.metrics.directRankedAnIneligibleCandidate).toContain("extraction-mutation")

    const noPolicy = byInstance.get("consolidation-no-policy")!
    expect(noPolicy.staged.policy.sent).toBe(false)
    expect(noPolicy.staged.verdict.kind).toBe("unranked_missing_policy")
    const missingPolicy = summary.metrics.missingPolicy
    expect(missingPolicy.map((entry) => entry.instance)).toEqual(["consolidation-no-policy"])
    expect(missingPolicy[0]!.stagedPolicyRequestSent).toBe(false)
    expect(missingPolicy[0]!.directTop).toBe("a")

    const consolidation = byInstance.get("consolidation")!
    expect(consolidation.staged.verdict.kind).toBe("unresolved_tradeoff")
    expect(consolidation.staged.relationship.branchRecall).toBe(true)
    expect(consolidation.staged.policy.rankingBasis).toBe("criterion")
    expect(consolidation.staged.relationship.retained.map((path) => path.path)).toEqual([
      ["internal_decomposition_differs", "decomposition_not_via_helpers"],
      ["internal_decomposition_differs", "helpers_private_single_use"],
    ])

    const extraction = byInstance.get("extraction")!
    expect(extraction.staged.verdict).toEqual({ kind: "preference", label: "b", basis: "provider preference among the eligible set" })
    expect(summary.metrics.branchRecall.every((entry) => entry.recalled)).toBe(true)
    expect(summary.metrics.repeatDeterminism?.relationshipDistributionIdentical).toBe(true)
    expect(summary.metrics.repeatDeterminism?.stagedVerdictIdentical).toBe(true)
    expect(summary.metrics.swapConsistency?.mechanical.base).toBe("internal_decomposition_differs")
    expect(summary.metrics.swapConsistency?.mechanical.swapped).toBe("internal_decomposition_differs")
    expect(summary.metrics.providerObligationAgreement.length).toBe(7)
  }, 300_000)

  test("replay fails closed on a wrong digest, a tampered composed request, and a broken derivation", async () => {
    const plan = await getPlan()
    const run = syntheticRun(plan)
    expect(() => replay(JSON.stringify(run), sha256("other"))).toThrow(/digest differs/)

    const tamperedPolicy = syntheticRun(plan)
    const policyRecord = tamperedPolicy.records.find((record) => record.id === "consolidation:policy")!
    ;(policyRecord as { requestHash: string }).requestHash = sha256("not the recorded request")
    expect(() => replay(JSON.stringify(tamperedPolicy), sha256(JSON.stringify(tamperedPolicy)))).toThrow(/not reproducible from established facts/)

    // Changing a stage-A answer consistently in both the stored answer and its raw body passes
    // record validation, and must then fail because the child options no longer follow from it.
    const broken = syntheticRun(plan)
    const relationshipRecord = broken.records.find((record) => record.id === "consolidation:relationship")!
    const rewrite = (target: { answers: Record<string, { choice: string; probabilities: Record<string, number> }> }) => {
      const answer = target.answers["relationship"]!
      answer.choice = "equivalent_organization"
      for (const key of Object.keys(answer.probabilities)) {
        answer.probabilities[key] = key === "equivalent_organization" ? 1 : 0
      }
    }
    rewrite(relationshipRecord.response as { answers: Record<string, { choice: string; probabilities: Record<string, number> }> })
    const brokenProvider = (relationshipRecord as { provider: { raw: string } }).provider
    const rawBody = JSON.parse(brokenProvider.raw) as { answers: Record<string, { choice: string; probabilities: Record<string, number> }> }
    rewrite(rawBody)
    brokenProvider.raw = JSON.stringify(rawBody)
    expect(() => replay(JSON.stringify(broken), sha256(JSON.stringify(broken)))).toThrow(/not reproducible from stage-A answers/)
  }, 300_000)

  test("replay re-validates every received record against its own raw receipt", async () => {
    const plan = await getPlan()
    const baseline = syntheticRun(plan)
    // The untampered synthetic run must replay, so each mutation below is the only difference.
    expect(replay(JSON.stringify(baseline), sha256(JSON.stringify(baseline))).egress).toBe(plan.instances.length * 4 - 1)

    type Mutable = {
      records: Array<{
        id: string
        status: string
        requestHash: string
        response: Record<string, unknown> | null
        provider?: Record<string, unknown>
      }>
    }
    const attempt = (mutate: (run: Mutable) => void): string => {
      const run = JSON.parse(JSON.stringify(baseline)) as Mutable
      mutate(run)
      const bytes = JSON.stringify(run)
      try {
        replay(bytes, sha256(bytes))
        return "no error"
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    }
    const find = (run: Mutable, id: string) => {
      const record = run.records.find((entry) => entry.id === id)
      if (record === undefined) throw new Error(`missing record ${id}`)
      return record
    }

    // The frozen direct request hash is checked before any answer is trusted.
    expect(attempt((run) => { find(run, "consolidation:direct").requestHash = sha256("not the frozen request") }))
      .toContain("request hash does not match the request replay derived")

    // A stored answer that drifted from its own raw body must not be read as evidence.
    expect(attempt((run) => {
      const record = find(run, "consolidation:direct")
      const answers = (record.response as { answers: Record<string, { type: string; choice: string; probabilities: Record<string, number>; confidence: number }> }).answers
      answers["preference"] = { type: "choice", choice: "b", probabilities: { a: 0, b: 1, equivalent: 0, incomparable: 0, neither_meets_minimum: 0, insufficient_evidence: 0 }, confidence: 1 }
    })).toContain("stored parsed response differs from the raw response body")

    // A stored answer that no longer decodes is reported as an integrity failure, not a decode crash.
    expect(attempt((run) => {
      const record = find(run, "consolidation:direct")
      const answers = (record.response as { answers: Record<string, unknown> }).answers
      answers["preference"] = { choice: "b" }
    })).toContain("stored response does not decode")

    // A raw body that disagrees with the stored answer is detected in the other direction too.
    expect(attempt((run) => {
      const record = find(run, "consolidation:relationship")
      const provider = record.provider as { raw: string }
      const parsed = JSON.parse(provider.raw) as { answers: Record<string, { choice: string; probabilities: Record<string, number> }> }
      const answer = parsed.answers["relationship"]!
      for (const key of Object.keys(answer.probabilities)) answer.probabilities[key] = key === answer.choice ? 1 : 0
      provider.raw = JSON.stringify(parsed)
    })).toContain("stored parsed response differs from the raw response body")

    // A raw body that no longer validates against its request fails closed.
    expect(attempt((run) => { (find(run, "extraction:child").provider as { raw: string }).raw = "{\"not\":\"a response\"}" }))
      .toContain("raw response body failed validation")
    expect(attempt((run) => { delete (find(run, "extraction:policy").provider as Record<string, unknown>)["raw"] }))
      .toContain("received record has no raw response body")
    // Another request's valid body must fail, because it does not answer this request's questions.
    expect(attempt((run) => {
      const source = find(run, "consolidation:relationship").provider as { raw: string }
      const target = find(run, "consolidation:direct").provider as { raw: string }
      target.raw = source.raw
    })).toContain("raw response body failed validation")

    // A record marked not attempted is not validated and is not read as evidence.
    expect(attempt((run) => {
      const record = find(run, "consolidation:policy")
      record.status = "not_attempted"
      record.response = null
      delete record.provider
    })).toBe("no error")
  }, 300_000)

  test("a filtered plan prepares and replays independently of the full plan", async () => {
    const plan = await getPlan(["extraction"])
    expect(plan.instances.length).toBe(1)
    expect(plan.instanceFilter).toEqual(["extraction"])
    const run = syntheticRun(plan)
    const summary = replay(JSON.stringify(run), sha256(JSON.stringify(run)))
    expect(summary.instances.length).toBe(1)
    expect(summary.egress).toBe(4)
    const full = await getPlan()
    expect(Schema.decodeUnknownSync(PlanSchema)(full)).toEqual(full)
    expect(full.definitionHash).not.toBe(plan.definitionHash)
  }, 300_000)

  test("interpretDirect reports whether the direct question ranked an ineligible candidate", async () => {
    const plan = await getPlan(["extraction-mutation"])
    const instance = plan.instances[0]!
    const gate = instance.gate as unknown as GateResult
    const stagedInstance: StagedInstance = {
      id: "extraction-mutation", subject: "extraction", policy: "present", variants: instance.variants,
    }
    const ranked = interpretDirect(
      stagedInstance,
      gate,
      synthesize(instance.direct.request, () => ({ choice: "a", probabilities: PREFERENCE_SPREAD })) as unknown as Response,
    )
    expect(ranked.ranksIneligible).toBe(true)
    expect(ranked.reportsNonRanking).toBe(false)
    const abstaining = interpretDirect(
      stagedInstance,
      gate,
      synthesize(instance.direct.request, () => ({
        choice: "incomparable",
        probabilities: { a: 0.1, b: 0, equivalent: 0.1, incomparable: 0.6, neither_meets_minimum: 0.1, insufficient_evidence: 0.1 },
      })) as unknown as Response,
    )
    expect(abstaining.ranksIneligible).toBe(false)
    expect(abstaining.reportsNonRanking).toBe(true)
  }, 300_000)
})
