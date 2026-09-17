#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { Data, Effect, Result, Schema } from "effect"
import { canonical, PROBABILITY_TOLERANCE, sha256, validateResponse, type Request, type Response } from "./jev-spike/model.ts"
import { JudgmentProvider, jevLayer } from "./jev-spike/transport.ts"
import {
  buildPolicyClarityPlan,
  readPlan,
  SCOPE,
  validateCurrentCaseInputs,
  validatePolicyClarityPlan,
  type Condition,
  type PolicyClarityPlan,
  type Scope,
} from "./jev-spike/policy-clarity.ts"
import { CASE_ORDER, buildPolicyClarityCases, type PolicyClarityCase } from "./jev-spike/policy-clarity-cases.ts"
import { cleanupRepoCopies, collectEvidence } from "./jev-spike/policy-clarity-evidence.ts"

const ROOT = resolve(import.meta.dir, "..")

class FileError extends Data.TaggedError("FileError")<{ readonly operation: string }> {}

const persist = (path: string, value: unknown) =>
  Effect.try({
    try: () => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }),
    catch: () => new FileError({ operation: `exclusive write ${path}` }),
  })

export interface Receipt {
  readonly status: number
  readonly raw: string
  readonly requestId: string | null
  readonly elapsedMs: number
}

export interface Record_ {
  readonly id: string
  readonly status: "received" | "transport_error" | "http_error" | "not_attempted"
  readonly receipt: Receipt | null
}

export const evaluatePlan = Effect.fn("PolicyClarity.evaluatePlan")(function* (plan: PolicyClarityPlan, out: string) {
  yield* Effect.try({
    try: () => validateCurrentCaseInputs(validatePolicyClarityPlan(plan), ROOT),
    catch: () => new FileError({ operation: "validate current case inputs" }),
  })
  const provider = yield* JudgmentProvider
  yield* Effect.try({ try: () => mkdirSync(out), catch: () => new FileError({ operation: "create new run directory" }) })
  yield* persist(resolve(out, "manifest.json"), plan)
  const records: Record_[] = []
  let stopped = false
  for (const [index, entry] of plan.requests.entries()) {
    if (stopped) {
      const record: Record_ = { id: entry.id, status: "not_attempted", receipt: null }
      yield* persist(resolve(out, `${index}.receipt.json`), record)
      records.push(record)
      continue
    }
    // Durable intent precedes the network. An interrupted attempt is investigated, never resent.
    yield* persist(resolve(out, `${index}.intent.json`), {
      id: entry.id,
      requestHash: entry.requestHash,
      startedAt: new Date().toISOString(),
    })
    const result = yield* Effect.result(provider.evaluate(entry.request))
    const record: Record_ = Result.isFailure(result)
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
        } catch {
          stopped = true
        }
      }
    }
  }
  const run = { schema: "pulsar.jev_policy_clarity_run.v1", plan, planHash: sha256(canonical(plan)), records }
  yield* persist(resolve(out, "run.json"), run)
  return run
})

const Run = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_policy_clarity_run.v1"),
  plan: Schema.Unknown,
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

interface Sample {
  readonly id: string
  readonly caseId: PolicyClarityCase["id"]
  readonly condition: Condition
  readonly order: number
  readonly repeat: number
  /** Which batch produced this sample, so pooled cells can be decomposed. */
  readonly scope: Scope
  readonly labelChoice: string
  readonly physicalChoice: string
  readonly probabilities: Record<string, number>
  readonly confidence: number
  readonly policyReadiness: string
  readonly evidenceReadiness: string
  readonly obligationsNoul: number
  readonly elapsedMs: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly model: string
}

const nearestRank = (values: ReadonlyArray<number>, percentile: number): number | null => {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.max(1, Math.ceil((percentile / 100) * sorted.length))
  return sorted[rank - 1] ?? null
}

const physical = (choice: string, labeling: { a: string; b: string }): string =>
  choice === "a" ? labeling.a : choice === "b" ? labeling.b : choice

