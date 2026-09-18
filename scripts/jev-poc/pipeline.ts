import { canonical, sha256, validateResponse, type Request, type Response } from "../jev-spike/model.ts"
import type { Receipt } from "../jev-spike/transport.ts"
import type { DiscoveryResult, SemanticCandidate } from "../../packages/cli/src/semantic-discovery.ts"
import { decodePolicy, type Policy, type Rule } from "./policy.ts"
import { decisive, factsRequest, judgmentRequest, QUESTION_VERSION, refinementRequest } from "./questions.ts"

export interface Plan {
  readonly schema: "pulsar.semantic-plan.v1alpha1"
  readonly questionVersion: string
  readonly model: string
  readonly inputFingerprint: string
  readonly policyFingerprint: string
  readonly structural: { readonly score: number; readonly complete: boolean; readonly hardGateCount: number }
  readonly policy: Policy
  readonly discovery: DiscoveryResult
  readonly selections: Readonly<Record<string, ReadonlyArray<string>>>
}
export interface Step {
  readonly candidateId: string
  readonly stage: "facts" | "refinement" | "policy"
  readonly ruleId: string | null
  readonly request: Request
}
export interface CallRecord extends Step {
  readonly requestHash: string
  readonly receipt: Receipt | null
  readonly failure: "network_or_timeout" | null
}
export interface Finding {
  readonly candidateId: string
  readonly ruleId: string
  readonly penaltyPoints: number
  readonly verdict: "satisfied" | "violated" | "not_applicable" | "unknown"
  readonly relationship: string | null
  readonly refinement: string | null
  readonly direction: string | null
  readonly reason: string
}
export interface Summary {
  readonly semantic: {
    readonly score: number
    readonly interval: readonly [number, number]
    readonly color: "green" | "amber" | "red"
    readonly knownPenalty: number
    readonly unresolvedPenalty: number
    readonly complete: boolean
  }
  readonly health: { readonly score: number; readonly color: "green" | "amber" | "red" }
  readonly calls: number
  readonly findings: ReadonlyArray<Finding>
  readonly scope: { readonly include: ReadonlyArray<string>; readonly exclude: ReadonlyArray<string>; readonly kinds: ReadonlyArray<string> }
  readonly limitations: ReadonlyArray<string>
}

/** No credit denominator: adding healthy candidates cannot dilute known debt. */
export function aggregate(plan: Plan, findings: ReadonlyArray<Finding>, calls: number): Summary {
  const knownPenalty = findings.reduce((n, f) => n + (f.verdict === "violated" ? f.penaltyPoints : 0), 0)
  const unresolvedPenalty = findings.reduce((n, f) => n + (f.verdict === "unknown" ? f.penaltyPoints : 0), 0)
  const complete = plan.discovery.coverage.complete && !findings.some((f) => f.verdict === "unknown")
  const high = Math.max(0, 100 - knownPenalty)
  const low = plan.discovery.coverage.complete ? Math.max(0, high - unresolvedPenalty) : 0
  const color = high < plan.policy.redBelow ? "red" : complete && low >= plan.policy.greenAt ? "green" : "amber"
  const healthScore = Math.min(low, plan.structural.score)
  const healthColor = plan.structural.hardGateCount > 0 || plan.structural.score < plan.policy.redBelow || color === "red"
    ? "red" : color === "green" && plan.structural.complete && healthScore >= plan.policy.greenAt ? "green" : "amber"
  return {
    semantic: { score: low, interval: [low, high], color, knownPenalty, unresolvedPenalty, complete },
    health: { score: healthScore, color: healthColor }, calls, findings,
    scope: { include: plan.policy.include, exclude: plan.policy.exclude, kinds: ["clone-group", "complexity-function"] },
    limitations: [
      "Experimental policy points, not calibrated defect probabilities or proof of repository health.",
      "Green covers only declared rules and detector-reachable candidates in the declared scope; small wrappers and verbosity may not be discovered.",
      "The score is the pessimistic interval endpoint. An incomplete inventory forces it to zero, not a claim of proven debt.",
      "Fresh Jev calls may change. Replay is deterministic; thresholds have not been calibrated.",
      "Directions are bounded investigation suggestions, not verified behavior-preserving patches.",
      "Trusted policy modules must be deterministic; arbitrary environment reads and external dependency bytes are not fingerprinted.",
    ],
  }
}

