import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Schema } from "effect"
import { canonical, Request, sha256 } from "./model.ts"
import {
  CASE_ORDER,
  buildPolicyClarityCases,
  type PolicyClarityCase,
  type PolicyText,
} from "./policy-clarity-cases.ts"

/**
 * Policy-clarity experiment: does operationalizing a repository policy change
 * the architectural judgment a provider returns, compared with the initial
 * underspecified wording of the same policy?
 *
 * Design notes that matter for reading the results:
 *
 * - The treatment is a bundle: the same manipulation is applied to the policy
 *   text and to the preference question's instructions and option descriptions.
 *   `prec_policy_only` isolates the policy half at constant question wording.
 * - `amb_prose` and `amb_struct` carry identical semantic content, as do
 *   `prec_prose` and `prec_struct`. The prose/structured pair is therefore a
 *   format control at constant substance, and substance is varied at constant
 *   format.
 * - Candidate order is counterbalanced by swapping which physical variant is
 *   labelled `a`; the physical mapping is recorded per request.
 * - Every request is a separate call. Repeats are separate requests so that
 *   fresh-inference variation is visible instead of averaged away.
 * - Independent evidence and author-proposed expectations never enter provider
 *   input; they live in the case definitions and the evidence report.
 */

export const MODE = "policy-clarity"
export const MAX_REQUESTS = 128
export const MAX_REQUEST_BYTES = 100_000

export type Condition =
  | "amb_prose"
  | "amb_struct"
  | "prec_prose"
  | "prec_struct"
  | "prec_policy_only"
  | "opposing"
  | "opposing_single_callsite"
  | "no_policy"
  | "conflict"

export const ALL_CONDITIONS: ReadonlyArray<Condition> = [
  "amb_prose",
  "amb_struct",
  "prec_prose",
  "prec_struct",
  "prec_policy_only",
  "opposing",
  "opposing_single_callsite",
  "no_policy",
  "conflict",
]

/** Conditions measured for each case. */
export const CASE_CONDITIONS: Record<PolicyClarityCase["id"], ReadonlyArray<Condition>> = {
  "observer-batch-protocol": ALL_CONDITIONS.filter((condition) => condition !== "opposing_single_callsite"),
  "cache-lookup-representation": ALL_CONDITIONS.filter(
    (condition) => condition !== "opposing" && condition !== "opposing_single_callsite",
  ),
  "factor-policy-boundary": ALL_CONDITIONS,
}

export const SCOPE = ["exploration", "frozen", "heldout_opposing"] as const
export type Scope = (typeof SCOPE)[number]

const SCOPE_CONDITIONS: Record<Scope, ReadonlyArray<Condition>> = {
  exploration: ["amb_prose", "prec_prose"],
  frozen: ALL_CONDITIONS,
  heldout_opposing: ["opposing_single_callsite"],
}

const SCOPE_ROLE: Record<Scope, "development" | "held_out" | "any"> = {
  exploration: "development",
  frozen: "any",
  heldout_opposing: "held_out",
}

export const ORDERS = [0, 1] as const
const REPEATS_BY_SCOPE: Record<Scope, number> = { exploration: 2, frozen: 2, heldout_opposing: 4 }

const INDEPENDENCE =
  "Answer this question independently. Other questions' answers are not context. Describe code properties without importing an architectural preference unless this question explicitly asks for policy-scoped preference."

const AMBIGUOUS_PREFERENCE_INSTRUCTIONS = {
  question:
    "Compare `variants.a` and `variants.b` only under the declared repository policy. Treat the supplied behavior obligations as minimum requirements. Do not infer a preferred architecture when applicable policy is absent.",
  inspect: null,
  focus: null,
  precedence: null,
  independence: INDEPENDENCE,
} as const

const precisePreferenceInstructions = (definition: PolicyClarityCase) => ({
  question: "Compare `variants.a` and `variants.b` only under the declared repository policy.",
  inspect: "`variants.a`, `variants.b`, `obligations`, and the supplied source excerpts.",
  focus: definition.policies.precise.focus,
  precedence:
    "Treat the declared behavior obligations as minimums, not compensating benefits. Apply the policy's own test before stating a preference. Do not choose when applicable policy is absent or self-contradictory.",
  independence: INDEPENDENCE,
})

