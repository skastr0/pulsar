#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Data, Effect, Result, Schema } from "effect"
import { Case, PROBABILITY_TOLERANCE, Request, canonical, compile, sha256, summarize, validateBank, validateResponse } from "./jev-spike/model.ts"
import { JudgmentProvider, jevLayer } from "./jev-spike/transport.ts"
import { pulsarCase } from "./jev-spike/pulsar-case.ts"

const ROOT = resolve(import.meta.dir, "..")
const BANK_PATH = resolve(ROOT, "docs/explorations/jev-spike-question-bank.json")
const CASES_PATH = resolve(ROOT, "scripts/fixtures/jev/cases.json")
export const MAX_REQUESTS = 32
export const MAX_REQUEST_BYTES = 100_000

export const smokeRequest: Request = {
  model: "jev-latest",
  state: { statement: "There are exactly three red balls in the box and no blue balls." },
  questions: {
    color: { type: "choice", instructions: "What color are the balls?", criteria: { red: "Red", blue: "Blue", unknown: "Not stated" } },
    count: { type: "score", instructions: "How many balls are in the box?", criteria: ["Zero balls", "One ball", "Two balls", "Three balls"] },
    blue: { type: "noul", instructions: "Is there a blue ball in the box?", criteria: { true: "At least one blue ball", false: "No blue balls" } },
  },
}

const Plan = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_spike_plan.v1"),
  mode: Schema.Literals(["smoke", "development", "pulsar"]),
  createdAt: Schema.String,
  repositorySha: Schema.String,
  bankHash: Schema.String,
  casesHash: Schema.String,
  maxRequests: Schema.Int,
  maxRequestBytes: Schema.Int,
  policy: Schema.JsonObject,
  requests: Schema.Array(Schema.Struct({ id: Schema.String, lineage: Schema.String, request: Request, requestHash: Schema.String })),
})
export type Plan = typeof Plan.Type

export function prepare(mode: Plan["mode"], model = "jev-latest"): Plan {
  const bank = validateBank(JSON.parse(readFileSync(BANK_PATH, "utf8")))
  const cases = mode === "development"
    ? Schema.decodeUnknownSync(Schema.Array(Case))(JSON.parse(readFileSync(CASES_PATH, "utf8")))
    : mode === "pulsar" ? [pulsarCase(ROOT)] : []
  if (new Set(cases.map((fixture) => fixture.id)).size !== cases.length) throw new Error("Duplicate case IDs")
  const requests = mode === "smoke"
    ? [{ id: "contract-smoke", lineage: "contract-smoke", request: { ...smokeRequest, model } }]
    : cases.map((fixture) => ({ id: fixture.id, lineage: fixture.lineage, request: compile(bank, fixture, model) }))
  // Fixed repeats and paired A/B swaps; chosen before inspecting any results.
  if (mode === "development") {
    const first = requests[0]
    if (first) for (let index = 2; index <= 5; index++) requests.push({ ...first, id: `${first.id}-repeat-${index}` })
    for (const entry of requests.slice(0, cases.length)) {
      if (!entry.request.questions["JQ-17"]) continue
      const alternatives = Schema.decodeUnknownSync(Schema.JsonObject)(entry.request.state.alternatives)
      if (!alternatives.a || !alternatives.b) throw new Error("Pairwise comparison needs both alternatives")
      requests.push({ ...entry, id: `${entry.id}-swapped`, request: {
        ...entry.request, state: { ...entry.request.state, alternatives: { ...alternatives, a: alternatives.b, b: alternatives.a } },
      } })
    }
  }
  const plan: Plan = {
    schema: "pulsar.jev_spike_plan.v1", mode, createdAt: new Date().toISOString(),
    repositorySha: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT }).stdout.toString().trim(),
    bankHash: sha256(canonical(bank)), casesHash: sha256(canonical(cases)),
    maxRequests: MAX_REQUESTS, maxRequestBytes: MAX_REQUEST_BYTES,
    policy: {
      status: "development_only", authority: "tier3_research_only", modelRevisionStatus: "unresolved",
      labelStatus: "author_proposed_not_human_reviewed", retries: 0, concurrency: 1, timeoutMs: 30_000,
      probabilityTolerance: PROBABILITY_TOLERANCE, inputUsdPerMillion: 0.042, outputUsdPerMillion: 0,
      budget: "Hard request and byte caps; usage-based costs are estimates, not an account billing limit.",
      conventionalBaseline: "not_run_no_separate_provider_credentials",
      acceptanceGates: "not_run_requires_reviewed_labels_and_held_out_cases",
      disclosure: mode === "pulsar" ? "owner_authorized_public_repository" : "synthetic_only",
    },
    requests: requests.map((entry) => ({ ...entry, requestHash: sha256(JSON.stringify(entry.request)) })),
  }
  validatePlan(plan)
  return plan
}

export function validatePlan(input: unknown): Plan {
  const plan = Schema.decodeUnknownSync(Plan)(input)
  if (plan.requests.length === 0 || plan.maxRequests !== MAX_REQUESTS || plan.maxRequestBytes !== MAX_REQUEST_BYTES ||
      plan.requests.length > MAX_REQUESTS) throw new Error("Request budget exceeded or altered")
  if (new Set(plan.requests.map((entry) => entry.id)).size !== plan.requests.length) throw new Error("Duplicate request IDs")
  for (const entry of plan.requests) {
    const body = JSON.stringify(entry.request)
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error(`Request byte cap: ${entry.id}`)
    if (sha256(body) !== entry.requestHash) throw new Error(`Request hash mismatch: ${entry.id}`)
  }
  return plan
}