function rulesFor(plan: Plan, candidate: SemanticCandidate): ReadonlyArray<Rule> {
  const ids = plan.selections[candidate.id]
  if (!ids || new Set(ids).size !== ids.length) throw new Error("Missing or duplicate selected rules")
  return ids.map((id) => {
    const rule = plan.policy.rules.find((r) => r.id === id && r.appliesTo.includes(candidate.kind))
    if (!rule) throw new Error("Unknown or inapplicable selected rule")
    return rule
  })
}

/** The same bounded transition machine composes live requests and replays receipts. */
export function* judgmentMachine(plan: Plan): Generator<Step, Summary, Response | null> {
  if (plan.schema !== "pulsar.semantic-plan.v1alpha1" || plan.questionVersion !== QUESTION_VERSION) throw new Error("Unsupported semantic plan")
  decodePolicy(plan.policy)
  const findings: Finding[] = []
  let calls = 0
  const seen = new Set<string>()
  for (const candidate of plan.discovery.candidates) {
    const rules = rulesFor(plan, candidate).filter((rule) => {
      const memberKey = candidate.members.map((m) => `${m.file}:${m.startLine}:${m.endLine}`).sort()
      const key = canonical([rule.id, memberKey])
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (!rules.length) continue
    let relationship: string | null = null
    let refinement: string | null = null
    let reason = "call_budget_exhausted"
    if (calls < plan.policy.budgets.maxCalls) {
      calls++
      const response = yield { candidateId: candidate.id, stage: "facts", ruleId: null, request: factsRequest(candidate, plan.model) }
      relationship = response && decisive(response, "readiness", plan.policy) === "sufficient" ? decisive(response, "relationship", plan.policy) : null
      reason = relationship ? "call_budget_exhausted" : "facts_unresolved"
    }
    if (relationship && calls < plan.policy.budgets.maxCalls) {
      calls++
      const response = yield { candidateId: candidate.id, stage: "refinement", ruleId: null, request: refinementRequest(candidate, plan.model, relationship) }
      refinement = response && decisive(response, "readiness", plan.policy) === "sufficient" ? decisive(response, "refinement", plan.policy) : null
      reason = refinement ? "call_budget_exhausted" : "refinement_unresolved"
    }
    for (const rule of rules) {
      let verdict: Finding["verdict"] = "unknown"
      let direction: string | null = null
      let ruleReason = reason
      if (relationship && refinement && calls < plan.policy.budgets.maxCalls) {
        calls++
        const response = yield {
          candidateId: candidate.id, stage: "policy", ruleId: rule.id,
          request: judgmentRequest(candidate, plan.model, rule, { relationship, refinement }),
        }
        const choice = response && decisive(response, "readiness", plan.policy) === "sufficient" ? decisive(response, "verdict", plan.policy) : null
        if (choice === "violated" || choice === "satisfied" || choice === "not_applicable") verdict = choice
        direction = response ? decisive(response, "direction", plan.policy) : null
        ruleReason = verdict === "unknown" ? "policy_unresolved" : "policy_judgment"
      }
      findings.push({ candidateId: candidate.id, ruleId: rule.id, penaltyPoints: rule.penaltyPoints, verdict, relationship, refinement, direction, reason: ruleReason })
    }
  }
  return aggregate(plan, findings, calls)
}

export function decodeReceipt(record: Pick<CallRecord, "request" | "receipt" | "failure">): Response | null {
  if (record.receipt === null) {
    if (record.failure !== "network_or_timeout") throw new Error("Missing receipt or transport failure")
    return null
  }
  if (record.failure !== null) throw new Error("Receipt and transport failure conflict")
  if (record.receipt.status !== 200) return null
  // An invalid provider body is unknown, never a passing judgment. Raw bytes remain recorded.
  try { return validateResponse(record.request, JSON.parse(record.receipt.raw)) } catch { return null }
}

export interface Run { readonly plan: Plan; readonly records: ReadonlyArray<CallRecord>; readonly summary: Summary }
export function replay(run: Run): Summary {
  const machine = judgmentMachine(run.plan)
  let next = machine.next()
  for (const record of run.records) {
    if (next.done) throw new Error("Unexpected extra receipt")
    if (canonical(next.value) !== canonical({ candidateId: record.candidateId, stage: record.stage, ruleId: record.ruleId, request: record.request }) ||
      record.requestHash !== sha256(JSON.stringify(next.value.request))) throw new Error("Request integrity mismatch")
    next = machine.next(decodeReceipt(record))
  }
  if (!next.done) throw new Error("Missing receipt")
  if (canonical(next.value) !== canonical(run.summary)) throw new Error("Summary integrity mismatch")
  return next.value
}