// Option boundaries. The ambiguous wording keeps the terse labels of the
// original experiment; the precise wording sharpens each boundary and adds a
// `not_for` field without naming this case's variants.
const AMBIGUOUS_OPTIONS: Record<string, string> = {
  a: "Alternative a better fits the declared policy and meets its minimum obligations.",
  b: "Alternative b better fits the declared policy and meets its minimum obligations.",
  equivalent: "The variants meet the minimum and are materially equivalent under the declared policy.",
  incomparable: "The declared policy leaves an unresolved tradeoff between otherwise eligible variants.",
  neither_meets_minimum: "Neither variant meets the declared minimum obligations.",
  insufficient_evidence: "Applicable policy or evidence does not support preference.",
}

const PRECISE_OPTIONS: Record<string, { what: string; not_for: string }> = {
  a: {
    what: "Alternative a better fits the declared policy and meets every declared minimum obligation.",
    not_for: "Use when the policy's own test selects b, or when the policy does not distinguish the variants.",
  },
  b: {
    what: "Alternative b better fits the declared policy and meets every declared minimum obligation.",
    not_for: "Use when the policy's own test selects a, or when the policy does not distinguish the variants.",
  },
  equivalent: {
    what: "Both variants meet every declared minimum and the policy's own test selects neither, so the declared policy does not distinguish them.",
    not_for: "Use when the policy's rules conflict or when the facts the policy needs are not supplied.",
  },
  incomparable: {
    what: "The declared policy's own rules select different variants, or leave a tradeoff the policy does not rank.",
    not_for: "Use when a single applicable rule clearly selects one variant.",
  },
  neither_meets_minimum: {
    what: "At least one declared minimum obligation fails in both variants.",
    not_for: "Use for a policy disagreement that leaves the declared obligations intact.",
  },
  insufficient_evidence: {
    what: "Applicable policy is absent, or the supplied source cannot establish the facts the policy needs.",
    not_for: "Use when an applicable policy is present and the facts it needs are supplied.",
  },
}

const READINESS_OPTIONS: Record<string, string> = {
  sufficient: "The supplied source supports assessing the descriptive properties.",
  missing_evidence: "Relevant source is missing or unresolved.",
  conflicting_evidence: "Relevant source conflicts prevent assessment.",
}

const POLICY_READINESS_OPTIONS: Record<string, string> = {
  defined: "An explicit applicable preference criterion is supplied and it selects between these variants.",
  missing: "No applicable normative preference criterion is supplied.",
  ambiguous: "The supplied preference permits unresolved materially different interpretations.",
  conflicting: "Supplied preference rules conflict without precedence.",
}

const READINESS_OPTIONS_PRECISE: Record<string, { what: string; not_for: string }> = {
  sufficient: {
    what: "The supplied source contains the code the descriptive questions need.",
    not_for: "Use when a needed file, symbol, or call path is absent from the packet.",
  },
  missing_evidence: {
    what: "Relevant source is missing or unresolved.",
    not_for: "Use when the source is present but two supplied facts disagree.",
  },
  conflicting_evidence: {
    what: "Two supplied facts about the same property disagree and cannot both hold.",
    not_for: "Use when the source is merely incomplete.",
  },
}

const POLICY_READINESS_OPTIONS_PRECISE: Record<string, { what: string; not_for: string }> = {
  defined: {
    what: "One explicit applicable preference criterion is supplied, it states a direction, and no supplied rule contradicts it.",
    not_for: "Use when the criterion states only a goal with no test for applying it, or when two supplied rules disagree.",
  },
  missing: {
    what: "No applicable normative preference criterion is supplied.",
    not_for: "Use when a criterion is supplied but is vague.",
  },
  ambiguous: {
    what: "A preference is supplied but permits unresolved materially different interpretations of the same facts.",
    not_for: "Use when the preference is clear but the supplied evidence is incomplete.",
  },
  conflicting: {
    what: "Two or more supplied preference rules select different outcomes for these variants and no precedence is supplied.",
    not_for: "Use when a single rule applies and is merely imprecise.",
  },
}

const OBLIGATION_OPTIONS = {
  true: "Both variants preserve every declared behavior obligation.",
  false: "At least one supplied variant fails at least one declared behavior obligation.",
}

