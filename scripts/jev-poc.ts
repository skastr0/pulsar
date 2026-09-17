#!/usr/bin/env bun
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"
import { Effect, Result } from "effect"
import { agentInputFingerprint } from "../packages/cli/src/agent-identity.ts"
import { loadAgentPolicy } from "../packages/cli/src/agent-policy.ts"
import { prepareAgentPolicy, runAgentAssessment } from "../packages/cli/src/agent-runtime.ts"
import { runCliEffect } from "../packages/cli/src/cli-effect-runtime.ts"
import { toScoreJson } from "../packages/cli/src/score-json.ts"
import { TsAnalysisLayer, TsAnalysisTag } from "../packages/ts-pack/src/ts-analysis.ts"
import { functionEndLine, functionStartLine, getFunctionLikeEntriesForSourceFile, getFunctionName } from "../packages/ts-pack/src/signals/shared-function-index.ts"
import { collectSemanticCandidates } from "./jev-poc/discovery.ts"
import { decodeReceipt, judgmentMachine, replay, type CallRecord, type Plan, type Run } from "./jev-poc/pipeline.ts"
import { loadSemanticPolicy, SemanticError } from "./jev-poc/policy.ts"
import { QUESTION_VERSION } from "./jev-poc/questions.ts"
import { canonical, sha256 } from "./jev-spike/model.ts"
import { jevLayer, JudgmentProvider } from "./jev-spike/transport.ts"

const persist = (path: string, value: unknown) => Effect.try({
  try: () => writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 }),
  catch: () => new SemanticError({ operation: `Persist exclusive receipt ${path}` }),
})

export const prepareSemanticPlan = Effect.fn("Semantic.prepare")(function* (
  repoPath: string, trusted: boolean, model: string, expectedPolicy?: string,
) {
  const options = { repoPath, trustProjectCode: trusted }
  const structuralPolicy = yield* loadAgentPolicy(options)
  const semantic = yield* loadSemanticPolicy(structuralPolicy.repoRoot, trusted)
  const prepared = yield* prepareAgentPolicy(structuralPolicy, options)
  const implementation = yield* Effect.try({
    try: () => Object.fromEntries(["jev-poc.ts", "jev-poc/policy.ts", "jev-poc/discovery.ts", "jev-poc/questions.ts", "jev-poc/pipeline.ts", "jev-spike/model.ts", "jev-spike/transport.ts"]
      .map((path) => [path, sha256(readFileSync(join(import.meta.dir, path), "utf8"))])),
    catch: () => new SemanticError({ operation: "Fingerprint semantic implementation" }),
  })
  const policyFingerprint = sha256(canonical({ semantic: semantic.fingerprint, structural: prepared.fingerprint, model, questionVersion: QUESTION_VERSION, implementation }))
  if (expectedPolicy !== undefined && expectedPolicy !== policyFingerprint) {
    return yield* Effect.fail(new SemanticError({ operation: "Policy changed; refusing a repair comparison under different rules" }))
  }
  const assessment = yield* runAgentAssessment(structuralPolicy, prepared)
  const output = assessment.observation.result
  const json = toScoreJson(output, structuralPolicy.vectorSelection, structuralPolicy.repoRoot)
  const snapshots = Object.values(json.signal_diagnostics ?? {})
  const extents = yield* Effect.gen(function* () {
    const analysis = yield* TsAnalysisTag
    const files = yield* analysis.mapFiles(async ({ file, sourceFile }) =>
      getFunctionLikeEntriesForSourceFile(sourceFile).map(({ fn }) => ({
        file: file.relativePath, name: getFunctionName(fn), startLine: functionStartLine(fn), endLine: functionEndLine(fn),
      })))
    return files.flat()
  }).pipe(Effect.provide(TsAnalysisLayer(structuralPolicy.repoRoot, { productionOnly: true })))
  const discovery = yield* Effect.try({
    try: () => collectSemanticCandidates(structuralPolicy.repoRoot, [...output.signalResults.values()], {
      ...semantic.policy.budgets, include: semantic.policy.include, exclude: semantic.policy.exclude,
    }, {
      extents: { resolveFunctionExtent: (file, name, line) => {
        const atLine = extents.filter((e) => e.file === file && e.startLine === line)
        const named = atLine.filter((e) => e.name === name)
        // Calibration can rename callbacks; a unique parser node at the exact line is still grounded.
        return named.length === 1 ? named[0]! : atLine.length === 1 ? atLine[0]! : null
      } },
    }),
    catch: () => new SemanticError({ operation: "Discover bounded source evidence" }),
  })
  const selections = yield* Effect.try({
    try: () => Object.fromEntries(discovery.candidates.map((candidate) => [candidate.id, semantic.selectRules(candidate).map((rule) => rule.id)])),
    catch: () => new SemanticError({ operation: "Run deterministic repository rule selector" }),
  })
  const plan: Plan = {
    schema: "pulsar.semantic-plan.v1alpha1", questionVersion: QUESTION_VERSION, model,
    inputFingerprint: assessment.inputFingerprint, policyFingerprint, policy: semantic.policy,
    structural: {
      score: (output.readiness?.score ?? output.weighted_mean) * 100,
      complete: snapshots.some((s) => s.applicability === "applicable") && !snapshots.some((s) => s.applicability === "failed" || s.applicability === "insufficient_evidence"),
      hardGateCount: output.hard_gate_violations.length,
    }, discovery, selections,
  }
  return { plan, verifySource: semantic.verifySource }
})

