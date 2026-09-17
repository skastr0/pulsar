#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Data, Effect, Result, Schema } from "effect"
import {
  canonical,
  PROBABILITY_TOLERANCE,
  Request,
  sha256,
  validateResponse,
  type Response,
} from "./jev-spike/model.ts"
import { JudgmentProvider, jevLayer } from "./jev-spike/transport.ts"
import { assertNoVerdictMarkers, buildEntry, TASKS, type Expected, type MaintTask } from "./jev-maint/tasks.ts"
import { cleanupTemps, runPatchOutcome, type PatchOutcome } from "./jev-maint/probe.ts"
import { PATCHES, type Variant } from "./jev-maint/patches.ts"

const ROOT = resolve(import.meta.dir, "..")

export const MAX_REQUESTS = 16
export const MAX_REQUEST_BYTES = 100_000
/** Illustrative only: the consistency cookbook's example threshold, not an acceptance gate. */
export const ILLUSTRATIVE_UNDECIDED_THRESHOLD = 0.6
export const NOUL_UNDECIDED_BAND = 0.35

type ScheduleEntry = {
  readonly id: string
  readonly task: MaintTask["id"]
  readonly variant: Variant
  readonly rotateChangeKinds?: boolean
  readonly reverseOptions?: boolean
  readonly repeatOf?: string
}

/**
 * Fixed schedule. The development batch may inform the packet shape; the
 * evaluation batch and its two counterbalance/repeat requests are frozen once
 * the development batch has been recorded. `delegated-rule` and
 * `missing-output` never appear in the development batch.
 */
export const SCHEDULE: Record<"development" | "evaluation", ReadonlyArray<ScheduleEntry>> = {
  development: [
    { id: "dev-shared-contract-a", task: "shared-contract", variant: "a" },
    { id: "dev-caller-failure-a", task: "caller-failure", variant: "a" },
  ],
  evaluation: [
    { id: "shared-contract-a", task: "shared-contract", variant: "a" },
    { id: "shared-contract-b", task: "shared-contract", variant: "b" },
    { id: "caller-failure-a", task: "caller-failure", variant: "a" },
    { id: "caller-failure-b", task: "caller-failure", variant: "b" },
    { id: "delegated-rule-a", task: "delegated-rule", variant: "a" },
    { id: "delegated-rule-b", task: "delegated-rule", variant: "b" },
    { id: "missing-output-a", task: "missing-output", variant: "a" },
    { id: "missing-output-b", task: "missing-output", variant: "b" },
    { id: "insufficient-context-b", task: "insufficient-context", variant: "b" },
    { id: "shared-contract-b-options-reversed", task: "shared-contract", variant: "b", rotateChangeKinds: true, reverseOptions: true },
    { id: "shared-contract-b-repeat", task: "shared-contract", variant: "b", repeatOf: "shared-contract-b" },
  ],
}

const ExpectedSchema = Schema.Struct({
  changeKind: Schema.String,
  owners: Schema.Array(Schema.String),
  sharedObligation: Schema.Boolean,
  successProducerCount: Schema.Int,
  patch: Schema.NullOr(Schema.String),
  evidenceReadiness: Schema.String,
})

const Plan = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_maint_plan.v1"),
  batch: Schema.Literals(["development", "evaluation"]),
  createdAt: Schema.String,
  repositorySha: Schema.String,
  model: Schema.String,
  policy: Schema.JsonObject,
  requests: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      lineage: Schema.String,
      request: Request,
      requestHash: Schema.String,
      expected: ExpectedSchema,
    }),
  ),
})
export type Plan = typeof Plan.Type

