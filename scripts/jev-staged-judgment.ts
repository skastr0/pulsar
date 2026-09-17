#!/usr/bin/env bun
/**
 * CLI for the staged-judgment experiment.
 *
 *   bun scripts/jev-staged-judgment.ts prepare <plan.json>
 *   bun scripts/jev-staged-judgment.ts evaluate <plan.json> <new-run-dir> --allow-egress
 *   bun scripts/jev-staged-judgment.ts replay <run.json> <trusted-sha256>
 *
 * Only `direct` and `relationship` requests are frozen in the plan. The child taxonomy request
 * and the policy request are composed from earlier answers at evaluate time, recorded verbatim,
 * and re-derived during replay. No retries, concurrency one.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Data, Effect, Result, Schema } from "effect"
import { PROBABILITY_TOLERANCE, Request, Response, canonical, sha256, validateResponse } from "./jev-spike/model.ts"
import { JudgmentProvider, jevLayer } from "./jev-spike/transport.ts"
import { buildShapeCandidates, type ShapeFileMap } from "./jev-spike/shape-candidates.ts"
import {
  MAX_REQUEST_BYTES,
  RETAIN_WIDTH,
  SUBJECT_PROBE_KIND,
  answerChoice,
  buildBaseState,
  buildChildRequest,
  buildDirectRequest,
  buildPolicyRequest,
  buildRelationshipRequest,
  commonInstructions,
  interpretDirect,
  interpretStaged,
  loadFixture,
  type BaseState,
  type EstablishedFacts,
  type StagedFixture,
  type StagedInstance,
} from "./jev-spike/staged-judgment.ts"
import { cleanupTemps, evaluateGate, type GateResult } from "./jev-spike/staged-gate.ts"

const ROOT = resolve(import.meta.dir, "..")
export const MAX_EGRESS = 28
export const STAGES = ["direct", "relationship", "child", "policy"] as const
export type Stage = (typeof STAGES)[number]

const Entry = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  stage: Schema.Literals(["direct", "relationship"]),
  request: Request,
  requestHash: Schema.String,
})
const PlanInstance = Schema.Struct({
  id: Schema.String,
  subject: Schema.String,
  policyState: Schema.Literals(["present", "absent"]),
  variants: Schema.Struct({ a: Schema.String, b: Schema.String }),
  gate: Schema.JsonObject,
  base: Schema.JsonObject,
  direct: Entry,
  relationship: Entry,
})
export const Plan = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_staged_plan.v1"),
  mode: Schema.Literal("staged-judgment"),
  createdAt: Schema.String,
  repositorySha: Schema.String,
  definitionHash: Schema.String,
  instanceFilter: Schema.Array(Schema.String),
  model: Schema.String,
  policy: Schema.JsonObject,
  maxEgress: Schema.Int,
  maxRequestBytes: Schema.Int,
  instances: Schema.Array(PlanInstance),
})
export type Plan = typeof Plan.Type

const researchPolicy = (model: string) => ({
  status: "development_only",
  authority: "tier3_research_only",
  modelRequested: model,
  modelRevisionStatus: "unresolved",
  labelStatus: "author_proposed_expectations_are_not_human_labels",
  retries: 0,
  concurrency: 1,
  timeoutMs: 30_000,
  retainWidth: RETAIN_WIDTH,
  probabilityTolerance: PROBABILITY_TOLERANCE,
  inputUsdPerMillion: 0.042,
  outputUsdPerMillion: 0,
  budget: "Hard egress and byte caps; usage-based costs are estimates, not an account billing limit.",
  criteriaStatus: "proposed_repo_scoped_experiment_not_adopted",
  aggregation: "none_no_composite_scalar",
  branchRetention:
    "length-normalized geometric mean over retained taxonomy branches; a descriptive pruning score, not an architectural utility",
  eligibilityAuthority:
    "deterministic compiler and runtime probes decide every mechanizable obligation; provider verdicts on those obligations are recorded but never consumed",
  semanticObligations:
    "consumed only for obligations no mechanical probe can decide; an insufficient_evidence verdict blocks ranking instead of counting as eligible",
  stopOnAuthOrSchemaError: true,
  disclosure: "owner_authorized_public_repository",
  conventionalBaseline: "not_run_no_separate_provider_credentials",
  acceptanceGates: "not_run_requires_reviewed_labels_and_held_out_cases",
})

export type PreparedInstance = {
  readonly instance: StagedInstance
  readonly gate: GateResult
  readonly base: BaseState
  readonly direct: Request
  readonly relationship: Request
}

export type Prepared = {
  readonly fixture: StagedFixture
  readonly instances: ReadonlyArray<PreparedInstance>
}

export async function prepareInstances(only: ReadonlyArray<string> = []): Promise<Prepared> {
  const fixture = loadFixture(ROOT)
  const candidates = buildShapeCandidates(ROOT)
  const gateCache = new Map<string, GateResult>()
  const prepared: Array<PreparedInstance> = []
  const selected = only.length === 0
    ? fixture.instances
    : fixture.instances.filter((instance) => only.includes(instance.id))
  if (only.length > 0 && selected.length !== only.length) {
    const found = new Set(selected.map((instance) => instance.id))
    throw new Error(`Unknown instance filter: ${only.filter((id) => !found.has(id)).join(", ")}`)
  }
  for (const instance of selected) {
    const subject = fixture.subjects.find((entry) => entry.id === instance.subject)
    if (subject === undefined) throw new Error(`Unknown subject ${instance.subject}`)
    const probeKind = SUBJECT_PROBE_KIND[subject.id]
    if (probeKind === undefined) throw new Error(`No probe kind for subject ${subject.id}`)
    const slot = (key: string): ShapeFileMap => {
      const [subjectId, variant] = key.split(".")
      const bySubject = candidates[subjectId as keyof typeof candidates] as Record<string, ShapeFileMap> | undefined
      const files = bySubject?.[variant ?? ""]
      if (files === undefined) throw new Error(`Unknown variant slot ${key}`)
      return files
    }
    const variants = { a: slot(instance.variants.a), b: slot(instance.variants.b) }
    const cacheKey = `${instance.subject}:${instance.variants.a}:${instance.variants.b}`
    let gate = gateCache.get(cacheKey)
    if (gate === undefined) {
      gate = await evaluateGate(ROOT, probeKind, subject.obligations, variants)
      gateCache.set(cacheKey, gate)
    }
    const base = buildBaseState(ROOT, fixture, instance, candidates)
    prepared.push({
      instance,
      gate,
      base,
      direct: buildDirectRequest(base, "jev-latest"),
      relationship: buildRelationshipRequest(base, fixture.taxonomy, "jev-latest"),
    })
  }
  return { fixture, instances: prepared }
}

export async function prepare(only: ReadonlyArray<string> = []): Promise<Plan> {
  const prepared = await prepareInstances(only)
  const definitionHash = sha256(canonical({
    fixture: prepared.fixture,
    instanceFilter: only,
    retainWidth: RETAIN_WIDTH,
    commonInstructions,
  }))
  const plan: Plan = {
    schema: "pulsar.jev_staged_plan.v1",
    mode: "staged-judgment",
    createdAt: new Date().toISOString(),
    repositorySha: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString().trim(),
    definitionHash,
    instanceFilter: only,
    model: "jev-latest",
    policy: researchPolicy("jev-latest"),
    maxEgress: MAX_EGRESS,
    maxRequestBytes: MAX_REQUEST_BYTES,
    instances: prepared.instances.map((entry) => ({
      id: entry.instance.id,
      subject: entry.instance.subject,
      policyState: entry.instance.policy,
      variants: entry.instance.variants,
      gate: entry.gate as unknown as Schema.JsonObject,
      base: entry.base as unknown as Schema.JsonObject,
      direct: {
        id: `${entry.instance.id}:direct`,
        subject: entry.instance.subject,
        stage: "direct" as const,
        request: entry.direct,
        requestHash: sha256(JSON.stringify(entry.direct)),
      },
      relationship: {
        id: `${entry.instance.id}:relationship`,
        subject: entry.instance.subject,
        stage: "relationship" as const,
        request: entry.relationship,
        requestHash: sha256(JSON.stringify(entry.relationship)),
      },
    })),
  }
  validatePlan(plan)
  return plan
}

export function validatePlan(input: unknown): Plan {
  const plan = Schema.decodeUnknownSync(Plan)(input)
  if (plan.maxEgress !== MAX_EGRESS || plan.maxRequestBytes !== MAX_REQUEST_BYTES) throw new Error("Egress budget altered")
  if (plan.instances.length === 0) throw new Error("Empty plan")
  if (new Set(plan.instances.map((instance) => instance.id)).size !== plan.instances.length) throw new Error("Duplicate instance IDs")
  for (const instance of plan.instances) {
    for (const entry of [instance.direct, instance.relationship]) {
      const body = JSON.stringify(entry.request)
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error(`Request byte cap: ${entry.id}`)
      if (sha256(body) !== entry.requestHash) throw new Error(`Request hash mismatch: ${entry.id}`)
      for (const question of Object.values(entry.request.questions)) {
        const count = Object.keys(question.criteria).length
        if (count < 2 || count > (question.type === "score" ? 10 : 255)) throw new Error(`Invalid question cardinality: ${entry.id}`)
      }
    }
  }
  return plan
}

/** Re-derive the frozen part of the plan and compare. Fails closed when the definition moved. */
export async function validateCurrentInputs(plan: Plan): Promise<void> {
  const current = await prepare(plan.instanceFilter)
  if (plan.definitionHash !== current.definitionHash) throw new Error("Definition changed; prepare and inspect a new plan")
  if (canonical(plan.policy) !== canonical(current.policy)) throw new Error("Research policy changed; prepare a new plan")
  for (const [index, instance] of plan.instances.entries()) {
    const fresh = current.instances[index]
    if (fresh === undefined || fresh.id !== instance.id) throw new Error(`Instance inventory changed: ${instance.id}`)
    if (canonical(instance.direct.request) !== canonical(fresh.direct.request)) throw new Error(`Direct request changed: ${instance.id}`)
    if (canonical(instance.relationship.request) !== canonical(fresh.relationship.request)) throw new Error(`Relationship request changed: ${instance.id}`)
    if (canonical(instance.gate) !== canonical(fresh.gate)) throw new Error(`Deterministic gate changed: ${instance.id}`)
  }
}

