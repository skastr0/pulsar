import { Effect } from "effect"
import {
  compileOwnershipRequest,
  JEV_NOT_APPLICABLE_ANCHOR_ID,
  JEV_OWNERSHIP_PROMPT_ID,
  JEV_OWNERSHIP_QUESTION_ID,
  JEV_UNKNOWN_ANCHOR_ID,
  type CompiledOwnershipRequest,
  type OwnershipGroupEvaluationInput,
} from "./compile.js"
import type { JevError } from "./errors.js"
import { JevDecodeError } from "./errors.js"
import { validateJevResponse, type JevRequest, type JevResponse } from "./protocol.js"
import { JevClient, type JevReceipt } from "./transport.js"

export interface OwnershipDistributionEntry {
  readonly anchorId: string
  readonly probability: number
  readonly selected: boolean
}

export interface OwnershipGroupAssessment {
  readonly groupId: string
  readonly status: "resolved" | "unresolved" | "not_applicable"
  readonly selectedAnchorId: string
  readonly distribution: ReadonlyArray<OwnershipDistributionEntry>
  readonly modelConfidence: number
  readonly modelId: string
  readonly promptId: typeof JEV_OWNERSHIP_PROMPT_ID
  readonly promptFingerprint: string
  readonly requestSha256: string
  readonly contentHash: string
  readonly inputFingerprint: string
  readonly policyFingerprint: string
  readonly rubricFingerprint: string
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
  }
  readonly elapsedMs: number
  readonly requestId: string | null
  readonly rawResponse: string
  readonly response: JevResponse
}

const decodeReceipt = (
  request: JevRequest,
  receipt: JevReceipt,
): Effect.Effect<JevResponse, JevDecodeError> =>
  Effect.try({
    try: () => {
      let parsed: unknown
      try {
        parsed = JSON.parse(receipt.raw) as unknown
      } catch (cause) {
        throw new JevDecodeError({
          reason: "invalid_json",
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
      try {
        return validateJevResponse(request, parsed)
      } catch (cause) {
        throw new JevDecodeError({
          reason: "invalid_response",
          message: cause instanceof Error ? cause.message : String(cause),
        })
      }
    },
    catch: (cause) =>
      cause instanceof JevDecodeError
        ? cause
        : new JevDecodeError({
            reason: "invalid_response",
            message: cause instanceof Error ? cause.message : String(cause),
          }),
  })

const toAssessment = (
  input: OwnershipGroupEvaluationInput,
  compiled: CompiledOwnershipRequest,
  receipt: JevReceipt,
  response: JevResponse,
): OwnershipGroupAssessment => {
  const answer = response.answers[JEV_OWNERSHIP_QUESTION_ID]
  if (answer === undefined || answer.type !== "choice") {
    throw new JevDecodeError({
      reason: "invalid_response",
      message: "ownership answer missing or not a choice",
    })
  }
  const distribution = compiled.optionIds.map((anchorId) => ({
    anchorId,
    probability: answer.probabilities[anchorId] ?? 0,
    selected: answer.choice === anchorId,
  }))
  const selectedAnchorId = answer.choice
  const status =
    selectedAnchorId === JEV_UNKNOWN_ANCHOR_ID
      ? "unresolved"
      : selectedAnchorId === JEV_NOT_APPLICABLE_ANCHOR_ID
        ? "not_applicable"
        : "resolved"
  return {
    groupId: input.groupId,
    status,
    selectedAnchorId,
    distribution,
    modelConfidence: answer.confidence,
    modelId: response.model,
    promptId: compiled.promptId,
    promptFingerprint: compiled.promptFingerprint,
    requestSha256: compiled.requestSha256,
    contentHash: compiled.contentHash,
    inputFingerprint: compiled.inputFingerprint,
    policyFingerprint: compiled.policyFingerprint,
    rubricFingerprint: compiled.rubricFingerprint,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    },
    elapsedMs: receipt.elapsedMs,
    requestId: receipt.requestId,
    rawResponse: receipt.raw,
    response,
  }
}

export const evaluateOwnershipGroup = Effect.fn("Jev.evaluateOwnershipGroup")(function* (
  input: OwnershipGroupEvaluationInput,
) {
  const compiled = yield* compileOwnershipRequest(input)
  const client = yield* JevClient
  const receipt = yield* client.evaluate(compiled.request)
  const response = yield* decodeReceipt(compiled.request, receipt)
  return toAssessment(input, compiled, receipt, response)
})

export const evaluateOwnershipGroups = Effect.fn("Jev.evaluateOwnershipGroups")(function* (
  inputs: ReadonlyArray<OwnershipGroupEvaluationInput>,
  concurrency = 4,
) {
  return yield* Effect.forEach(inputs, evaluateOwnershipGroup, { concurrency })
})

export type EvaluateOwnershipGroup = typeof evaluateOwnershipGroup
export type JevEvaluateError = JevError
