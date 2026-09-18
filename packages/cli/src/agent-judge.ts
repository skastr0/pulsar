import { randomUUID } from "node:crypto"
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises"
import { isAbsolute, join, relative } from "node:path"
import { Effect } from "effect"
import {
  AI_FACT_ARTIFACT_SCHEMA_VERSION,
  CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH,
  CANONICAL_OWNERSHIP_ASSESSMENT_RELATIVE_PATH,
  OWNERSHIP_LABEL_KIND,
  OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION,
  computeOwnershipPolicyFingerprint,
  computeOwnershipRubricFingerprint,
  computeOwnershipContentHash,
  computeOwnershipInputFingerprint,
  decodeOwnershipPolicySync,
  decodeOwnershipLabelValueSync,
  decodeOwnershipAssessmentArtifactSync,
  ownershipGroupPaths,
  loadOwnershipFacts,
  type AiFactLabelArtifact,
  type OwnershipPolicy,
} from "@skastr0/pulsar-core/reference-data"
import { AgentCommandError } from "./agent-contract.js"
import { readSemanticSource } from "./semantic-discovery.js"
import {
  JEV_OWNERSHIP_MODEL,
  JEV_OWNERSHIP_PROMPT_ID,
  compileOwnershipRequestSync,
  evaluateOwnershipGroup,
  type OwnershipGroupEvaluationInput,
  type OwnershipGroupAssessment,
} from "./jev/index.js"

export const OWNERSHIP_CLASSIFIER_ID = "pulsar.jev.ownership"
export const OWNERSHIP_CLASSIFIER_VERSION = "2"
// Explicit egress limits, not a guessed tokenizer. Oversized requests are rejected,
// never clipped into apparently complete evidence. Provider token limits still apply.
const MAX_SOURCE_BYTES = 128_000
const MAX_REQUEST_BYTES = 120_000

export interface OwnershipJudgmentPlan {
  readonly repoRoot: string
  readonly policy: OwnershipPolicy
  readonly policyFingerprint: string
  readonly sourceHashes: Readonly<Record<string, string>>
  readonly inputs: ReadonlyArray<OwnershipGroupEvaluationInput>
}

const contained = (root: string, path: string): boolean => {
  const rel = relative(root, path)
  return rel !== ".." && !rel.startsWith("../") && !isAbsolute(rel)
}

export const prepareOwnershipJudgment = (repoRoot: string): Effect.Effect<OwnershipJudgmentPlan, AgentCommandError> => Effect.tryPromise({
  try: async () => {
    const root = await realpath(repoRoot)
    const policyPath = await realpath(join(root, CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH))
    if (!contained(root, policyPath)) throw new Error("Policy path escapes repository")
    const bytes = await readFile(policyPath)
    const policy = decodeOwnershipPolicySync(JSON.parse(bytes.toString("utf8")))
    if (!policy.allowed_classifiers.some((allowed) => allowed.id === OWNERSHIP_CLASSIFIER_ID && allowed.model_id === JEV_OWNERSHIP_MODEL && (allowed.version === undefined || allowed.version === OWNERSHIP_CLASSIFIER_VERSION) && (allowed.prompt_id === undefined || allowed.prompt_id === JEV_OWNERSHIP_PROMPT_ID))) {
      throw new Error("Current Jev evaluator is not authorized by ownership policy")
    }
    const snapshots = new Map<string, string>()
    const sourceHashes: Record<string, string> = {}
    for (const path of [...new Set(policy.groups.flatMap(ownershipGroupPaths))].sort()) {
      const source = readSemanticSource(root, path, { maxSourceFileBytes: MAX_SOURCE_BYTES })
      if (!source.ok) throw new Error(`Cannot send ${path}: ${source.reason}`)
      snapshots.set(path, source.text)
      sourceHashes[path] = `sha256:${source.fileSha256}`
    }
    const inputs: OwnershipGroupEvaluationInput[] = policy.groups.map((group) => ({
      groupId: group.id,
      model: JEV_OWNERSHIP_MODEL,
      sources: ownershipGroupPaths(group).map((path) => ({
        path, bytes: snapshots.get(path)!,
        role: group.owner_paths.includes(path) ? "owner" : group.caller_paths.includes(path) ? "caller" : "context",
      })),
      rubric: {
        preference: policy.preference,
        preferenceDescription: policy.preference === "shared_domain_rule"
          ? "Shared domain rules should have one implementation. Similar syntax implementing different rules is not itself a violation. Use the repository's explicit anchor descriptions."
          : "Callers should own their domain rules locally. Sharing is not inherently preferable. Use the repository's explicit anchor descriptions.",
        anchors: policy.anchors,
        ...(policy.stretch === undefined ? {} : { stretchRequirement: policy.stretch.requirement }),
      },
    }))
    for (const input of inputs) {
      if (Buffer.byteLength(compileOwnershipRequestSync(input).requestBody) > MAX_REQUEST_BYTES) {
        throw new Error(`Ownership group ${input.groupId} exceeds ${MAX_REQUEST_BYTES} request bytes; narrow the explicit inventory/context, not a hidden snippet cap`)
      }
    }
    return { repoRoot: root, policy, policyFingerprint: computeOwnershipPolicyFingerprint(bytes), sourceHashes, inputs }
  },
  catch: (cause) => new AgentCommandError(
    "OWNERSHIP_PLAN_FAILED",
    "Ownership policy or evidence could not be prepared; no model calls were made.",
    [{ path: CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH, message: cause instanceof Error && !cause.message.includes("JSON") ? cause.message.slice(0, 400) : "Invalid ownership policy or source evidence" }],
    ["Configure .pulsar/ownership.json with an authorized evaluator, repo rubric and explicit source/context paths. Use agent discover to propose candidates."],
  ),
})