class FileError extends Data.TaggedError("FileError")<{ readonly operation: string }> {}
const persist = (path: string, value: unknown) => Effect.try({
  try: () => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }),
  catch: () => new FileError({ operation: `exclusive write ${path}` }),
})

type RecordedAttempt = {
  readonly id: string
  readonly stage: Stage
  readonly status: string
  readonly requestHash: string
  readonly response: unknown
  readonly provider?: { readonly status: number; readonly requestId: string | null; readonly elapsedMs: number; readonly raw: string }
}

/** `established_facts` handed to the policy request. Only facts this pipeline established. */
export function establishedFacts(gate: GateResult, outcome: ReturnType<typeof interpretStaged>): EstablishedFacts {
  return {
    deterministic_gate: {
      method: "compiler and runtime probes executed outside the model; each entry lists its own probe evidence",
      a: { eligible: gate.eligible.a, violations: gate.violations.a, checks: gate.checks.a },
      b: { eligible: gate.eligible.b, violations: gate.violations.b, checks: gate.checks.b },
    },
    consumed_obligation_facts: outcome.obligationFacts
      .filter((fact) => fact.consumed)
      .map((fact) => ({
        obligation: fact.obligation,
        variant: fact.variant,
        answer: fact.choice,
        probabilities: fact.probabilities,
        provenance: "provider answer retained from the first staged request",
      })),
    provider_relationship: {
      method: `taxonomy walk with beam width ${RETAIN_WIDTH}; length-normalized geometric mean over retained branches`,
      retained: outcome.relationship.retained.map((path) => ({
        path: path.path,
        score: Number(path.score.toFixed(6)),
        provenance: path.provenance,
      })),
      separation: outcome.relationship.separation === null ? null : Number(outcome.relationship.separation.toFixed(6)),
      parent_distribution: outcome.relationship.distribution,
      child_distributions: outcome.relationship.childDistributions,
      note: "A descriptive classification of how the variants differ. Not a preference and not an architectural utility.",
    },
    explicit_unknowns: outcome.explicitUnknowns,
  }
}

