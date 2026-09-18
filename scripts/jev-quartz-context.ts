#!/usr/bin/env bun
/** Matched context experiment. No production policy or scoring semantics are changed. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { Effect, Result, Schema } from "effect"
import { canonical, Request, sha256 } from "./jev-spike/model.ts"
import { jevLayer, JudgmentProvider } from "./jev-spike/transport.ts"
import { decodeReceipt, judgmentMachine, replay, type CallRecord, type Plan, type Run, type Summary } from "./jev-poc/pipeline.ts"
import { quartzContext, type QuartzContext } from "./jev-poc/quartz-context.ts"
import { SemanticError } from "./jev-poc/policy.ts"

type Arm = "file-windows" | "quartz-neighborhood"
export interface ContextExperiment {
  readonly version: "jev-context-experiment-v1"
  readonly baselineHash: string
  readonly plan: Plan
  readonly context: QuartzContext
  readonly implementation: Readonly<Record<string, string>>
  readonly order: ReadonlyArray<Arm>
}
interface Trial { readonly arm: Arm; readonly records: ReadonlyArray<CallRecord>; readonly diagnosticSummary: Summary }
const implementationPaths = ["jev-quartz-context.ts", "jev-poc/quartz-context.ts", "jev-poc/questions.ts", "jev-poc/pipeline.ts", "jev-spike/model.ts", "jev-spike/transport.ts"]
const implementation = () => Object.fromEntries(implementationPaths.map(path => [path, sha256(readFileSync(join(import.meta.dir, path), "utf8"))]))
const persist = (path: string, data: unknown) => Effect.try({
  try: () => writeFileSync(path, JSON.stringify(data, null, 2) + "\n", { flag: "wx", mode: 0o600 }),
  catch: () => new SemanticError({ operation: `Write exclusive experiment artifact: ${path}` }),
})

export function contextRequest(request: Request, arm: Arm, context: QuartzContext): Request {
  if (arm === "file-windows") return request
  const evidence = Schema.decodeUnknownSync(Schema.JsonObject)(request.state.evidence)
  const modules = new Map<string, { files: number; functions: number }>()
  for (const file of context.inventory) {
    const directory = dirname(file.file)
    const total = modules.get(directory) ?? { files: 0, functions: 0 }
    total.files++
    total.functions += file.functions
    modules.set(directory, total)
  }
  const ids = new Map(context.declarations.map((declaration, index) => [declaration.id, index]))
  const id = (key: string) => {
    const value = ids.get(key)
    if (value === undefined) throw new Error("Dangling compiler graph edge")
    return value
  }
  // Same bodies, facts, questions, policy and prior judgments. Replace location-based context only.
  return Schema.decodeUnknownSync(Request)({ ...request, state: { ...request.state,
    evidence: { ...evidence, context: [], limitations: Array.isArray(evidence.limitations) ? evidence.limitations.filter(entry => typeof entry !== "string" || !entry.startsWith("context_")) : [] },
    compiler_context: {
      version: context.version, scope: context.scope, complete: context.complete, limitations: context.limitations,
      inventory: Object.fromEntries(modules), roots: context.roots.map(id),
      declarations: context.declarations.map(d => ({ id: id(d.id), location: `${d.file}:${d.startLine}-${d.endLine}`, name: d.name, kind: d.kind, source: d.source })),
      edgeLocation: "line is in the from declaration's file unless file is explicitly supplied",
      edges: context.edges.map(e => ({ from: id(e.from), to: id(e.to), kind: e.kind, line: e.line, ...(context.declarations[id(e.from)]!.file === e.file ? {} : { file: e.file }) })),
      externalContracts: context.externalContracts,
    },
  } })
}

export function replayContextTrial(experiment: ContextExperiment, trial: Trial): Summary {
  const machine = judgmentMachine(experiment.plan)
  let next = machine.next()
  for (const record of trial.records) {
    if (next.done) throw new Error("Extra context receipt")
    const expected = { ...next.value, request: contextRequest(next.value.request, trial.arm, experiment.context) }
    if (canonical(expected) !== canonical({ candidateId: record.candidateId, stage: record.stage, ruleId: record.ruleId, request: record.request }) || record.requestHash !== sha256(JSON.stringify(record.request))) throw new Error("Context request integrity mismatch")
    next = machine.next(decodeReceipt(record))
  }
  if (!next.done || canonical(next.value) !== canonical(trial.diagnosticSummary)) throw new Error("Incomplete or altered context result")
  return next.value
}

/** Incomplete compiler coverage cannot acquire authority from the model's readiness answer. */
export const contextConsumption = (complete: boolean, finding: Summary["findings"][number]) =>
  complete ? finding : { ...finding, verdict: "unknown" as const, direction: null, reason: "context_coverage_incomplete" }