const optionKey = (answer: Response["answers"][string]): string =>
  answer.type === "choice" ? answer.choice : answer.type === "score" ? String(answer.score) : `noul:${answer.noul}`

export function samplesFromRun(bytes: string, expectedHash: string, root = ROOT) {
  if (sha256(bytes) !== expectedHash) throw new Error("Run digest differs from trusted receipt")
  const run = Schema.decodeUnknownSync(Run)(JSON.parse(bytes))
  const plan = validatePolicyClarityPlan(run.plan)
  if (sha256(canonical(plan)) !== run.planHash) throw new Error("Plan digest mismatch")
  if (run.records.length !== plan.requests.length) throw new Error("Incomplete record inventory")
  const samples: Sample[] = []
  const failures: Array<{ id: string; status: string }> = []
  for (const [index, record] of run.records.entries()) {
    const entry = plan.requests[index]!
    if (entry.id !== record.id) throw new Error("Record identity mismatch")
    if (record.status !== "received" || record.receipt?.status !== 200) {
      failures.push({ id: record.id, status: record.status })
      continue
    }
    const response = validateResponse(entry.request, JSON.parse(record.receipt.raw))
    const preference = response.answers["preference"]!
    const readiness = response.answers["policy_readiness"]!
    const evidence = response.answers["evidence_readiness"]!
    const obligations = response.answers["obligations_preserved"]!
    samples.push({
      id: entry.id,
      caseId: entry.caseId,
      condition: entry.condition,
      order: entry.order,
      repeat: entry.repeat,
      scope: plan.scope,
      labelChoice: optionKey(preference),
      physicalChoice: physical(optionKey(preference), entry.labeling),
      probabilities: preference.type === "choice" ? preference.probabilities : {},
      confidence: preference.type === "noul" ? preference.noul : preference.confidence,
      policyReadiness: optionKey(readiness),
      evidenceReadiness: optionKey(evidence),
      obligationsNoul: obligations.type === "noul" ? obligations.noul : -1,
      elapsedMs: record.receipt.elapsedMs,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model: response.model,
    })
  }
  return { plan, samples, failures }
}

const counts = (values: ReadonlyArray<string>) => {
  const tally: Record<string, number> = {}
  for (const value of values) tally[value] = (tally[value] ?? 0) + 1
  return Object.fromEntries(Object.entries(tally).sort())
}