const OBLIGATION_OPTIONS_PRECISE = {
  true: {
    what: "Tracing each declared obligation through both supplied variants shows no variant violating it.",
    not_for: "Use when a declared obligation cannot be traced in the supplied source.",
  },
  false: {
    what: "At least one supplied variant fails at least one declared behavior obligation.",
    not_for: "Use for a policy disagreement or a style difference that leaves the obligations intact.",
  },
}

type Entry = string | Schema.JsonObject

const flatten = (fields: Record<string, Schema.Json>): string =>
  Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n")

const flattenPolicy = (text: PolicyText): string =>
  flatten({
    question: text.question,
    focus: text.focus,
    precedence: text.precedence,
    goal: text.goal,
    "boundary_test.what": text.boundaryTest?.what ?? null,
    "boundary_test.not_for": text.boundaryTest?.notFor ?? null,
    "boundary_test.examples": text.boundaryTest ? text.boundaryTest.examples : null,
    preference: text.preference,
  })

const structuredPolicy = (text: PolicyText): Schema.JsonObject => ({
  scope: "pulsar-repository-research",
  status: "proposed-experiment-only-not-adopted",
  question: text.question,
  focus: text.focus,
  precedence: text.precedence,
  goal: text.goal,
  boundary_test: text.boundaryTest
    ? { what: text.boundaryTest.what, not_for: text.boundaryTest.notFor, examples: text.boundaryTest.examples }
    : null,
  preference: text.preference,
})

const prosePolicy = (text: PolicyText): Schema.JsonObject => ({
  scope: "pulsar-repository-research",
  status: "proposed-experiment-only-not-adopted",
  statement: flattenPolicy(text),
})

interface Treatment {
  readonly policy: Schema.JsonObject
  readonly instructions: Schema.JsonObject
  readonly options: Record<string, { what: string; not_for: string | null }>
  readonly instructionsStructured: boolean
  readonly policyStructured: boolean
}

const treatment = (
  definition: PolicyClarityCase,
  condition: Condition,
): Treatment => {
  const ambiguousInstructions = { ...AMBIGUOUS_PREFERENCE_INSTRUCTIONS }
  const preciseInstructions = precisePreferenceInstructions(definition)
  const preciseOptions = Object.fromEntries(
    Object.entries(PRECISE_OPTIONS).map(([key, value]) => [key, { what: value.what, not_for: value.not_for }]),
  )
  const ambiguousOptions = Object.fromEntries(
    Object.entries(AMBIGUOUS_OPTIONS).map(([key, value]) => [key, { what: value, not_for: null }]),
  )
  switch (condition) {
    case "amb_prose":
      return {
        policy: prosePolicy(definition.policies.ambiguous),
        instructions: ambiguousInstructions,
        options: Object.fromEntries(Object.entries(AMBIGUOUS_OPTIONS).map(([key, value]) => [key, { what: value, not_for: null }])),
        instructionsStructured: false,
        policyStructured: false,
      }
    case "amb_struct":
      return {
        policy: structuredPolicy(definition.policies.ambiguous),
        instructions: ambiguousInstructions,
        options: ambiguousOptions,
        instructionsStructured: true,
        policyStructured: true,
      }
    case "prec_prose":
      return {
        policy: prosePolicy(definition.policies.precise),
        instructions: preciseInstructions,
        options: preciseOptions,
        instructionsStructured: false,
        policyStructured: false,
      }
    case "prec_struct":
      return {
        policy: structuredPolicy(definition.policies.precise),
        instructions: preciseInstructions,
        options: preciseOptions,
        instructionsStructured: true,
        policyStructured: true,
      }
    case "prec_policy_only":
      return {
        policy: prosePolicy(definition.policies.precise),
        instructions: ambiguousInstructions,
        options: ambiguousOptions,
        instructionsStructured: false,
        policyStructured: false,
      }
    case "opposing":
      return {
        policy: prosePolicy(definition.policies.opposing ?? definition.policies.precise),
        instructions: preciseInstructions,
        options: preciseOptions,
        instructionsStructured: false,
        policyStructured: false,
      }
    case "opposing_single_callsite":
      return {
        policy: prosePolicy(definition.policies.opposingSingleCallSite ?? definition.policies.precise),
        instructions: preciseInstructions,
        options: preciseOptions,
        instructionsStructured: false,
        policyStructured: false,
      }
    case "no_policy":
      return {
        policy: { scope: "pulsar-repository-research", status: "proposed-experiment-only-not-adopted" },
        instructions: preciseInstructions,
        options: preciseOptions,
        instructionsStructured: false,
        policyStructured: false,
      }
    case "conflict":
      return {
        policy: structuredPolicy(definition.policies.conflict),
        instructions: preciseInstructions,
        options: preciseOptions,
        instructionsStructured: false,
        policyStructured: true,
      }
  }
}