export const evaluatePlan = Effect.fn("JevStaged.evaluatePlan")(function* (plan: Plan, out: string) {
  yield* Effect.tryPromise({
    try: () => validateCurrentInputs(validatePlan(plan)),
    catch: () => new FileError({ operation: "validate current plan inputs and policy" }),
  })
  const provider = yield* JudgmentProvider
  const fixture = yield* Effect.try({
    try: () => loadFixture(ROOT),
    catch: () => new FileError({ operation: "load frozen definition" }),
  })
  yield* Effect.try({ try: () => mkdirSync(out), catch: () => new FileError({ operation: "create new run directory" }) })
  yield* persist(resolve(out, "manifest.json"), plan)

  const records: Array<RecordedAttempt> = []
  let stopped = false
  let egress = 0

  const send = Effect.fn("JevStaged.send")(function* (id: string, stage: Stage, request: Request, index: number) {
    const requestHash = sha256(JSON.stringify(request))
    yield* persist(resolve(out, `${index}.request.json`), { id, stage, request })
    if (stopped || egress >= plan.maxEgress) {
      const record: RecordedAttempt = { id, stage, status: "not_attempted", requestHash, response: null }
      yield* persist(resolve(out, `${index}.receipt.json`), record)
      records.push(record)
      return null
    }
    // Durable intent comes before the network. An interrupted attempt is not silently retried.
    yield* persist(resolve(out, `${index}.intent.json`), { id, requestHash, startedAt: new Date().toISOString() })
    egress += 1
    const result = yield* Effect.result(provider.evaluate(request))
    if (Result.isFailure(result)) {
      const record: RecordedAttempt = { id, stage, status: "transport_error", requestHash, response: null }
      yield* persist(resolve(out, `${index}.receipt.json`), record)
      records.push(record)
      stopped = true
      return null
    }
    const received = result.success
    let parsed: Response | null = null
    let status = received.status === 200 ? "received" : "http_error"
    if (received.status === 200) {
      try {
        parsed = validateResponse(request, JSON.parse(received.raw))
      } catch {
        status = "schema_error"
        stopped = true
      }
    } else if ([401, 403, 422].includes(received.status)) {
      stopped = true
    }
    const record: RecordedAttempt = {
      id, stage, status, requestHash,
      response: parsed,
      provider: { status: received.status, requestId: received.requestId, elapsedMs: received.elapsedMs, raw: received.raw },
    }
    yield* persist(resolve(out, `${index}.receipt.json`), record)
    records.push(record)
    console.log(`${id}: ${status}`)
    return parsed
  })

  let index = 0
  for (const instance of plan.instances) {
    const base = instance.base as unknown as BaseState
    const gate = instance.gate as unknown as GateResult
    const stagedInstance: StagedInstance = {
      id: instance.id,
      subject: instance.subject,
      policy: instance.policyState,
      variants: instance.variants,
    }
    const directResponse = yield* send(`${instance.id}:direct`, "direct", instance.direct.request, index)
    index += 1
    const relationshipResponse = yield* send(`${instance.id}:relationship`, "relationship", instance.relationship.request, index)
    index += 1
    if (directResponse === null || relationshipResponse === null) continue

    const relationshipAnswer = answerChoice(relationshipResponse, "relationship")
    const childRequest = relationshipAnswer === null
      ? null
      : buildChildRequest(base, fixture.taxonomy, relationshipAnswer, plan.model)
    const childResponse = childRequest === null ? null : yield* send(`${instance.id}:child`, "child", childRequest, index)
    if (childRequest !== null) index += 1

    const stageAOutcome = interpretStaged(stagedInstance, base, fixture.taxonomy, gate, {
      relationship: relationshipResponse,
      child: childResponse,
      policy: null,
    })
    const policyRequest = buildPolicyRequest(base, establishedFacts(gate, stageAOutcome), stageAOutcome.eligibility, plan.model)
    if (policyRequest !== null) {
      yield* send(`${instance.id}:policy`, "policy", policyRequest, index)
      index += 1
    }
  }

  const run = { schema: "pulsar.jev_staged_run.v1", plan, planHash: sha256(canonical(plan)), records, egress }
  yield* persist(resolve(out, "run.json"), run)
  return run
})

