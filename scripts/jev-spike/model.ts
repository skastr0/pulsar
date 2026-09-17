import { createHash } from "node:crypto"
import { Schema } from "effect"

const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
const Description = Schema.Union([Schema.NonEmptyString, Schema.JsonObject, Schema.Array(Schema.Json)])
const Descriptions = Schema.Record(Schema.String, Description)
export const Question = Schema.Union([
  Schema.Struct({ type: Schema.Literal("choice"), instructions: Description, criteria: Descriptions }),
  Schema.Struct({ type: Schema.Literal("score"), instructions: Description, criteria: Schema.Array(Description) }),
  Schema.Struct({ type: Schema.Literal("noul"), instructions: Description, criteria: Schema.Struct({ true: Description, false: Description }) }),
])
export const Request = Schema.Struct({
  model: Schema.NonEmptyString,
  state: Schema.JsonObject,
  questions: Schema.Record(Schema.String, Question),
})
export type Request = typeof Request.Type
export const Bank = Schema.Struct({
  version: Schema.String,
  common_instructions: Schema.NonEmptyString,
  templates: Schema.Record(Schema.String, Schema.Struct({
    requires: Schema.Array(Schema.String),
    cases: Schema.Array(Schema.String),
    experiments: Schema.Array(Schema.String),
    question: Question,
    illustrative_utility: Schema.optionalKey(Schema.Array(Probability)),
  })),
})
export type Bank = typeof Bank.Type
export const Case = Schema.Struct({
  id: Schema.NonEmptyString,
  lineage: Schema.NonEmptyString,
  questionIds: Schema.Array(Schema.String),
  state: Schema.JsonObject,
  proposedExpectations: Schema.Record(Schema.String, Schema.String),
})
export type Case = typeof Case.Type

const Distribution = Schema.Record(Schema.String, Probability)
const Answer = Schema.Union([
  Schema.Struct({ type: Schema.Literal("choice"), choice: Schema.String, probabilities: Distribution, confidence: Probability }),
  Schema.Struct({ type: Schema.Literal("score"), score: Schema.Finite, probabilities: Distribution, legend: Descriptions, confidence: Probability }),
  Schema.Struct({ type: Schema.Literal("noul"), noul: Probability }),
])
export const Response = Schema.Struct({
  model: Schema.NonEmptyString,
  answers: Schema.Record(Schema.String, Answer),
  usage: Schema.Struct({
    input_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    output_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
})
export type Response = typeof Response.Type

export const sha256 = (bytes: string): string => createHash("sha256").update(bytes).digest("hex")

// Sort object keys for identity only. The exact request body is recorded separately.
export function canonical(value: unknown): string {
  const json = Schema.decodeUnknownSync(Schema.Json)(value)
  if (Array.isArray(json)) return `[${json.map(canonical).join(",")}]`
  if (Schema.is(Schema.JsonObject)(json)) {
    return `{${Object.keys(json).sort().map((key) => `${JSON.stringify(key)}:${canonical(json[key])}`).join(",")}}`
  }
  return JSON.stringify(json)
}

function sameKeys(actual: object, expected: object, description: string): void {
  if (canonical(Object.keys(actual).sort()) !== canonical(Object.keys(expected).sort())) {
    throw new Error(`${description}: keys differ`)
  }
}

export function validateBank(input: unknown): Bank {
  const bank = Schema.decodeUnknownSync(Bank)(input)
  for (const [id, template] of Object.entries(bank.templates)) {
    if (!/^JQ-\d{2}$/.test(id)) throw new Error(`Invalid question ID ${id}`)
    if (template.cases.some((ref) => !/^C(0[1-9]|1[0-6])$/.test(ref)) ||
        template.experiments.some((ref) => !/^E(0[1-9]|[1-3][0-9]|4[0-2])$/.test(ref))) {
      throw new Error(`Invalid experiment/case reference in ${id}`)
    }
    const question = template.question
    if (question.type === "score") {
      if (question.criteria.length < 2 || question.criteria.length > 10 ||
          template.illustrative_utility?.length !== question.criteria.length) {
        throw new Error(`Invalid score levels/utility in ${id}`)
      }
    } else if (question.type === "choice") {
      if (Object.keys(question.criteria).length < 2 || Object.keys(question.criteria).length > 255) {
        throw new Error(`Invalid choice cardinality in ${id}`)
      }
    }
  }
  return bank
}

const forbiddenKeys = new Set([
  "reference_label", "referenceLabel", "expected_direction", "expectedDirection", "split",
  "proposedExpectations", "annotator", "prior_model_outputs", "aggregate_score", "api_key", "credentials",
])

function rejectLocalMetadata(value: Schema.Json): void {
  if (Array.isArray(value)) value.forEach(rejectLocalMetadata)
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(`Local-only field in state: ${key}`)
      rejectLocalMetadata(child)
    }
  }
}

