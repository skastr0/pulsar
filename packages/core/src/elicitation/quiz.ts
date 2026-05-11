import { Effect, Schema } from "effect"
import {
  appendVectorProvenance,
  decodePulsarVector,
  weightOf,
  type SignalOverride,
  type PulsarVector,
} from "../vector.js"
import typescriptQuizItems from "../../quiz-items/typescript.json" with { type: "json" }
import { clampWeight } from "./proposal-utils.js"

export const QuizSignalScores = Schema.Record({
  key: Schema.String,
  value: Schema.Number.pipe(Schema.between(0, 2)),
})
export type QuizSignalScores = typeof QuizSignalScores.Type

export const QuizItem = Schema.Struct({
  id: Schema.String,
  domain: Schema.String,
  prompt: Schema.String,
  a_title: Schema.String,
  b_title: Schema.String,
  a_code: Schema.String,
  b_code: Schema.String,
  a_signals: QuizSignalScores,
  b_signals: QuizSignalScores,
  tags: Schema.optional(Schema.Array(Schema.String)),
})
export type QuizItem = typeof QuizItem.Type

export const QuizAnswer = Schema.Literal("a", "b", "equal", "skip")
export type QuizAnswer = typeof QuizAnswer.Type

export const QuizResponse = Schema.Struct({
  item_id: Schema.String,
  answer: QuizAnswer,
  answered_at: Schema.String,
})
export type QuizResponse = typeof QuizResponse.Type

export const QuizSession = Schema.Struct({
  schema_version: Schema.Literal(1),
  session_id: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  domain: Schema.String,
  item_target: Schema.Number,
  output_path: Schema.String,
  base_vector: Schema.Unknown,
  asked_item_ids: Schema.Array(Schema.String),
  responses: Schema.Array(QuizResponse),
  completed: Schema.Boolean,
})
export type QuizSession = Omit<typeof QuizSession.Type, "base_vector"> & {
  readonly base_vector: PulsarVector
}

export interface QuizSignalPreference {
  readonly seen: number
  readonly evidence: number
  readonly magnitude: number
}

export interface QuizInference {
  readonly answeredCount: number
  readonly bySignal: Readonly<Record<string, QuizSignalPreference>>
}

export const loadQuizItems = (
  domain = "typescript",
): Effect.Effect<ReadonlyArray<QuizItem>, Error, never> =>
  Effect.gen(function* () {
    const decoded = yield* decodeQuizItemFile(typescriptQuizItems).pipe(Effect.mapError(asError))

    const flattened = decoded
      .flat()
      .filter((item) => item.domain === domain)
      .sort((left, right) => left.id.localeCompare(right.id))
    const seen = new Set<string>()
    for (const item of flattened) {
      if (seen.has(item.id)) {
        return yield* Effect.fail(new Error(`Duplicate quiz item id: ${item.id}`))
      }
      seen.add(item.id)
    }

    return flattened
  })

const decodeQuizItemFile = (parsed: unknown) =>
  Array.isArray(parsed)
    ? Effect.forEach(parsed, (item) => Schema.decodeUnknown(QuizItem)(item))
    : Effect.map(Schema.decodeUnknown(QuizItem)(parsed), (item) => [item])

export const accumulateQuizInference = (
  items: ReadonlyArray<QuizItem>,
  responses: ReadonlyArray<QuizResponse>,
): QuizInference => {
  const byId = new Map(items.map((item) => [item.id, item]))
  const state = new Map<string, { seen: number; evidence: number; magnitude: number }>()

  for (const response of responses) {
    const item = byId.get(response.item_id)
    if (item === undefined) continue
    const deltas = quizSignalDeltas(item)
    if (response.answer === "skip") continue

    for (const delta of deltas) {
      const entry = state.get(delta.signalId) ?? { seen: 0, evidence: 0, magnitude: 0 }
      entry.seen += 1
      entry.magnitude += Math.abs(delta.delta)
      if (response.answer === "a") entry.evidence += delta.delta
      if (response.answer === "b") entry.evidence -= delta.delta
      state.set(delta.signalId, entry)
    }
  }

  return {
    answeredCount: responses.filter((response) => response.answer !== "skip").length,
    bySignal: Object.fromEntries(
      [...state.entries()]
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([signalId, entry]) => [signalId, { ...entry }]),
    ),
  }
}

export const selectNextQuizItem = (input: {
  readonly items: ReadonlyArray<QuizItem>
  readonly responses: ReadonlyArray<QuizResponse>
}): QuizItem | undefined => {
  const answered = new Set(input.responses.map((response) => response.item_id))
  const inference = accumulateQuizInference(input.items, input.responses)
  const scored = input.items
    .filter((item) => !answered.has(item.id))
    .map((item) => ({
      item,
      informationGain: scoreQuizItemInformationGain(item, inference.bySignal),
    }))
    .sort(
      (left, right) =>
        right.informationGain - left.informationGain || left.item.id.localeCompare(right.item.id),
    )

  return scored[0]?.item
}