export function groupSamples(samples: ReadonlyArray<Sample>, root = ROOT) {
  const cases = buildPolicyClarityCases(root)
  const groups = new Map<string, Sample[]>()
  for (const sample of samples) {
    const key = `${sample.caseId}|${sample.condition}`
    const bucket = groups.get(key) ?? []
    bucket.push(sample)
    groups.set(key, bucket)
  }
  return [...groups.entries()].map(([key, bucket]) => {
    const [caseId, condition] = key.split("|") as [PolicyClarityCase["id"], Condition]
    const definition = cases[caseId]
    const margins = bucket.map((sample) => {
      const values = Object.values(sample.probabilities).sort((left, right) => right - left)
      return (values[0] ?? 0) - (values[1] ?? 0)
    })
    return {
      caseId,
      condition,
      samples: bucket.length,
      /** Batch-local sample counts, so a pooled cell can be read correctly. */
      samplesByBatch: counts(bucket.map((sample) => sample.scope)),
      /**
       * Distinct (batch, order, repeat) combinations. The design gives 2 repeats
       * per order per batch, so a single-batch cell holds 4 combinations and a
       * cell pooled from two batches holds 8.
       */
      distinctBatchOrderRepeatCombinations: new Set(
        bucket.map((sample) => `${sample.scope}|${sample.order}|${sample.repeat}`),
      ).size,
      physicalChoices: counts(bucket.map((sample) => sample.physicalChoice)),
      labelChoices: counts(bucket.map((sample) => sample.labelChoice)),
      physicalChoiceByOrder: {
        "0": counts(bucket.filter((sample) => sample.order === 0).map((sample) => sample.physicalChoice)),
        "1": counts(bucket.filter((sample) => sample.order === 1).map((sample) => sample.physicalChoice)),
      },
      meanTopProbability:
        bucket.length === 0 ? null : bucket.reduce((sum, sample) => sum + Math.max(...Object.values(sample.probabilities), 0), 0) / bucket.length,
      meanMargin: bucket.length === 0 ? null : margins.reduce((sum, value) => sum + value, 0) / margins.length,
      meanConfidence: bucket.length === 0 ? null : bucket.reduce((sum, sample) => sum + sample.confidence, 0) / bucket.length,
      policyReadiness: counts(bucket.map((sample) => sample.policyReadiness)),
      evidenceReadiness: counts(bucket.map((sample) => sample.evidenceReadiness)),
      obligationsPreserved: {
        yes: bucket.filter((sample) => sample.obligationsNoul >= 0.5).length,
        no: bucket.filter((sample) => sample.obligationsNoul < 0.5).length,
        meanProbability: bucket.length === 0 ? null : bucket.reduce((sum, sample) => sum + sample.obligationsNoul, 0) / bucket.length,
      },
      expectation: {
        physical: definition.authorExpectation.physical,
        matches: bucket.filter((sample) => sample.physicalChoice === definition.authorExpectation.physical).length,
        deterministicRule: definition.authorExpectation.deterministicRule !== null,
      },
      conflictForcesIncompatibleOutcomes:
        condition === "conflict" ? definition.conflictForcesIncompatibleOutcomes : null,
      distinctPhysicalTopChoices: new Set(bucket.map((sample) => sample.physicalChoice)).size,
      distinctLabelTopChoices: new Set(bucket.map((sample) => sample.labelChoice)).size,
    }
  })
}

export function replay(bytes: string, expectedHash: string, root = ROOT) {
  const { plan, samples, failures } = samplesFromRun(bytes, expectedHash, root)
  const cells = groupSamples(samples, root)
  const latencies = samples.map((sample) => sample.elapsedMs)
  return {
    schema: "pulsar.jev_policy_clarity_summary.v1",
    runHash: expectedHash,
    planHash: sha256(canonical(plan)),
    scope: plan.scope,
    casesHash: plan.casesHash,
    validator: "hundredth-rounding-v1",
    probabilityTolerance: PROBABILITY_TOLERANCE,
    samples: samples.length,
    failures,
    cells,
    modelIds: [...new Set(samples.map((sample) => sample.model))].sort(),
    inputTokens: samples.reduce((sum, sample) => sum + sample.inputTokens, 0),
    outputTokens: samples.reduce((sum, sample) => sum + sample.outputTokens, 0),
    latencyMs: { p50: nearestRank(latencies, 50), p95: nearestRank(latencies, 95), max: nearestRank(latencies, 100) },
    rawSamples: samples,
    trust: "Local research receipt. A separately retained digest detects edits; no producer authentication or production authorization.",
  }
}

export function mergeRuns(paths: ReadonlyArray<string>, root = ROOT) {
  const perRun: Array<{ path: string; sha256: string; scope: Scope; samples: number; failures: number; casesHash: string }> = []
  const samples: Sample[] = []
  for (const path of paths) {
    const bytes = readFileSync(resolve(path), "utf8")
    const digest = sha256(bytes)
    const parsed = samplesFromRun(bytes, digest, root)
    samples.push(...parsed.samples)
    perRun.push({
      path,
      sha256: digest,
      scope: parsed.plan.scope,
      samples: parsed.samples.length,
      failures: parsed.failures.length,
      casesHash: parsed.plan.casesHash,
    })
  }
  const latencies = samples.map((sample) => sample.elapsedMs)
  return {
    schema: "pulsar.jev_policy_clarity_merged.v1",
    runs: perRun,
    samples: samples.length,
    cases: [...new Set(samples.map((sample) => sample.caseId))].sort(),
    modelIds: [...new Set(samples.map((sample) => sample.model))].sort(),
    inputTokens: samples.reduce((sum, sample) => sum + sample.inputTokens, 0),
    outputTokens: samples.reduce((sum, sample) => sum + sample.outputTokens, 0),
    latencyMs: { p50: nearestRank(latencies, 50), p95: nearestRank(latencies, 95), max: nearestRank(latencies, 100) },
    cells: groupSamples(samples, root),
    rawSamples: samples,
  }
}