const serializeInstructions = (instructions: Schema.JsonObject, structured: boolean): Entry =>
  structured ? instructions : flatten(instructions)

const serializeOptions = (
  options: Record<string, { what: string; not_for: string | null }>,
  structured: boolean,
): Record<string, Entry> =>
  Object.fromEntries(
    Object.entries(options).map(([key, value]) => [
      key,
      structured ? { what: value.what, not_for: value.not_for } : value.what,
    ]),
  )

const readinessEntries = (structured: boolean): Record<string, Entry> =>
  serializeOptions(
    Object.fromEntries(Object.entries(READINESS_OPTIONS).map(([key, value]) => [key, { what: value, not_for: null }])),
    structured,
  )

const policyReadinessEntries = (structured: boolean): Record<string, Entry> =>
  serializeOptions(
    Object.fromEntries(
      structured
        ? Object.entries(POLICY_READINESS_OPTIONS_PRECISE).map(([key, value]) => [key, { what: value.what, not_for: value.not_for }])
        : Object.entries(POLICY_READINESS_OPTIONS).map(([key, value]) => [key, { what: value, not_for: null }]),
    ),
    structured,
  )

const obligationEntries = (structured: boolean): Record<string, Entry> =>
  structured
    ? Object.fromEntries(
        Object.entries(OBLIGATION_OPTIONS_PRECISE).map(([key, value]) => [key, { what: value.what, not_for: value.not_for }]),
      )
    : { true: OBLIGATION_OPTIONS.true, false: OBLIGATION_OPTIONS.false }

const FORBIDDEN_KEYS = new Set([
  "reference_label",
  "referenceLabel",
  "expected_direction",
  "expectedDirection",
  "expected",
  "authorExpectation",
  "author_expectation",
  "proposedExpectations",
  "annotator",
  "prior_model_outputs",
  "aggregate_score",
  "api_key",
  "credentials",
  "ground_truth",
  "split",
])

const scanForbiddenKeys = (value: Schema.Json): void => {
  if (Array.isArray(value)) value.forEach(scanForbiddenKeys)
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error(`Local-only field in request: ${key}`)
      scanForbiddenKeys(child)
    }
  }
}

export interface PlanRequest {
  readonly id: string
  readonly caseId: PolicyClarityCase["id"]
  readonly condition: Condition
  readonly order: number
  readonly repeat: number
  /** Which physical variant each label points at. */
  readonly labeling: { readonly a: "a" | "b"; readonly b: "a" | "b" }
  readonly request: Request
  readonly requestHash: string
}

export interface PolicyClarityPlan {
  readonly schema: "pulsar.jev_policy_clarity_plan.v1"
  readonly mode: typeof MODE
  readonly scope: Scope
  readonly createdAt: string
  readonly repositorySha: string
  readonly casesHash: string
  readonly maxRequests: number
  readonly maxRequestBytes: number
  readonly policy: Schema.JsonObject
  readonly requests: ReadonlyArray<PlanRequest>
}

export const PlanSchema = Schema.Struct({
  schema: Schema.Literal("pulsar.jev_policy_clarity_plan.v1"),
  mode: Schema.Literal(MODE),
  scope: Schema.Literals(SCOPE),
  createdAt: Schema.String,
  repositorySha: Schema.String,
  casesHash: Schema.String,
  maxRequests: Schema.Int,
  maxRequestBytes: Schema.Int,
  policy: Schema.JsonObject,
  requests: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      caseId: Schema.Literals(CASE_ORDER as ReadonlyArray<string>),
      condition: Schema.Literals(ALL_CONDITIONS as ReadonlyArray<string>),
      order: Schema.Int,
      repeat: Schema.Int,
      labeling: Schema.Struct({ a: Schema.Literals(["a", "b"]), b: Schema.Literals(["a", "b"]) }),
      request: Request,
      requestHash: Schema.String,
    }),
  ),
})