const POLICY = {
  status: "development_only",
  authority: "tier3_research_only",
  modelRevisionStatus: "unresolved",
  labelStatus: "author_proposed_not_human_reviewed",
  groundTruthStatus: "compiler_and_runtime_verified_locally_in_disposable_copies",
  retries: 0,
  concurrency: 1,
  timeoutMs: 30_000,
  probabilityTolerance: PROBABILITY_TOLERANCE,
  inputUsdPerMillion: 0.042,
  outputUsdPerMillion: 0,
  disclosure: "owner_authorized_public_repository",
  aggregation: "none",
  criteriaStatus: "proposed_repo_scoped_experiment_not_adopted",
  stopOnAuthOrSchemaError: true,
  tunedTasks: ["shared-contract", "caller-failure"],
  heldOutTasks: ["delegated-rule", "missing-output", "insufficient-context"],
  flatControl: "not_run_in_this_batch",
  primitiveForms: [
    "structured instructions naming inspect/compare/focus",
    "structured Choice options with what/not_for/examples",
    "structured Score levels with summary/signals",
    "structured Noul true/false boundaries with examples",
    "taxonomy of change kinds carrying subtree context",
    "one ownership Noul per supplied symbol",
  ],
  undecidedConvention: {
    choice: `reported when the top probability is below ${ILLUSTRATIVE_UNDECIDED_THRESHOLD} (illustrative, not an acceptance gate)`,
    noul: `reported when the probability falls inside ${NOUL_UNDECIDED_BAND}..${1 - NOUL_UNDECIDED_BAND}`,
    score: "reported when the returned mean sits between two levels and within 0.25 of the midpoint",
  },
}

export function prepare(batch: "development" | "evaluation", model = "jev-latest"): Plan {
  const requests = SCHEDULE[batch].map((scheduled) => {
    const task = TASKS.find((candidate) => candidate.id === scheduled.task)
    if (task === undefined) throw new Error(`Unknown task ${scheduled.task}`)
    const entry = buildEntry(ROOT, model, task, {
      variant: scheduled.variant,
      ...(scheduled.rotateChangeKinds === true ? { rotateChangeKinds: true } : {}),
      ...(scheduled.reverseOptions === true ? { reverseOptions: true } : {}),
    })
    assertNoVerdictMarkers(entry)
    return { id: scheduled.id, lineage: entry.lineage, request: entry.request, expected: entry.expected }
  })
  const byId = new Map(requests.map((entry) => [entry.id, entry]))
  for (const scheduled of SCHEDULE[batch]) {
    if (scheduled.repeatOf === undefined) continue
    const source = byId.get(scheduled.repeatOf)
    const target = byId.get(scheduled.id)
    if (source === undefined || target === undefined) throw new Error(`Repeat source missing for ${scheduled.id}`)
    if (JSON.stringify(source.request) !== JSON.stringify(target.request)) {
      throw new Error(`Repeat request differs from ${scheduled.repeatOf}`)
    }
  }
  const plan: Plan = {
    schema: "pulsar.jev_maint_plan.v1",
    batch,
    createdAt: new Date().toISOString(),
    repositorySha: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString().trim(),
    model,
    policy: POLICY,
    requests: requests.map((entry) => ({
      ...entry,
      requestHash: sha256(JSON.stringify(entry.request)),
    })),
  }
  validatePlan(plan)
  return plan
}

export function validatePlan(input: unknown): Plan {
  const plan = Schema.decodeUnknownSync(Plan)(input)
  const scheduled = SCHEDULE[plan.batch]
  if (plan.requests.length !== scheduled.length || plan.requests.length > MAX_REQUESTS) {
    throw new Error("Request budget exceeded or schedule length altered")
  }
  if (new Set(plan.requests.map((entry) => entry.id)).size !== plan.requests.length) {
    throw new Error("Duplicate request IDs")
  }
  if (canonical(plan.policy) !== canonical(POLICY)) throw new Error("Policy altered")
  for (const [index, entry] of plan.requests.entries()) {
    if (entry.id !== scheduled[index]!.id || entry.lineage !== scheduled[index]!.task) {
      throw new Error(`Schedule order altered at ${entry.id}`)
    }
    const body = JSON.stringify(entry.request)
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error(`Request byte cap: ${entry.id}`)
    if (sha256(body) !== entry.requestHash) throw new Error(`Request hash mismatch: ${entry.id}`)
    for (const question of Object.values(entry.request.questions)) {
      const count = Object.keys(question.criteria).length
      if (count < 2 || count > (question.type === "score" ? 10 : 255)) {
        throw new Error(`Invalid question cardinality: ${entry.id}`)
      }
    }
    const expected = entry.expected as Expected
    for (const owner of expected.owners) {
      if (!Object.hasOwn(entry.request.state.symbols as object, owner)) {
        throw new Error(`Expected owner not supplied: ${entry.id} ${owner}`)
      }
    }
  }
  return plan
}