export const summarizeQuizTradeoff = (item: QuizItem): string => {
  const deltas = quizSignalDeltas(item)
    .filter((delta) => Math.abs(delta.delta) >= 0.2)
    .sort((left, right) => Math.abs(right.delta) - Math.abs(left.delta))
  const strongest = deltas[0]
  const second = deltas[1]
  if (strongest === undefined) return "This pair probes a balanced tradeoff with no dominant signal."

  const favored = strongest.delta > 0 ? item.a_title : item.b_title
  const opposed = strongest.delta > 0 ? item.b_title : item.a_title
  if (second === undefined) {
    return `This favors ${favored} over ${opposed} through ${strongest.signalId}.`
  }

  return `This favors ${favored} over ${opposed}, mostly through ${strongest.signalId} and ${second.signalId}.`
}

export const inferPulsarVectorFromQuiz = (input: {
  readonly baseVector: PulsarVector | undefined
  readonly responses: ReadonlyArray<QuizResponse>
  readonly items: ReadonlyArray<QuizItem>
  readonly vectorId: string
  readonly description?: string
  readonly outputPath?: string
  readonly recordedAt?: string
}): PulsarVector => {
  const baseVector = input.baseVector ?? {
    id: "all-defaults",
    domain: "typescript",
    signal_overrides: {},
  }
  const inference = accumulateQuizInference(input.items, input.responses)
  const signalOverrides: Record<string, SignalOverride> = { ...baseVector.signal_overrides }

  for (const [signalId, preference] of Object.entries(inference.bySignal)) {
    if (preference.seen === 0 || preference.magnitude === 0) continue
    const normalized = preference.evidence / preference.magnitude
    const confidence = Math.min(1, preference.seen / 3)
    const baseWeight = weightOf(signalId, baseVector)
    const adjustedWeight = clampWeight(baseWeight + normalized * confidence * 0.5)
    if (Math.abs(adjustedWeight - baseWeight) < 0.05) continue

    signalOverrides[signalId] = {
      ...signalOverrides[signalId],
      weight: adjustedWeight,
    }
  }

  return appendVectorProvenance(
    {
      ...baseVector,
      id: input.vectorId,
      description:
        input.description ??
        `Pulsar vector elicited from ${inference.answeredCount} pairwise tradeoff answers.`,
      signal_overrides: signalOverrides,
    },
    {
      source: "quiz",
      recorded_at: input.recordedAt ?? new Date().toISOString(),
      summary: `Pairwise quiz elicitation (${inference.answeredCount} answered prompts)`,
      artifact_path: input.outputPath,
      evidence: [
        {
          kind: "quiz",
          summary: `Answered ${inference.answeredCount} prompts across ${Object.keys(inference.bySignal).length} signals.`,
          metadata: {
            answered_count: inference.answeredCount,
            item_ids: input.responses.map((response) => response.item_id),
          },
        },
      ],
    },
  )
}

export const decodeQuizSession = (value: unknown): Effect.Effect<QuizSession, Error, never> =>
  Effect.gen(function* () {
    const decoded = yield* Schema.decodeUnknown(QuizSession)(value).pipe(Effect.mapError(asError))
    const baseVector = yield* decodePulsarVector(decoded.base_vector).pipe(Effect.mapError(asError))
    return {
      ...decoded,
      base_vector: baseVector,
    } satisfies QuizSession
  })

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause))

const scoreQuizItemInformationGain = (
  item: QuizItem,
  bySignal: Readonly<Record<string, QuizSignalPreference>>,
): number => {
  let score = 0
  for (const delta of quizSignalDeltas(item)) {
    const preference = bySignal[delta.signalId]
    const seen = preference?.seen ?? 0
    const certainty =
      preference === undefined || preference.magnitude === 0
        ? 0
        : Math.min(1, Math.abs(preference.evidence / preference.magnitude))
    const uncertainty = 1 / (1 + seen) + (1 - certainty)
    score += Math.abs(delta.delta) * uncertainty
    if (seen === 0) score += 0.25
  }
  return Number(score.toFixed(4))
}

const quizSignalDeltas = (item: QuizItem) => {
  const signalIds = [...new Set([...Object.keys(item.a_signals), ...Object.keys(item.b_signals)])]
  return signalIds.map((signalId) => ({
    signalId,
    delta: (item.a_signals[signalId] ?? 0) - (item.b_signals[signalId] ?? 0),
  }))
}