function atPath(state: Schema.Json, path: string): Schema.Json | undefined {
  let value: Schema.Json | undefined = state
  for (const part of path.split(".")) {
    if (!Schema.is(Schema.JsonObject)(value) || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}

export function compile(bank: Bank, fixture: Case, model: string): Request {
  const ids = [...new Set(["JQ-01", "JQ-02", ...fixture.questionIds])]
  const templates = ids.map((id) => {
    const template = bank.templates[id]
    if (!template) throw new Error(`Unknown question ${id}`)
    return template
  })
  const focus = Schema.decodeUnknownSync(Schema.JsonObject)(fixture.state.focus)
  const explicitRequirements = focus.required_evidence === undefined ? [] :
    Schema.decodeUnknownSync(Schema.Array(Schema.String))(focus.required_evidence)
  const required = [...new Set([...explicitRequirements, ...templates.flatMap((template) => template.requires)])].sort()
  if (typeof focus.subject !== "string" || !focus.subject || typeof focus.criterion !== "string" || !focus.criterion) {
    throw new Error("Bind focus.subject and focus.criterion")
  }
  const state: Schema.JsonObject = { ...fixture.state, focus: { ...focus, required_evidence: required } }
  rejectLocalMetadata(state)
  const manifest = Schema.decodeUnknownSync(Schema.Struct({ missing: Schema.Array(Schema.String) }))(state.context_manifest)
  // A declared omission is unknown evidence, not an empty healthy default.
  for (const path of required) {
    if (atPath(state, path) === undefined && !manifest.missing.some((missing) => path === missing || path.startsWith(`${missing}.`))) {
      throw new Error(`Unbound evidence path: ${path}`)
    }
  }
  return {
    model,
    state,
    questions: Object.fromEntries(ids.map((id, index) => {
      const question = templates[index]!.question
      const instructions = typeof question.instructions === "string"
        ? `${bank.common_instructions}\n\n${question.instructions}`
        : { common: bank.common_instructions, question: question.instructions }
      return [id, { ...question, instructions }]
    })),
  }
}

// The contract smoke returned hundredth-rounded probabilities and an independently
// rounded Score. Bound each rounding error; never normalize/repair the distribution.
export const PROBABILITY_TOLERANCE = 0.005000001
export function validateResponse(request: Request, input: unknown): Response {
  const response = Schema.decodeUnknownSync(Response)(input)
  sameKeys(response.answers, request.questions, "answers")
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = response.answers[id]!
    if (question.type !== answer.type) throw new Error(`${id}: answer type differs`)
    if (answer.type === "noul") continue
    const keys = question.type === "score"
      ? Object.fromEntries(question.criteria.map((_, index) => [String(index), true]))
      : question.criteria
    sameKeys(answer.probabilities, keys, `${id}: probabilities`)
    const total = Object.values(answer.probabilities).reduce((sum, probability) => sum + probability, 0)
    if (Math.abs(total - 1) > PROBABILITY_TOLERANCE * Object.keys(keys).length) throw new Error(`${id}: probability sum ${total}`)
    if (answer.type === "choice") {
      if (!Object.hasOwn(answer.probabilities, answer.choice) ||
          answer.probabilities[answer.choice]! < Math.max(...Object.values(answer.probabilities))) {
        throw new Error(`${id}: choice is not a probability maximum`)
      }
    } else if (question.type === "score") {
      const legend = Object.fromEntries(question.criteria.map((description, index) => [String(index), description]))
      if (canonical(answer.legend) !== canonical(legend)) throw new Error(`${id}: legend differs`)
      const weighted = Object.entries(answer.probabilities).reduce((sum, [key, probability]) => sum + Number(key) * probability, 0)
      const roundingBound = PROBABILITY_TOLERANCE * (1 + question.criteria.length * (question.criteria.length - 1) / 2)
      if (answer.score < 0 || answer.score > question.criteria.length - 1 ||
          Math.abs(weighted - answer.score) > roundingBound) {
        throw new Error(`${id}: inconsistent score`)
      }
    }
  }
  return response
}

export function summarize(request: Request, response: Response) {
  const readiness = response.answers["JQ-01"]
  const policy = response.answers["JQ-02"]
  const required = atPath(request.state, "focus.required_evidence")
  const missing = atPath(request.state, "context_manifest.missing")
  const incompleteInput = !Schema.is(Schema.Array(Schema.String))(required) ||
    required.some((path) => atPath(request.state, path) == null) ||
    (Array.isArray(missing) && missing.length > 0)
  const ready = !incompleteInput && readiness?.type === "choice" && readiness.choice === "sufficient" &&
    policy?.type === "choice" && policy.choice === "defined"
  return {
    authority: "tier3_research_only",
    readiness: readiness?.type === "choice" ? readiness.choice : "not_assessed",
    policy: policy?.type === "choice" ? policy.choice : "not_assessed",
    // This is a descriptive mask, not an empirically calibrated actionable threshold.
    consumption: ready ? "descriptive_only" : "unconsumed",
    answers: response.answers,
  }
}