export function validateCurrentInputs(plan: Plan): void {
  const current = prepare(plan.batch, plan.model)
  const { createdAt: _prepared, ...prepared } = plan
  const { createdAt: _rebuilt, ...rebuilt } = current
  if (canonical(prepared) !== canonical(rebuilt)) {
    throw new Error("Prepared inputs or policy changed; prepare and inspect a new plan")
  }
}

class FileError extends Data.TaggedError("FileError")<{ readonly operation: string }> {}

const persist = (path: string, value: unknown) =>
  Effect.try({
    try: () => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }),
    catch: () => new FileError({ operation: `exclusive write ${path}` }),
  })

export const evaluatePlan = Effect.fn("JevMaint.evaluatePlan")(function* (plan: Plan, out: string) {
  yield* Effect.try({
    try: () => validateCurrentInputs(validatePlan(plan)),
    catch: () => new FileError({ operation: "validate current plan inputs and policy" }),
  })
  const provider = yield* JudgmentProvider
  yield* Effect.try({ try: () => mkdirSync(out), catch: () => new FileError({ operation: "create new run directory" }) })
  yield* persist(resolve(out, "manifest.json"), plan)
  const records = []
  let stopped = false
  for (const [index, entry] of plan.requests.entries()) {
    if (stopped) {
      const record = { id: entry.id, status: "not_attempted", receipt: null }
      yield* persist(resolve(out, `${index}.receipt.json`), record)
      records.push(record)
      continue
    }
    // Durable intent precedes the network. An interrupted attempt is not silently retried.
    yield* persist(resolve(out, `${index}.intent.json`), {
      id: entry.id,
      requestHash: entry.requestHash,
      startedAt: new Date().toISOString(),
    })
    const result = yield* Effect.result(provider.evaluate(entry.request))
    const record = Result.isFailure(result)
      ? { id: entry.id, status: "transport_error", receipt: null }
      : { id: entry.id, status: result.success.status === 200 ? "received" : "http_error", receipt: result.success }
    yield* persist(resolve(out, `${index}.receipt.json`), record)
    records.push(record)
    console.log(`${entry.id}: ${record.status}`)
    if (record.receipt) {
      if ([401, 403, 422].includes(record.receipt.status)) stopped = true
      else if (record.receipt.status === 200) {
        try {
          validateResponse(entry.request, JSON.parse(record.receipt.raw))
        } catch (error) {
          console.error(`${entry.id}: response rejected locally (${error instanceof Error ? error.message : "unknown"})`)
          stopped = true
        }
      }
    }
  }
  const run = { schema: "pulsar.jev_maint_run.v1", plan, planHash: sha256(canonical(plan)), records }
  yield* persist(resolve(out, "run.json"), run)
  return run
})

const Run = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_maint_run.v1"),
  plan: Plan,
  planHash: Schema.String,
  records: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      status: Schema.Literals(["received", "transport_error", "http_error", "not_attempted"]),
      receipt: Schema.NullOr(
        Schema.Struct({
          status: Schema.Int,
          raw: Schema.String,
          requestId: Schema.NullOr(Schema.String),
          elapsedMs: Schema.Finite,
        }),
      ),
    }),
  ),
})

const choiceAnswer = (answer: { choice: string; probabilities: Record<string, number> }) => {
  const entries = Object.entries(answer.probabilities).sort((left, right) => right[1] - left[1])
  const top = entries[0]?.[1] ?? 0
  const runnerUp = entries[1]?.[1] ?? 0
  return {
    choice: answer.choice,
    maxProbability: top,
    margin: Number((top - runnerUp).toFixed(4)),
    undecided: top < ILLUSTRATIVE_UNDECIDED_THRESHOLD,
  }
}

const noulAnswer = (probability: number) => ({
  probability,
  thresholded: probability > 0.5,
  undecided: probability >= NOUL_UNDECIDED_BAND && probability <= 1 - NOUL_UNDECIDED_BAND,
})