const physicalVariant = (definition: PolicyClarityCase, order: number): { a: "a" | "b"; b: "a" | "b" } =>
  order === 0 ? { a: "a", b: "b" } : { a: "b", b: "a" }

export function buildPolicyClarityPlan(root: string, model: string, scope: Scope): PolicyClarityPlan {
  const cases = buildPolicyClarityCases(root)
  const requests: PlanRequest[] = []
  for (const caseId of CASE_ORDER) {
    const definition = cases[caseId]
    // A scoped batch must not touch cases outside its role, so an exploration
    // batch cannot influence rubric wording for the held-out case.
    const role = SCOPE_ROLE[scope]
    if (role !== "any" && definition.role !== role) continue
    const conditions = CASE_CONDITIONS[caseId].filter((condition) => SCOPE_CONDITIONS[scope].includes(condition))
    for (const condition of conditions) {
      const t = treatment(definition, condition)
      for (const order of ORDERS) {
        const labeling = physicalVariant(definition, order)
        for (let repeat = 0; repeat < REPEATS_BY_SCOPE[scope]; repeat += 1) {
          const id = `${caseId}-${condition}-o${order}-r${repeat}`
          const filesA = definition.variants[labeling.a]
          const filesB = definition.variants[labeling.b]
          const request = Schema.decodeUnknownSync(Request)({
            model,
            state: {
              subject: definition.subject,
              sources: Object.fromEntries(
                Object.entries(definition.sources).map(([key, value]) => [
                  key,
                  { path: value.path, start: value.start, end: value.end, content: value.content, sha256: value.sha256 },
                ]),
              ),
              variants: {
                a: { files: filesA, sha256: sha256(canonical(filesA)) },
                b: { files: filesB, sha256: sha256(canonical(filesB)) },
              },
              obligations: definition.obligations,
              policy: t.policy,
              context_manifest: {
                missing: [],
                omitted: [
                  "Full transitive dependencies",
                  "Execution results: independent checks are not supplied",
                  "Author-proposed expectations and repository call-site inventories",
                ],
                dataClass: "Owner-authorized public Pulsar source and hypothetical alternatives",
              },
            },
            questions: {
              preference: {
                type: "choice",
                instructions: serializeInstructions(t.instructions, t.instructionsStructured),
                criteria: serializeOptions(t.options, t.instructionsStructured),
              },
              policy_readiness: {
                type: "choice",
                instructions: serializeInstructions(
                  {
                    question:
                      "Does the supplied policy specify one coherent applicable normative preference for these variants? Do not mistake a descriptive measurement scale or a behavior obligation for an architectural preference.",
                    inspect: "`policy` and `variants`.",
                    focus: null,
                    precedence: null,
                    independence: INDEPENDENCE,
                  },
                  t.instructionsStructured,
                ),
                criteria: policyReadinessEntries(t.instructionsStructured),
              },
              evidence_readiness: {
                type: "choice",
                instructions: serializeInstructions(
                  {
                    question:
                      "Is the supplied source sufficient to establish the code facts a policy test would need for these variants, independently of whether a preference policy exists?",
                    inspect: "`variants`, `sources`, and `obligations`.",
                    focus: null,
                    precedence: null,
                    independence: INDEPENDENCE,
                  },
                  t.instructionsStructured,
                ),
                criteria: readinessEntries(t.instructionsStructured),
              },
              obligations_preserved: {
                type: "noul",
                instructions: serializeInstructions(
                  {
                    question:
                      "Do both `variants.a` and `variants.b` preserve every behavior obligation declared in `obligations`?",
                    inspect: "`variants.a`, `variants.b`, and `obligations`.",
                    focus: null,
                    precedence: null,
                    independence: INDEPENDENCE,
                  },
                  t.instructionsStructured,
                ),
                criteria: obligationEntries(t.instructionsStructured),
              },
            },
          })
          requests.push({
            id,
            caseId,
            condition,
            order,
            repeat,
            labeling,
            request,
            requestHash: sha256(JSON.stringify(request)),
          })
        }
      }
    }
  }
  const plan: PolicyClarityPlan = {
    schema: "pulsar.jev_policy_clarity_plan.v1",
    mode: MODE,
    scope,
    createdAt: new Date().toISOString(),
    repositorySha: Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: root }).stdout.toString().trim(),
    casesHash: sha256(canonical(Schema.decodeUnknownSync(Schema.Json)(cases))),
    maxRequests: MAX_REQUESTS,
    maxRequestBytes: MAX_REQUEST_BYTES,
    policy: {
      status: "development_only",
      authority: "tier3_research_only",
      modelRevisionStatus: "unresolved",
      retries: 0,
      concurrency: 1,
      timeoutMs: 30_000,
      scope,
      aggregation: "none",
      criteriaStatus: "proposed_repo_scoped_experiment_not_adopted",
      expectationsStatus: "agent_authored_not_human_ground_truth",
      stopOnAuthOrSchemaError: true,
      independentEvidence: "computed_outside_provider_input",
      disclosure: "owner_authorized_public_repository",
      budget: "Hard request and byte caps; usage-based costs are estimates, not an account billing limit.",
    },
    requests,
  }
  validatePolicyClarityPlan(plan)
  return plan
}