const Run = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_staged_run.v1"),
  plan: Plan,
  planHash: Schema.String,
  records: Schema.Array(Schema.Struct({
    id: Schema.String,
    stage: Schema.Literals([...STAGES]),
    status: Schema.String,
    requestHash: Schema.String,
    response: Schema.NullOr(Schema.JsonObject),
    provider: Schema.optionalKey(Schema.JsonObject),
  })),
  egress: Schema.Int,
})

/**
 * Replay re-derives every composed request from the recorded answers and requires byte equality
 * with the request that was sent. A staged pipeline that is not deterministic fails replay
 * instead of quietly producing a different judgment.
 *
 * Every `received` record is additionally re-validated from its own raw response body: the
 * recorded request hash must match the request replay derived, `validateResponse` must accept the
 * raw body, and the stored parsed answer must equal what the raw body decodes to. A stored
 * response that no longer matches its provider receipt therefore fails replay rather than being
 * read as evidence.
 */
export function replay(bytes: string, expectedHash: string) {
  if (sha256(bytes) !== expectedHash) throw new Error("Run digest differs from trusted receipt")
  const run = Schema.decodeUnknownSync(Run)(JSON.parse(bytes))
  const plan = validatePlan(run.plan)
  if (sha256(canonical(plan)) !== run.planHash) throw new Error("Plan digest mismatch")
  const fixture = loadFixture(ROOT)
  const byId = new Map(run.records.map((record) => [record.id, record]))

  const requireRaw = (record: { provider?: Record<string, unknown> }, label: string): string => {
    const raw = record.provider?.["raw"]
    if (typeof raw !== "string") throw new Error(`${label}: received record has no raw response body`)
    return raw
  }

  /**
   * Return the record only when it was attempted and reached the expected stage. A record that
   * was not attempted is not evidence and is not validated.
   */
  const asReceived = (
    record: { stage: string; status: string } | undefined,
    stage: Stage,
    label: string,
  ): { id: string; stage: string; status: string; requestHash: string; response: unknown; provider?: Record<string, unknown> } | null => {
    if (record === undefined || record.status !== "received") return null
    if (record.stage !== stage) throw new Error(`${label}: recorded stage ${record.stage} does not match ${stage}`)
    return record as { id: string; stage: string; status: string; requestHash: string; response: unknown; provider?: Record<string, unknown> }
  }

  /**
   * Validate one received record against the request it answers and against its own provider
   * receipt. The raw body is the source of truth, so a stored answer that drifted from its
   * receipt fails replay instead of being read as evidence.
   */
  const verifyReceived = (
    record: { requestHash: string; response: unknown; provider?: Record<string, unknown> },
    request: Request,
    label: string,
  ): Response => {
    if (record.requestHash !== sha256(JSON.stringify(request))) {
      throw new Error(`${label}: recorded request hash does not match the request replay derived`)
    }
    const raw = requireRaw(record, label)
    let fromRaw: Response
    try {
      fromRaw = validateResponse(request, JSON.parse(raw))
    } catch (error) {
      throw new Error(`${label}: raw response body failed validation (${error instanceof Error ? error.message : "unparseable"})`)
    }
    if (record.response === null || record.response === undefined) throw new Error(`${label}: received record has no stored response`)
    let stored: Response
    try {
      stored = Schema.decodeUnknownSync(Response)(record.response)
    } catch (error) {
      throw new Error(`${label}: stored response does not decode (${error instanceof Error ? error.message.split("\n")[0] : "invalid"})`)
    }
    if (canonical(stored) !== canonical(fromRaw)) {
      throw new Error(`${label}: stored parsed response differs from the raw response body`)
    }
    return fromRaw
  }

  const latencies: Array<number> = []
  let inputTokens = 0
  let outputTokens = 0

  const instances = plan.instances.flatMap((instance) => {
    const base = instance.base as unknown as BaseState
    const gate = instance.gate as unknown as GateResult
    const stagedInstance: StagedInstance = {
      id: instance.id,
      subject: instance.subject,
      policy: instance.policyState,
      variants: instance.variants,
    }
    const directRecord = byId.get(`${instance.id}:direct`)
    const relationshipRecord = byId.get(`${instance.id}:relationship`)
    const childRecord = byId.get(`${instance.id}:child`)
    const policyRecord = byId.get(`${instance.id}:policy`)

    // Validate the two frozen requests against the plan before trusting any answer.
    const directReceived = asReceived(directRecord, "direct", `${instance.id}:direct`)
    const relationshipReceived = asReceived(relationshipRecord, "relationship", `${instance.id}:relationship`)
    if (directReceived === null || relationshipReceived === null) return []
    const directParsed = verifyReceived(directReceived, instance.direct.request, `${instance.id}:direct`)
    const relationshipParsed = verifyReceived(relationshipReceived, instance.relationship.request, `${instance.id}:relationship`)
    for (const record of [directReceived, relationshipReceived]) {
      if (record.provider === undefined) continue
      latencies.push(Number(record.provider["elapsedMs"] ?? 0))
    }
    inputTokens += directParsed.usage.input_tokens + relationshipParsed.usage.input_tokens
    outputTokens += directParsed.usage.output_tokens + relationshipParsed.usage.output_tokens

    // Re-derive the composed requests and require the recorded hashes.
    const relationshipAnswer = answerChoice(relationshipParsed, "relationship")
    if (relationshipAnswer === null) throw new Error(`${instance.id}: relationship answer missing`)
    const rederivedChild = buildChildRequest(base, fixture.taxonomy, relationshipAnswer, plan.model)
    if (rederivedChild === null) {
      if (childRecord !== undefined && childRecord.status === "received") throw new Error(`${instance.id}: child request recorded but not derivable`)
    } else if (childRecord === undefined) {
      throw new Error(`${instance.id}: child request missing`)
    } else if (childRecord.requestHash !== sha256(JSON.stringify(rederivedChild))) {
      throw new Error(`${instance.id}: child request is not reproducible from stage-A answers`)
    }

    const childReceived = rederivedChild === null ? null : asReceived(childRecord, "child", `${instance.id}:child`)
    const childParsed = childReceived === null || rederivedChild === null
      ? null
      : verifyReceived(childReceived, rederivedChild, `${instance.id}:child`)
    if (childParsed !== null && childReceived?.provider !== undefined) {
      latencies.push(Number(childReceived.provider["elapsedMs"] ?? 0))
      inputTokens += childParsed.usage.input_tokens
      outputTokens += childParsed.usage.output_tokens
    }
    const stageAOutcome = interpretStaged(stagedInstance, base, fixture.taxonomy, gate, {
      relationship: relationshipParsed,
      child: childParsed,
      policy: null,
    })
    const rederivedPolicy = buildPolicyRequest(base, establishedFacts(gate, stageAOutcome), stageAOutcome.eligibility, plan.model)
    if (rederivedPolicy === null) {
      if (policyRecord !== undefined && policyRecord.status === "received") throw new Error(`${instance.id}: policy request recorded but not derivable`)
    } else if (policyRecord === undefined) {
      throw new Error(`${instance.id}: policy request missing`)
    } else if (policyRecord.requestHash !== sha256(JSON.stringify(rederivedPolicy))) {
      throw new Error(`${instance.id}: policy request is not reproducible from established facts`)
    }
    const policyReceived = rederivedPolicy === null ? null : asReceived(policyRecord, "policy", `${instance.id}:policy`)
    const policyParsed = policyReceived === null || rederivedPolicy === null
      ? null
      : verifyReceived(policyReceived, rederivedPolicy, `${instance.id}:policy`)
    if (policyParsed !== null && policyReceived?.provider !== undefined) {
      latencies.push(Number(policyReceived.provider["elapsedMs"] ?? 0))
      inputTokens += policyParsed.usage.input_tokens
      outputTokens += policyParsed.usage.output_tokens
    }
    const staged = interpretStaged(stagedInstance, base, fixture.taxonomy, gate, {
      relationship: relationshipParsed,
      child: childParsed,
      policy: policyParsed,
    })
    return [{
      instance: instance.id,
      subject: instance.subject,
      direct: interpretDirect(stagedInstance, gate, directParsed),
      staged,
      stageStatus: {
        direct: directReceived.status,
        relationship: relationshipReceived.status,
        child: childRecord?.status ?? "not_applicable",
        policy: policyRecord?.status ?? "not_applicable",
      },
    }]
  })

  const sorted = [...latencies].sort((left, right) => left - right)
  const percentile = (fraction: number): number | null =>
    sorted.length === 0 ? null : sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)] ?? null
  const find = (id: string) => instances.find((entry) => entry.instance === id)

  const directRankedAnIneligibleCandidate = instances
    .filter((entry) => entry.direct.ranksIneligible === true)
    .map((entry) => entry.instance)
  const missingPolicy = instances.filter((entry) => entry.staged.policy.rankingBasis === "missing_policy")
  const repeat = find("consolidation-repeat")
  const baseline = find("consolidation")
  const swapped = find("consolidation-swapped")

  return {
    schema: "pulsar.jev_staged_summary.v1",
    runHash: expectedHash,
    planHash: run.planHash,
    definitionHash: plan.definitionHash,
    model: plan.model,
    egress: run.egress,
    validator: "hundredth-rounding-v1",
    probabilityTolerance: PROBABILITY_TOLERANCE,
    retainWidth: RETAIN_WIDTH,
    instances,
    metrics: {
      branchRecall: instances.map((entry) => ({
        instance: entry.instance,
        mechanical: entry.staged.relationship.mechanical,
        retained: entry.staged.relationship.retained.map((path) => path.path),
        recalled: entry.staged.relationship.branchRecall,
      })),
      providerObligationAgreement: instances.map((entry) => ({
        instance: entry.instance,
        facts: entry.staged.obligationFacts.map((fact) => ({
          obligation: fact.obligation,
          kind: fact.kind,
          variant: fact.variant,
          answer: fact.choice,
          consumed: fact.consumed,
          gateSatisfied: fact.variant === "a"
            ? entry.staged.gate.checks.a.find((check) => check.obligationId === fact.obligation)?.satisfied ?? null
            : entry.staged.gate.checks.b.find((check) => check.obligationId === fact.obligation)?.satisfied ?? null,
        })),
      })),
      directRankedAnIneligibleCandidate,
      directIneligibleWeight: instances
        .filter((entry) => entry.direct.ineligibleMass !== null)
        .map((entry) => ({
          instance: entry.instance,
          ineligibleMass: entry.direct.ineligibleMass,
          top: entry.direct.preference.top,
          distribution: entry.direct.preference.distribution,
        })),
      missingPolicy: missingPolicy.map((entry) => ({
        instance: entry.instance,
        stagedVerdict: entry.staged.verdict.kind,
        stagedRankingBasis: entry.staged.policy.rankingBasis,
        stagedPolicyRequestSent: entry.staged.policy.sent,
        directTop: entry.direct.preference.top,
        directDistribution: entry.direct.preference.distribution,
        directPolicyReadiness: entry.direct.policyReadiness,
      })),
      repeatDeterminism: repeat === undefined || baseline === undefined ? null : {
        relationshipDistributionIdentical: canonical(repeat.staged.relationship.distribution) === canonical(baseline.staged.relationship.distribution),
        childDistributionsIdentical: canonical(repeat.staged.relationship.childDistributions) === canonical(baseline.staged.relationship.childDistributions),
        stagedVerdictIdentical: canonical(repeat.staged.verdict) === canonical(baseline.staged.verdict),
        directDistributionIdentical: canonical(repeat.direct.preference.distribution) === canonical(baseline.direct.preference.distribution),
        directTop: { base: baseline.direct.preference.top, repeat: repeat.direct.preference.top },
        stagedTop: { base: baseline.staged.policy.top, repeat: repeat.staged.policy.top },
      },
      swapConsistency: swapped === undefined || baseline === undefined ? null : {
        mechanical: { base: baseline.staged.relationship.mechanical.root, swapped: swapped.staged.relationship.mechanical.root },
        stagedVerdict: { base: baseline.staged.verdict.kind, swapped: swapped.staged.verdict.kind },
        stagedLabel: { base: baseline.staged.verdict.label, swapped: swapped.staged.verdict.label },
        relationshipTop: { base: baseline.staged.relationship.top, swapped: swapped.staged.relationship.top },
        directTop: { base: baseline.direct.preference.top, swapped: swapped.direct.preference.top },
      },
    },
    inputTokens,
    outputTokens,
    estimatedUsd: inputTokens * 0.042 / 1_000_000,
    costCoverage: "Validated responses only; failed/invalid requests may incur unreported charges.",
    latency: {
      samples: sorted.length,
      meanMs: sorted.length === 0 ? null : Number((sorted.reduce((sum, value) => sum + value, 0) / sorted.length).toFixed(2)),
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      maxMs: sorted.length === 0 ? null : sorted[sorted.length - 1] ?? null,
      note: "Orb-observed fetch/body latency for this serial small sample; excludes evidence preparation and local checks.",
    },
    trust: "Local research receipt. An independently retained digest detects edits; no producer authentication or production authorization.",
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const onlyIndex = argv.indexOf("--only")
  const only = onlyIndex >= 0 ? (argv[onlyIndex + 1] ?? "").split(",").filter((id) => id.length > 0) : []
  const positional = onlyIndex >= 0
    ? argv.filter((_value, index) => index !== onlyIndex && index !== onlyIndex + 1)
    : argv
  const [command, arg, out, approval] = positional
  if (command === "prepare" && arg) {
    const plan = await prepare(only)
    writeFileSync(arg, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    console.log(`Prepared ${plan.instances.length} instances; egress cap ${plan.maxEgress}; inspect ${arg} before evaluate. SHA256 ${sha256(canonical(plan))}`)
  } else if (command === "evaluate" && arg && out && approval === "--allow-egress") {
    const key = process.env.TYPESAFE_API_KEY
    if (!key) throw new Error("TYPESAFE_API_KEY is required only for evaluate")
    const plan = validatePlan(JSON.parse(readFileSync(arg, "utf8")))
    try {
      await Effect.runPromise(evaluatePlan(plan, out).pipe(Effect.provide(jevLayer(key))))
    } finally {
      cleanupTemps()
    }
    const bytes = readFileSync(resolve(out, "run.json"), "utf8")
    const summary = replay(bytes, sha256(bytes))
    writeFileSync(resolve(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" })
    console.log(`Recorded ${summary.egress} egress attempts; run SHA256 ${sha256(bytes)}`)
  } else if (command === "replay" && arg && out) {
    console.log(JSON.stringify(replay(readFileSync(arg, "utf8"), out), null, 2))
  } else {
    throw new Error("Usage: bun scripts/jev-staged-judgment.ts prepare <plan.json> | evaluate <plan.json> <new-run-dir> --allow-egress | replay <run.json> <trusted-sha256>")
  }
}

const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message.length > 0) return error.message
  if (typeof error === "object" && error !== null) return JSON.stringify(error)
  return String(error)
}

if (import.meta.main) main().catch((error) => { console.error(describeError(error)); process.exitCode = 1 })