/**
 * A Score answer is a distribution over the supplied levels plus a returned
 * mean. The mean is a position on that scale, not the level the model selected,
 * so the level is reported as the distribution's mode and the rounded mean is
 * kept beside it rather than presented as the answer.
 */
const scoreAnswer = (answer: { score: number; probabilities: Record<string, number> }) => {
  const entries = Object.entries(answer.probabilities)
    .map(([level, probability]) => ({ level: Number(level), probability }))
    .sort((left, right) => right.probability - left.probability || left.level - right.level)
  const mode = entries[0] ?? null
  return {
    mean: answer.score,
    meanRounded: Math.round(answer.score),
    distribution: Object.fromEntries(
      Object.entries(answer.probabilities).sort((left, right) => Number(left[0]) - Number(right[0])),
    ),
    modeLevel: mode?.level ?? null,
    modeProbability: mode?.probability ?? 0,
    // A near-tie between levels is not a selection.
    undecided: (mode?.probability ?? 0) < ILLUSTRATIVE_UNDECIDED_THRESHOLD,
  }
}

export function compareToExpected(response: Response, expected: Expected) {
  const answers = response.answers
  const changeKind = answers["change_kind"]
  const shared = answers["shared_obligation"]
  const count = answers["success_producer_count"]
  const patch = answers["patch"]
  const readiness = answers["evidence_readiness"]
  const policy = answers["policy_readiness"]
  const owners = Object.entries(answers)
    .filter(([id]) => id.startsWith("owns_"))
    .map(([id, answer]) => ({
      symbol: id.slice("owns_".length),
      probability: answer.type === "noul" ? answer.noul : null,
    }))
  const predicted = owners.filter((owner) => (owner.probability ?? 0) > 0.5).map((owner) => owner.symbol)
  const expectedOwners = [...expected.owners]
  const missing = expectedOwners.filter((owner) => !predicted.includes(owner))
  const spurious = predicted.filter((owner) => !expectedOwners.includes(owner))
  return {
    changeKind:
      changeKind?.type === "choice"
        ? { ...choiceAnswer(changeKind), agrees: changeKind.choice === expected.changeKind }
        : null,
    sharedObligation:
      shared?.type === "noul" ? { ...noulAnswer(shared.noul), agrees: (shared.noul > 0.5) === expected.sharedObligation } : null,
    successProducerCount:
      count?.type === "score"
        ? {
            ...scoreAnswer(count),
            agrees: scoreAnswer(count).modeLevel === expected.successProducerCount,
            meanRoundedAgrees: Math.round(count.score) === expected.successProducerCount,
          }
        : null,
    patch:
      patch?.type === "choice"
        ? { ...choiceAnswer(patch), agrees: patch.choice === expected.patch }
        : null,
    evidenceReadiness:
      readiness?.type === "choice"
        ? { ...choiceAnswer(readiness), agrees: readiness.choice === expected.evidenceReadiness }
        : null,
    policyReadiness: policy?.type === "choice" ? choiceAnswer(policy) : null,
    owners: {
      probabilities: Object.fromEntries(owners.map((owner) => [owner.symbol, owner.probability])),
      predicted,
      expected: expectedOwners,
      missing,
      spurious,
      exact: missing.length === 0 && spurious.length === 0,
    },
  }
}

