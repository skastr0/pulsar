import { createHash } from "node:crypto"
import { Schema } from "effect"

const Probability = Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 }))
export const JevDescription = Schema.Union([
  Schema.Null,
  Schema.NonEmptyString,
  Schema.JsonObject,
  Schema.Array(Schema.Json),
])
export type JevDescription = typeof JevDescription.Type

const ChoiceCriteria = Schema.Record(Schema.String, JevDescription)

export const JevQuestion = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("choice"),
    instructions: JevDescription,
    criteria: ChoiceCriteria,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    instructions: JevDescription,
    criteria: Schema.Array(JevDescription),
  }),
])
export type JevQuestion = typeof JevQuestion.Type

export const JevRequest = Schema.Struct({
  model: Schema.NonEmptyString,
  state: Schema.Json,
  questions: Schema.Record(Schema.String, JevQuestion),
})
export type JevRequest = typeof JevRequest.Type

const Distribution = Schema.Record(Schema.String, Probability)

export const JevAnswer = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("choice"),
    choice: Schema.String,
    probabilities: Distribution,
    confidence: Probability,
  }),
  Schema.Struct({
    type: Schema.Literal("score"),
    score: Schema.Finite,
    probabilities: Distribution,
    legend: Schema.Record(Schema.String, JevDescription),
    confidence: Probability,
  }),
])
export type JevAnswer = typeof JevAnswer.Type

export const JevResponse = Schema.Struct({
  model: Schema.NonEmptyString,
  answers: Schema.Record(Schema.String, JevAnswer),
  usage: Schema.Struct({
    input_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    output_tokens: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
})
export type JevResponse = typeof JevResponse.Type

export const PROBABILITY_TOLERANCE = 0.005000001

export const sha256 = (bytes: string): string => createHash("sha256").update(bytes).digest("hex")

/** Sort object keys for identity only. The exact request body is recorded separately. */
export const canonical = (value: unknown): string => {
  const json = Schema.decodeUnknownSync(Schema.Json)(value)
  if (Array.isArray(json)) return `[${json.map(canonical).join(",")}]`
  if (Schema.is(Schema.JsonObject)(json)) {
    return `{${Object.keys(json)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(json[key])}`)
      .join(",")}}`
  }
  return JSON.stringify(json)
}

const sameKeys = (actual: object, expected: object, description: string): void => {
  if (canonical(Object.keys(actual).sort()) !== canonical(Object.keys(expected).sort())) {
    throw new Error(`${description}: keys differ`)
  }
}

export const encodeJevRequestBody = (request: JevRequest): string => JSON.stringify(request)

export const requestSha256 = (body: string): string => sha256(body)

export const promptFingerprint = (questions: JevRequest["questions"]): string =>
  sha256(canonical(questions))

export const validateJevResponse = (request: JevRequest, input: unknown): JevResponse => {
  const response = Schema.decodeUnknownSync(JevResponse)(input)
  sameKeys(response.answers, request.questions, "answers")
  for (const [id, question] of Object.entries(request.questions)) {
    const answer = response.answers[id]!
    if (question.type !== answer.type) throw new Error(`${id}: answer type differs`)
    const keys =
      question.type === "score"
        ? Object.fromEntries(question.criteria.map((_, index) => [String(index), true]))
        : question.criteria
    sameKeys(answer.probabilities, keys, `${id}: probabilities`)
    const total = Object.values(answer.probabilities).reduce((sum, probability) => sum + probability, 0)
    if (Math.abs(total - 1) > PROBABILITY_TOLERANCE * Object.keys(keys).length) {
      throw new Error(`${id}: probability sum ${total}`)
    }
    if (answer.type === "choice") {
      if (
        !Object.hasOwn(answer.probabilities, answer.choice) ||
        answer.probabilities[answer.choice]! < Math.max(...Object.values(answer.probabilities))
      ) {
        throw new Error(`${id}: choice is not a probability maximum`)
      }
    } else if (question.type === "score") {
      const legend = Object.fromEntries(
        question.criteria.map((description, index) => [String(index), description]),
      )
      if (canonical(answer.legend) !== canonical(legend)) throw new Error(`${id}: legend differs`)
      const weighted = Object.entries(answer.probabilities).reduce(
        (sum, [key, probability]) => sum + Number(key) * probability,
        0,
      )
      const roundingBound =
        PROBABILITY_TOLERANCE * (1 + (question.criteria.length * (question.criteria.length - 1)) / 2)
      if (
        answer.score < 0 ||
        answer.score > question.criteria.length - 1 ||
        Math.abs(weighted - answer.score) > roundingBound
      ) {
        throw new Error(`${id}: inconsistent score`)
      }
    }
  }
  return response
}