export const executeSemanticPlan = Effect.fn("Semantic.execute")(function* (plan: Plan, directory: string) {
  const provider = yield* JudgmentProvider
  const machine = judgmentMachine(plan)
  const records: CallRecord[] = []
  let next = machine.next()
  while (!next.done) {
    const step = next.value
    const requestHash = sha256(JSON.stringify(step.request))
    const prefix = join(directory, String(records.length).padStart(4, "0"))
    yield* persist(`${prefix}.intent.json`, { ...step, requestHash })
    const result = yield* Effect.result(provider.evaluate(step.request))
    const record: CallRecord = { ...step, requestHash,
      receipt: Result.isSuccess(result) ? result.success : null,
      failure: Result.isFailure(result) ? "network_or_timeout" : null,
    }
    yield* persist(`${prefix}.receipt.json`, record)
    records.push(record)
    next = machine.next(decodeReceipt(record))
  }
  const run: Run = { plan, records, summary: next.value }
  yield* persist(join(directory, "run.json"), run)
  return run
})

async function main() {
  const { positionals, values } = parseArgs({ args: process.argv.slice(2), allowPositionals: true, strict: true, options: {
    "trust-project-code": { type: "boolean", default: false },
    "expect-policy": { type: "string" }, model: { type: "string", default: "jev-latest" },
  } })
  const [command = "plan", target = ".", digest] = positionals
  if (command === "replay") {
    const bytes = readFileSync(resolve(target), "utf8")
    if (!digest || sha256(bytes) !== digest) throw new Error("Run digest required and must match")
    const summary = replay(JSON.parse(bytes) as Run)
    console.log(JSON.stringify({ status: "replayed", summary }, null, 2))
    return
  }
  if (command !== "plan" && command !== "run") throw new Error("Usage: bun run dev semantic <plan|run> [repo] --trust-project-code [--expect-policy HASH]; semantic replay <run.json> <SHA256>")
  if (command === "run" && !process.env.TYPESAFE_API_KEY) throw new Error("TYPESAFE_API_KEY required; use plan for zero-egress discovery")
  const { plan, verifySource } = await runCliEffect(prepareSemanticPlan(target, values["trust-project-code"], values.model, values["expect-policy"]))
  const directory = join(plan.discovery.repoRoot, ".pulsar", "semantic-runs", `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  await runCliEffect(persist(join(directory, "plan.json"), plan))
  if (command === "plan") {
    console.log(JSON.stringify({ status: "planned", directory, policyFingerprint: plan.policyFingerprint, coverage: plan.discovery.coverage, candidates: plan.discovery.candidates.map((c) => ({ id: c.id, kind: c.kind, primary: c.primary.file, line: c.primary.startLine, rules: plan.selections[c.id] })) }, null, 2))
    return
  }
  if (!verifySource() || await runCliEffect(agentInputFingerprint(plan.discovery.repoRoot)) !== plan.inputFingerprint) throw new Error("Inputs changed before inference")
  const run = await runCliEffect(executeSemanticPlan(plan, directory).pipe(Effect.provide(jevLayer(process.env.TYPESAFE_API_KEY!))))
  if (!verifySource() || await runCliEffect(agentInputFingerprint(plan.discovery.repoRoot)) !== plan.inputFingerprint) throw new Error(`Inputs changed during inference; receipts retained at ${directory}, no current score issued`)
  const runPath = join(directory, "run.json")
  const runHash = sha256(readFileSync(runPath, "utf8"))
  replay(run)
  const responses = run.records.flatMap((record) => {
    const response = decodeReceipt(record)
    return response ? [response] : []
  })
  console.log(JSON.stringify({ status: "completed", runPath, runHash, policyFingerprint: plan.policyFingerprint, ...run.summary,
    coverage: plan.discovery.coverage,
    provider: {
      attempted: run.records.length, validated: responses.length,
      models: [...new Set(responses.map((r) => r.model))],
      inputTokens: responses.reduce((n, r) => n + r.usage.input_tokens, 0),
      outputTokens: responses.reduce((n, r) => n + r.usage.output_tokens, 0),
    },
    pointers: run.summary.findings.map((finding) => ({ ...finding, members: plan.discovery.candidates.find((c) => c.id === finding.candidateId)!.members.map(({ file, startLine, endLine, fileSha256 }) => ({ file, startLine, endLine, fileSha256 })) })),
  }, null, 2))
  process.exitCode = run.summary.health.color === "green" ? 0 : run.summary.health.color === "red" ? 2 : 3
}

if (import.meta.main) main().catch((cause) => {
  console.error(cause instanceof SemanticError ? cause.operation : cause instanceof Error ? cause.message : "Semantic run failed")
  process.exitCode = 1
})