export const ownershipJudgmentPreview = (plan: OwnershipJudgmentPlan) => ({
  policy_fingerprint: plan.policyFingerprint,
  scope: "declared-ownership-inventory",
  model: JEV_OWNERSHIP_MODEL,
  classifier: { id: OWNERSHIP_CLASSIFIER_ID, version: OWNERSHIP_CLASSIFIER_VERSION, prompt_id: JEV_OWNERSHIP_PROMPT_ID },
  groups: plan.inputs.map((input) => ({
    id: input.groupId,
    paths: input.sources.map((source) => source.path),
    source_bytes: input.sources.reduce((total, source) => total + Buffer.byteLength(source.bytes), 0),
    request_bytes: Buffer.byteLength(compileOwnershipRequestSync(input).requestBody),
  })),
  calls_planned: plan.inputs.length,
  sends_source: true,
  limits: { max_source_bytes: MAX_SOURCE_BYTES, max_request_bytes: MAX_REQUEST_BYTES, concurrency: 4 },
})

const toArtifact = (plan: OwnershipJudgmentPlan, assessment: OwnershipGroupAssessment, createdAt: string): AiFactLabelArtifact => {
  const group = plan.policy.groups.find((candidate) => candidate.id === assessment.groupId)!
  const paths = ownershipGroupPaths(group)
  const hashes = Object.fromEntries(paths.map((path) => [path, plan.sourceHashes[path]!]))
  const anchor = plan.policy.anchors.find((entry) => entry.id === assessment.selectedAnchorId)
  const artifactId = `${OWNERSHIP_CLASSIFIER_ID}:${computeOwnershipInputFingerprint(plan.policyFingerprint, group.id, hashes)}:${assessment.requestSha256}`
  const label = decodeOwnershipLabelValueSync({
    schema_version: OWNERSHIP_LABEL_VALUE_SCHEMA_VERSION,
    group_id: group.id,
    policy_fingerprint: plan.policyFingerprint,
    rubric_fingerprint: computeOwnershipRubricFingerprint(plan.policy),
    status: assessment.status,
    ...(assessment.status !== "resolved" || anchor === undefined ? {} : { anchor_id: anchor.id, anchor_value: anchor.value }),
    distribution: assessment.distribution.map((entry) => {
      const named = plan.policy.anchors.find((candidate) => candidate.id === entry.anchorId)
      return {
        anchor_id: entry.anchorId, probability: entry.probability, selected: entry.selected,
        ...(named === undefined ? {} : { anchor_value: named.value }),
      }
    }),
    receipt: { artifact_id: artifactId, classifier_id: OWNERSHIP_CLASSIFIER_ID, model_id: assessment.modelId, prompt_id: assessment.promptId, prompt_fingerprint: assessment.promptFingerprint },
  })
  return {
    schema_version: AI_FACT_ARTIFACT_SCHEMA_VERSION,
    artifact_id: artifactId,
    classifier: { id: OWNERSHIP_CLASSIFIER_ID, version: OWNERSHIP_CLASSIFIER_VERSION, model_provider: "TypeSafe", model_id: assessment.modelId, prompt_id: assessment.promptId, prompt_fingerprint: assessment.promptFingerprint },
    input: { scope: "module", content_hash: computeOwnershipContentHash(hashes), input_fingerprint: computeOwnershipInputFingerprint(plan.policyFingerprint, group.id, hashes), source_paths: paths },
    label: {
      kind: OWNERSHIP_LABEL_KIND, value: label, confidence: assessment.modelConfidence,
      rationale: `Jev selected ${assessment.rawSelectedAnchorId}; selection gate ${assessment.selectionGate.passed ? "passed" : "abstained"}. This is an estimate against the declared repo rubric.`,
      evidence: paths.map((path) => ({ path, quote_hash: hashes[path]! })),
    },
    policy: { enforcement_ceiling: "soft-warning", missing_label_behavior: "soft-warn", stale_after_days: 7 },
    provenance: { mode: "model-run", source: "repo-artifact", created_at: createdAt, created_by: OWNERSHIP_CLASSIFIER_ID },
  }
}