export function replay(bytes: string, trustedHash: string) {
  if (sha256(bytes) !== trustedHash) throw new Error("Run digest differs from trusted receipt")
  const run = Schema.decodeUnknownSync(Run)(JSON.parse(bytes))
  const plan = validatePlan(run.plan)
  if (sha256(canonical(plan)) !== run.planHash) throw new Error("Plan digest mismatch")
  if (run.records.length !== plan.requests.length) throw new Error("Incomplete record inventory")
  let inputTokens = 0
  let outputTokens = 0
  const results = run.records.map((record, index) => {
    const entry = plan.requests[index]!
    if (entry.id !== record.id) throw new Error("Record identity mismatch")
    if (record.status !== "received" || record.receipt?.status !== 200) {
      return { id: record.id, status: record.status, comparison: null }
    }
    try {
      const response = validateResponse(entry.request, JSON.parse(record.receipt.raw))
      inputTokens += response.usage.input_tokens
      outputTokens += response.usage.output_tokens
      return {
        id: record.id,
        status: "valid",
        model: response.model,
        elapsedMs: record.receipt.elapsedMs,
        // The untouched answer objects, so no downstream reader has to trust a
        // derived field to identify which answer said what.
        answers: response.answers,
        comparison: compareToExpected(response, entry.expected),
      }
    } catch {
      return { id: record.id, status: "invalid_response", comparison: null }
    }
  })
  return {
    schema: "pulsar.jev_maint_summary.v1",
    batch: plan.batch,
    runHash: trustedHash,
    planHash: run.planHash,
    validator: "hundredth-rounding-v1",
    probabilityTolerance: PROBABILITY_TOLERANCE,
    results,
    inputTokens,
    outputTokens,
    estimatedUsd: (inputTokens * 0.042) / 1_000_000,
    costCoverage: "Validated responses only; failed or invalid requests may incur unreported charges.",
    trust: "Local research receipt. An independently retained digest detects edits; no producer authentication.",
  }
}

async function verifyPatchMatrix(out: string): Promise<void> {
  const outcomes: Array<PatchOutcome> = []
  for (const variant of ["a", "b"] as const) {
    for (const patch of PATCHES) {
      const outcome = await runPatchOutcome(ROOT, variant, patch.id)
      outcomes.push(outcome)
      console.log(
        `${variant} ${patch.id}: compiles=${outcome.compiles} satisfies=${outcome.requirementSatisfied} owners=${outcome.declaredEditedOwners.length}${outcome.unmetRequirement ? ` unmet=${outcome.unmetRequirement}` : ""}${outcome.obligationsViolated.length > 0 ? ` violated=${outcome.obligationsViolated.join("|")}` : ""}`,
      )
    }
  }
  cleanupTemps()
  writeFileSync(
    out,
    JSON.stringify(
      {
        schema: "pulsar.jev_maint_patch_matrix.v1",
        repositorySha: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString().trim(),
        note: "Each row is one candidate patch applied to a disposable copy of packages/core/src and checked with tsc plus a runtime probe.",
        outcomes,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  )
  console.log(`Wrote ${outcomes.length} outcomes to ${out}`)
}

async function main() {
  const [command, arg, out, approval] = process.argv.slice(2)
  if (command === "prepare" && (arg === "development" || arg === "evaluation") && out) {
    const plan = prepare(arg)
    writeFileSync(out, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    console.log(`Prepared ${plan.requests.length} requests for ${arg}; inspect ${out} before evaluate.`)
    console.log(`Plan SHA256 ${sha256(canonical(plan))}`)
    console.log(`Request SHA256 ${plan.requests.map((entry) => entry.requestHash).join(" ")}`)
  } else if (command === "evaluate" && arg && out && approval === "--allow-egress") {
    const key = process.env.TYPESAFE_API_KEY
    if (!key) throw new Error("TYPESAFE_API_KEY is required only for evaluate")
    const plan = validatePlan(JSON.parse(readFileSync(arg, "utf8")))
    await Effect.runPromise(evaluatePlan(plan, out).pipe(Effect.provide(jevLayer(key))))
    const bytes = readFileSync(resolve(out, "run.json"), "utf8")
    const summary = replay(bytes, sha256(bytes))
    writeFileSync(resolve(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" })
    console.log(`Run SHA256 ${sha256(bytes)}`)
  } else if (command === "replay" && arg && out) {
    console.log(JSON.stringify(replay(readFileSync(arg, "utf8"), out), null, 2))
  } else if (command === "verify" && arg) {
    await verifyPatchMatrix(arg)
  } else {
    throw new Error(
      "Usage: bun scripts/jev-maint.ts prepare <development|evaluation> <plan.json> | evaluate <plan.json> <new-run-dir> --allow-egress | replay <run.json> <trusted-sha256> | verify <patch-matrix.json>",
    )
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const detail =
      error instanceof Error
        ? error.message.length > 0
          ? `${error.name}: ${error.message}`
          : `${error.name} ${JSON.stringify({ ...error })}`
        : String(error)
    console.error(`jev-maint failed: ${detail}`)
    process.exitCode = 1
  })
}