async function main() {
  const [command, arg, out, approval] = process.argv.slice(2)
  if (command === "prepare" && SCOPE.includes(arg as Scope) && out) {
    const plan = buildPolicyClarityPlan(ROOT, "jev-latest", arg as Scope)
    writeFileSync(out, JSON.stringify(plan, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    console.log(
      `Prepared ${plan.requests.length} requests for scope ${arg}; inspect ${out} before evaluate. plan SHA256 ${sha256(canonical(plan))}`,
    )
  } else if (command === "evaluate" && arg && out && approval === "--allow-egress") {
    const key = process.env.TYPESAFE_API_KEY
    if (!key) throw new Error("TYPESAFE_API_KEY is required only for evaluate")
    const plan = readPlan(arg)
    await Effect.runPromise(evaluatePlan(plan, out).pipe(Effect.provide(jevLayer(key))))
    const bytes = readFileSync(resolve(out, "run.json"), "utf8")
    const summary = replay(bytes, sha256(bytes))
    writeFileSync(resolve(out, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" })
    console.log(`Recorded ${summary.samples} valid samples; run SHA256 ${sha256(bytes)}`)
  } else if (command === "replay" && arg && out) {
    console.log(JSON.stringify(replay(readFileSync(arg, "utf8"), out), null, 2))
  } else if (command === "merge") {
    const rest = process.argv.slice(3)
    const target = rest[0]
    const runs = rest.slice(1)
    if (target === undefined || runs.length === 0) {
      throw new Error("Usage: merge <merged.json> <run.json> [<run.json> ...]")
    }
    const merged = mergeRuns(runs)
    writeFileSync(resolve(target), JSON.stringify(merged, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    console.log(`Merged ${merged.samples} samples from ${runs.length} runs into ${target}`)
  } else if (command === "evidence" && arg) {
    const report = await collectEvidence(ROOT)
    cleanupRepoCopies()
    writeFileSync(resolve(arg), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    console.log(`Wrote independent evidence to ${arg}`)
  } else if (command === "inspect" && arg) {
    const plan = readPlan(arg)
    const sizes = plan.requests.map((entry) => Buffer.byteLength(JSON.stringify(entry.request)))
    console.log(
      JSON.stringify(
        {
          scope: plan.scope,
          requests: plan.requests.length,
          conditions: [...new Set(plan.requests.map((entry) => entry.condition))],
          cases: CASE_ORDER.filter((id) => plan.requests.some((entry) => entry.caseId === id)),
          bytes: { min: Math.min(...sizes), max: Math.max(...sizes) },
          policyForm: Object.fromEntries(
            [...new Set(plan.requests.map((entry) => entry.condition))].map((condition) => [
              condition,
              typeof plan.requests.find((entry) => entry.condition === condition)?.request.state["policy"] === "string"
                ? "prose"
                : Object.keys(plan.requests.find((entry) => entry.condition === condition)?.request.state["policy"] as object).join(","),
            ]),
          ),
        },
        null,
        2,
      ),
    )
  } else {
    throw new Error(
      "Usage: bun scripts/jev-policy-clarity.ts prepare <exploration|frozen|heldout_opposing> <plan.json> | inspect <plan.json> | evaluate <plan.json> <new-run-dir> --allow-egress | replay <run.json> <trusted-sha256> | merge <merged.json> <run.json>... | evidence <evidence.json>",
    )
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Policy-clarity spike failed")
    process.exitCode = 1
  })
}

export type { Sample }
export const policyClarityRequestBytes = (request: Request): number => Buffer.byteLength(JSON.stringify(request))
