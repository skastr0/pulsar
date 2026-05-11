import {
  diffTimeIntegrationEnabled,
  type PulsarVector,
} from "@skastr0/pulsar-core/vector"
import type {
  RoutingDiff,
} from "@skastr0/pulsar-core/routing"
import { Effect } from "effect"
import { loadPulsarVectorForWorktree } from "./pulsar-observer"
import { defaultPulsarAnalyzer } from "./pulsar-hook-analyzer"
import {
  EDIT_TOOLS,
  buildRoutingDiffFromToolArgs,
  fingerprintOf,
  recordFromUnknown,
} from "./pulsar-hook-diff"
import type {
  HookAnalysisRequest,
  PulsarAnalysis,
  PulsarAnalyzer,
  PulsarState,
  SettledAnalysis,
  ToolAfterInput,
  ToolAfterOutput,
} from "./pulsar-hook-types"
import {
  appendPulsarAnnotation,
  createErrorAnnotation,
  createPendingAnnotation,
} from "./review-surfacing"

export const createPulsarState = (options?: {
  readonly analyzer?: PulsarAnalyzer
  readonly inlineWaitMs?: number
}): PulsarState => ({
  analyzer: options?.analyzer ?? defaultPulsarAnalyzer,
  inlineWaitMs: options?.inlineWaitMs ?? 75,
  inFlight: new Map(),
  completed: new Map(),
  lastCompletedBySession: new Map(),
  lastSurfacedFingerprintBySession: new Map(),
})

export const afterToolExecute = Effect.fn("PulsarHooks.afterToolExecute")(
  function* ({
    input,
    output,
    worktree,
    state,
  }: {
    readonly input: ToolAfterInput
    readonly output: ToolAfterOutput
    readonly worktree: string
    readonly state: PulsarState
  }) {
    const routed = buildHookAnalysisRequest(input, worktree, state)
    if (routed === undefined) return
    const vectorExit = yield* Effect.either(
      Effect.tryPromise(() => loadPulsarVectorForWorktree(worktree)),
    )
    if (vectorExit._tag === "Left") {
      surfaceVectorLoadFailure(output, state, routed, vectorExit.left)
      return
    }
    const vector = vectorExit.right
    if (!diffTimeIntegrationEnabled(vector)) return

    if (surfaceCompletedAnalysis(output, state, routed)) return
    const pending = ensureAnalysis(state, {
      fingerprint: routed.fingerprint,
      toolName: routed.toolName,
      sessionID: routed.sessionID,
      worktree,
      diff: routed.diff,
      vector,
      previous: state.lastCompletedBySession.get(routed.sessionID),
    })
    const settled = yield* Effect.promise(() =>
      settleWithin(pending, state.inlineWaitMs),
    )

    surfaceSettledAnalysis(output, state, routed, settled)
  },
)

const buildHookAnalysisRequest = (
  input: ToolAfterInput,
  worktree: string,
  state: PulsarState,
): HookAnalysisRequest | undefined => {
  if (!EDIT_TOOLS.has(input.tool)) return undefined
  const args = recordFromUnknown(input.args)
  const diff = buildRoutingDiffFromToolArgs(input.tool, args, worktree)
  if (diff.changedFiles.length === 0) return undefined

  const fingerprint = fingerprintOf({ tool: input.tool, diff })
  if (state.lastSurfacedFingerprintBySession.get(input.sessionID) === fingerprint) {
    return undefined
  }
  return {
    fingerprint,
    toolName: input.tool,
    sessionID: input.sessionID,
    diff,
  }
}

const surfaceVectorLoadFailure = (
  output: ToolAfterOutput,
  state: PulsarState,
  request: HookAnalysisRequest,
  cause: unknown,
): void => {
  appendPulsarAnnotation(
    output,
    createErrorAnnotation({
      changedFiles: request.diff.changedFiles,
      fingerprint: request.fingerprint,
      message: toMessage(cause),
    }),
  )
  markFingerprintSurfaced(state, request)
}

const surfaceCompletedAnalysis = (
  output: ToolAfterOutput,
  state: PulsarState,
  request: HookAnalysisRequest,
): boolean => {
  const completed = state.completed.get(request.fingerprint)
  if (completed === undefined) return false
  appendPulsarAnnotation(output, completed.annotation)
  markFingerprintSurfaced(state, request)
  return true
}

const surfaceSettledAnalysis = (
  output: ToolAfterOutput,
  state: PulsarState,
  request: HookAnalysisRequest,
  settled: SettledAnalysis | undefined,
): void => {
  if (settled?.status === "ready") {
    appendPulsarAnnotation(output, settled.analysis.annotation)
    markFingerprintSurfaced(state, request)
    return
  }
  if (settled?.status === "error") {
    appendPulsarAnnotation(
      output,
      createErrorAnnotation({
        changedFiles: request.diff.changedFiles,
        fingerprint: request.fingerprint,
        message: settled.message,
      }),
    )
    markFingerprintSurfaced(state, request)
    return
  }
  appendPulsarAnnotation(
    output,
    createPendingAnnotation({
      changedFiles: request.diff.changedFiles,
      fingerprint: request.fingerprint,
    }),
  )
}

const markFingerprintSurfaced = (
  state: PulsarState,
  request: HookAnalysisRequest,
): void => {
  state.lastSurfacedFingerprintBySession.set(request.sessionID, request.fingerprint)
}

const ensureAnalysis = (
  state: PulsarState,
  input: {
    readonly fingerprint: string
    readonly toolName: string
    readonly sessionID: string
    readonly worktree: string
    readonly diff: RoutingDiff
    readonly vector: PulsarVector | undefined
    readonly previous?: PulsarAnalysis
  },
): Promise<SettledAnalysis> => {
  const existing = state.inFlight.get(input.fingerprint)
  if (existing !== undefined) return existing

  const pending = state.analyzer({
    fingerprint: input.fingerprint,
    toolName: input.toolName,
    worktree: input.worktree,
    diff: input.diff,
    vector: input.vector,
    previous: input.previous,
  })
    .then((analysis) => {
      state.completed.set(input.fingerprint, analysis)
      state.lastCompletedBySession.set(input.sessionID, analysis)
      return readyResult(analysis)
    })
    .catch((error) => errorResult(toMessage(error)))
    .finally(() => {
      state.inFlight.delete(input.fingerprint)
    })

  state.inFlight.set(input.fingerprint, pending)
  return pending
}


const settleWithin = async (
  promise: Promise<SettledAnalysis>,
  timeoutMs: number,
): Promise<SettledAnalysis | undefined> =>
  Promise.race([
    promise,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ])


const readyResult = (analysis: PulsarAnalysis): SettledAnalysis => ({
  status: "ready",
  analysis,
})

const errorResult = (message: string): SettledAnalysis => ({
  status: "error",
  message,
})

const toMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)