const io = <A>(operation: string, run: () => Promise<A>) => Effect.tryPromise({
  try: run,
  catch: () => new AgentCommandError("OWNERSHIP_IO_FAILED", operation),
})

/** Explicit refresh: exact intents before egress, bounded calls, receipts before adoption. */
export const executeOwnershipJudgment = Effect.fn("Agent.judge")(function* (plan: OwnershipJudgmentPlan) {
  const runId = randomUUID()
  const relativeRun = `.pulsar/ownership-runs/${runId}`
  const directory = join(plan.repoRoot, relativeRun)
  yield* io("Cannot create confined ownership receipt directory", async () => {
    const parent = await realpath(join(plan.repoRoot, ".pulsar"))
    if (!contained(plan.repoRoot, parent)) throw new Error("Unsafe policy directory")
    const runs = join(parent, "ownership-runs")
    await mkdir(runs, { recursive: true, mode: 0o700 })
    if (!contained(plan.repoRoot, await realpath(runs))) throw new Error("Unsafe receipt directory")
    await mkdir(directory, { mode: 0o700 })
  })
  const results = yield* Effect.forEach(plan.inputs, (input, index) => Effect.gen(function* () {
    const compiled = compileOwnershipRequestSync(input)
    const prefix = join(directory, String(index).padStart(5, "0"))
    yield* io("Cannot save ownership request intent", () => writeFile(`${prefix}.request.json`, compiled.requestBody, { flag: "wx", mode: 0o600 }))
    const result = yield* Effect.result(evaluateOwnershipGroup(input))
    if (result._tag === "Failure") {
      const failure = { group_id: input.groupId, request_sha256: compiled.requestSha256, error: result.failure._tag }
      yield* io("Cannot save ownership failure receipt", () => writeFile(`${prefix}.failure.json`, JSON.stringify(failure), { flag: "wx", mode: 0o600 }))
      return { failure }
    }
    yield* io("Cannot save ownership response receipt", () => writeFile(`${prefix}.response.json`, JSON.stringify(result.success), { flag: "wx", mode: 0o600 }))
    return { assessment: result.success }
  }), { concurrency: 4 })

  const fresh = yield* prepareOwnershipJudgment(plan.repoRoot)
  if (fresh.policyFingerprint !== plan.policyFingerprint || JSON.stringify(fresh.sourceHashes) !== JSON.stringify(plan.sourceHashes)) {
    return yield* Effect.fail(new AgentCommandError("OWNERSHIP_INPUT_CHANGED", "Policy or source changed during inference; receipts retained, assessment not adopted.", [], [relativeRun]))
  }
  const createdAt = new Date().toISOString()
  const assessments = results.flatMap((result) => result.assessment === undefined ? [] : [result.assessment])
  const artifact = yield* Effect.try({
    try: () => decodeOwnershipAssessmentArtifactSync({
      schema_version: 1, policy_path: CANONICAL_OWNERSHIP_POLICY_RELATIVE_PATH,
      policy_fingerprint: plan.policyFingerprint, created_at: createdAt,
      labels: assessments.map((assessment) => toArtifact(plan, assessment, createdAt)),
    }),
    catch: () => new AgentCommandError("OWNERSHIP_ARTIFACT_INVALID", "Model output could not form a valid ownership assessment; receipts retained."),
  })
  yield* io("Cannot atomically adopt ownership assessment", async () => {
    const staged = join(directory, "assessment.json")
    await writeFile(staged, JSON.stringify(artifact, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    await rename(staged, join(plan.repoRoot, CANONICAL_OWNERSHIP_ASSESSMENT_RELATIVE_PATH))
  })
  const facts = yield* io("Cannot validate adopted ownership assessment", () => loadOwnershipFacts(plan.repoRoot))
  return {
    ...ownershipJudgmentPreview(plan),
    dry_run: false,
    calls_completed: assessments.length,
    failures: results.flatMap((result) => result.failure === undefined ? [] : [result.failure]),
    receipts: relativeRun,
    assessment_path: CANONICAL_OWNERSHIP_ASSESSMENT_RELATIVE_PATH,
    aggregate: facts.aggregate ?? null,
    applicability: facts.aggregate?.applicability ?? "insufficient_evidence",
    validation_findings: facts.findings,
    usage: assessments.reduce((total, assessment) => ({ input_tokens: total.input_tokens + assessment.usage.inputTokens, output_tokens: total.output_tokens + assessment.usage.outputTokens }), { input_tokens: 0, output_tokens: 0 }),
  }
})