function policyStrings(policy: Schema.Json): ReadonlyArray<string> {
  if (typeof policy === "string") return [policy]
  if (policy === null) return []
  if (Array.isArray(policy)) return policy.flatMap(policyStrings)
  return Object.values(policy).flatMap(policyStrings)
}

export function validatePolicyClarityPlan(input: unknown): PolicyClarityPlan {
  const plan = Schema.decodeUnknownSync(PlanSchema)(input) as PolicyClarityPlan
  if (plan.requests.length === 0 || plan.requests.length > MAX_REQUESTS) throw new Error("Request budget exceeded")
  if (new Set(plan.requests.map((entry) => entry.id)).size !== plan.requests.length) {
    throw new Error("Duplicate request IDs")
  }
  for (const entry of plan.requests) {
    const body = JSON.stringify(entry.request)
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error(`Request byte cap: ${entry.id}`)
    if (sha256(body) !== entry.requestHash) throw new Error(`Request hash mismatch: ${entry.id}`)
    scanForbiddenKeys(Schema.decodeUnknownSync(Schema.Json)(entry.request.state))
    const policy = entry.request.state["policy"] as Schema.Json
    for (const text of policyStrings(policy)) {
      if (text.includes("variants.")) throw new Error(`Policy names a variant label: ${entry.id}`)
    }
    const serializedPolicy = canonical(policy)
    for (const variantFiles of Object.values(entry.request.state["variants"] as Schema.JsonObject)) {
      const files = (variantFiles as Schema.JsonObject)["files"] as Schema.JsonObject
      for (const path of Object.keys(files)) {
        if (serializedPolicy.includes(path)) throw new Error(`Policy names a variant source path: ${entry.id}`)
      }
    }
    if (body.includes("authorExpectation") || body.includes("independentEvidence")) {
      throw new Error(`Expectation leaked into provider input: ${entry.id}`)
    }
    const labeling = entry.labeling
    if (labeling.a === labeling.b) throw new Error(`Labeling not counterbalanced: ${entry.id}`)
    const questions = entry.request.questions
    for (const question of Object.values(questions)) {
      const count = Object.keys(question.criteria).length
      if (count < 2 || count > (question.type === "score" ? 10 : 255)) {
        throw new Error(`Invalid question cardinality: ${entry.id}`)
      }
    }
    if (!questions["preference"] || questions["preference"].type !== "choice") {
      throw new Error(`Missing preference question: ${entry.id}`)
    }
    if (entry.request.model === "") throw new Error(`Missing model: ${entry.id}`)
  }
  return plan
}

export function validateCurrentCaseInputs(plan: PolicyClarityPlan, root: string): void {
  const current = buildPolicyClarityPlan(root, plan.requests[0]!.request.model, plan.scope)
  if (plan.casesHash !== current.casesHash) {
    throw new Error("Case or policy definitions changed; prepare and inspect a new plan")
  }
  if (canonical(Schema.decodeUnknownSync(Schema.Json)(plan.requests)) !== canonical(Schema.decodeUnknownSync(Schema.Json)(current.requests))) {
    throw new Error("Prepared requests changed; prepare and inspect a new plan")
  }
}

export function readPlan(path: string): PolicyClarityPlan {
  return validatePolicyClarityPlan(JSON.parse(readFileSync(resolve(path), "utf8")))
}