class FileError extends Data.TaggedError("FileError")<{ readonly operation: string }> {}
const persist = (path: string, value: unknown) => Effect.try({
  try: () => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }),
  catch: () => new FileError({ operation: `exclusive write ${path}` }),
})

export const evaluatePlan = Effect.fn("JevSpike.evaluatePlan")(function* (plan: Plan, out: string) {
  const provider = yield* JudgmentProvider
  // Exclusive directory and manifest creation prevent rerunning into an existing ledger.
  yield* Effect.try({ try: () => mkdirSync(out), catch: () => new FileError({ operation: "create new run directory" }) })
  yield* persist(resolve(out, "manifest.json"), plan)
  const records = []
  for (const [index, entry] of plan.requests.entries()) {
    // Durable intent comes before the network. An interrupted attempt is not silently retried.
    yield* persist(resolve(out, `${index}.intent.json`), { id: entry.id, requestHash: entry.requestHash, startedAt: new Date().toISOString() })
    const result = yield* Effect.result(provider.evaluate(entry.request))
    const record = Result.isFailure(result)
      ? { id: entry.id, status: "transport_error", receipt: null }
      : { id: entry.id, status: result.success.status === 200 ? "received" : "http_error", receipt: result.success }
    yield* persist(resolve(out, `${index}.receipt.json`), record)
    records.push(record)
    console.log(`${entry.id}: ${record.status}`)
  }
  const run = { schema: "pulsar.jev_spike_run.v1", plan, planHash: sha256(canonical(plan)), records }
  yield* persist(resolve(out, "run.json"), run)
  return run
})

const Run = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_spike_run.v1"),
  plan: Plan,
  planHash: Schema.String,
  records: Schema.Array(Schema.Struct({
    id: Schema.String,
    status: Schema.Literals(["received", "transport_error", "http_error"]),
    receipt: Schema.NullOr(Schema.Struct({ status: Schema.Int, raw: Schema.String, requestId: Schema.NullOr(Schema.String), elapsedMs: Schema.Finite })),
  })),
})

export function replay(bytes: string, expectedHash: string) {
  if (sha256(bytes) !== expectedHash) throw new Error("Run digest differs from trusted receipt")
  const run = Schema.decodeUnknownSync(Run)(JSON.parse(bytes))
  const plan = validatePlan(run.plan)
  if (sha256(canonical(plan)) !== run.planHash) throw new Error("Plan digest mismatch")
  if (run.records.length !== plan.requests.length) throw new Error("Incomplete record inventory")
  let inputTokens = 0
  let outputTokens = 0
  const results = run.records.map((record, index) => {
    const entry = plan.requests[index]!
    if (entry.id !== record.id) throw new Error("Record identity mismatch")
    if (record.status !== "received" || record.receipt?.status !== 200) return { id: record.id, status: record.status, consumption: "unconsumed" }
    try {
      const response = validateResponse(entry.request, JSON.parse(record.receipt.raw))
      inputTokens += response.usage.input_tokens
      outputTokens += response.usage.output_tokens
      return { id: record.id, status: "valid", model: response.model, elapsedMs: record.receipt.elapsedMs, ...summarize(entry.request, response) }
    } catch {
      return { id: record.id, status: "invalid_response", consumption: "unconsumed" }
    }
  })
  return {
    schema: "pulsar.jev_spike_summary.v1", runHash: expectedHash, planHash: run.planHash,
    validator: "hundredth-rounding-v1", probabilityTolerance: PROBABILITY_TOLERANCE,
    results, inputTokens, outputTokens, estimatedUsd: inputTokens * 0.042 / 1_000_000,
    costCoverage: "Validated responses only; failed/invalid requests may incur unreported charges.",
    trust: "Local research receipt. An independently retained digest detects edits; no producer authentication or production authorization.",
  }
}

async function main() {
  const [command, arg, out, approval] = process.argv.slice(2)
  if (command === "prepare" && (arg === "smoke" || arg === "development" || arg === "pulsar") && out) {
    const plan = prepare(arg)
    writeFileSync(out, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    console.log(`Prepared ${plan.requests.length} requests; inspect ${out} before evaluate. SHA256 ${sha256(canonical(plan))}`)
  } else if (command === "evaluate" && arg && out && approval === "--allow-egress") {
    const key = process.env.TYPESAFE_API_KEY
    if (!key) throw new Error("TYPESAFE_API_KEY is required only for evaluate")
    const plan = validatePlan(JSON.parse(readFileSync(arg, "utf8")))
    await Effect.runPromise(evaluatePlan(plan, out).pipe(Effect.provide(jevLayer(key))))
    const bytes = readFileSync(resolve(out, "run.json"), "utf8")
    const summary = replay(bytes, sha256(bytes))
    writeFileSync(resolve(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" })
    console.log(`Recorded ${summary.results.length} attempts; run SHA256 ${sha256(bytes)}`)
  } else if (command === "replay" && arg && out) {
    console.log(JSON.stringify(replay(readFileSync(arg, "utf8"), out), null, 2))
  } else {
    throw new Error("Usage: bun scripts/jev-spike.ts prepare <smoke|development|pulsar> <plan.json> | evaluate <plan.json> <new-run-dir> --allow-egress | replay <run.json> <trusted-sha256>")
  }
}

if (import.meta.main) main().catch((error) => { console.error(error instanceof Error ? error.message : "Spike failed"); process.exitCode = 1 })