const trialEffect = Effect.fn("Semantic.contextTrial")(function* (experiment: ContextExperiment, arm: Arm, directory: string) {
  const provider = yield* JudgmentProvider
  const machine = judgmentMachine(experiment.plan)
  const records: CallRecord[] = []
  let next = machine.next()
  while (!next.done) {
    const step = { ...next.value, request: contextRequest(next.value.request, arm, experiment.context) }
    // A conservative byte guard, not a claim to implement the vendor's unpublished tokenizer.
    if (Buffer.byteLength(JSON.stringify(step.request)) > 100_000) throw new Error("Request exceeds experiment byte budget")
    const prefix = join(directory, String(records.length).padStart(2, "0"))
    const requestHash = sha256(JSON.stringify(step.request))
    yield* persist(`${prefix}.intent.json`, { ...step, requestHash })
    const result = yield* Effect.result(provider.evaluate(step.request))
    const record: CallRecord = { ...step, requestHash, receipt: Result.isSuccess(result) ? result.success : null, failure: Result.isFailure(result) ? "network_or_timeout" : null }
    yield* persist(`${prefix}.receipt.json`, record)
    records.push(record)
    next = machine.next(decodeReceipt(record))
  }
  const trial: Trial = { arm, records, diagnosticSummary: next.value }
  replayContextTrial(experiment, trial)
  yield* persist(join(directory, "trial.json"), trial)
  return trial
})

function readHashed(path: string, hash: string): string {
  const text = readFileSync(path, "utf8")
  if (sha256(text) !== hash) throw new Error("Artifact SHA256 mismatch")
  return text
}

async function main() {
  const [command, path, hash, candidateId, repo = "."] = process.argv.slice(2)
  if (!path || !hash) throw new Error("Usage: bun scripts/jev-quartz-context.ts plan <baseline-run.json> <sha256> <candidateId> [repo] | run <experiment.json> <sha256> | replay <result.json> <sha256>")
  if (command === "plan") {
    const baseline = JSON.parse(readHashed(path, hash)) as Run
    replay(baseline)
    const candidate = baseline.plan.discovery.candidates.find(c => c.id === candidateId)
    if (!candidate) throw new Error("Candidate absent from baseline")
    const context = await Effect.runPromise(quartzContext(resolve(repo), candidate.members))
    if (context.roots.length !== candidate.members.length || !context.declarations.length) throw new Error(`Context incomplete at roots or byte cap: ${context.limitations.join("; ")}`)
    const plan: Plan = { ...baseline.plan, discovery: { ...baseline.plan.discovery, candidates: [candidate] } }
    const experiment: ContextExperiment = { version: "jev-context-experiment-v1", baselineHash: hash, plan, context, implementation: implementation(), order: ["file-windows", "quartz-neighborhood", "quartz-neighborhood", "file-windows"] }
    const directory = join(resolve(repo), ".pulsar", "context-experiments", `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, "experiment.json")
    await Effect.runPromise(persist(file, experiment))
    console.log(JSON.stringify({ file, hash: sha256(readFileSync(file, "utf8")), roots: context.roots.length, declarations: context.declarations.length, edges: context.edges.length, limitations: context.limitations }, null, 2))
  } else if (command === "run") {
    const experiment = JSON.parse(readHashed(path, hash)) as ContextExperiment
    if (experiment.version !== "jev-context-experiment-v1" || canonical(experiment.implementation) !== canonical(implementation())) throw new Error("Experiment implementation changed")
    if (!process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY required")
    const directory = join(dirname(resolve(path)), `run-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
    mkdirSync(directory, { mode: 0o700 })
    await Effect.runPromise(persist(join(directory, "experiment.json"), experiment))
    const trials: Trial[] = []
    for (const [index, arm] of experiment.order.entries()) {
      const trialDirectory = join(directory, String(index))
      mkdirSync(trialDirectory, { mode: 0o700 })
      trials.push(await Effect.runPromise(trialEffect(experiment, arm, trialDirectory).pipe(Effect.provide(jevLayer(process.env.TYPESAFE_API_KEY)))))
    }
    const result = { experiment, trials, consumption: trials.map(t => ({ arm: t.arm, findings: t.diagnosticSummary.findings.map(f => contextConsumption(t.arm === "quartz-neighborhood" ? experiment.context.complete : false, f)) })), note: "Diagnostic comparison only. No authoritative score or refactor instruction. Historical context arm is also incomplete. No retries; ABBA order." }
    const file = join(directory, "result.json")
    await Effect.runPromise(persist(file, result))
    console.log(JSON.stringify({ file, hash: sha256(readFileSync(file, "utf8")), trials: trials.map(t => ({ arm: t.arm, calls: t.records.length, findings: t.diagnosticSummary.findings, answers: t.records.map(r => ({ stage: r.stage, response: decodeReceipt(r) })) })) }, null, 2))
  } else if (command === "replay") {
    const result = JSON.parse(readHashed(path, hash)) as { experiment: ContextExperiment; trials: Trial[] }
    for (const trial of result.trials) replayContextTrial(result.experiment, trial)
    console.log(JSON.stringify({ status: "replayed", trials: result.trials.length }))
  } else throw new Error("Unknown experiment command")
}

if (import.meta.main) main().catch(error => { console.error(error instanceof SemanticError ? error.operation : error instanceof Error ? error.message : "Experiment failed"); process.exitCode = 1 })
