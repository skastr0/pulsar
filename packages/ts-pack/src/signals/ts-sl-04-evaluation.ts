import {
  type CalibrationProcessorError,
  type CalibrationSlotOutput,
  type ResolvedCalibrationContext,
  type SignalFactorValue,
  type TypeScriptNoopClassificationValue,
} from "@skastr0/pulsar-core"
import { Effect, Option } from "effect"
import type { StubCandidate } from "./ts-sl-04-candidates.js"
import {
  confidenceForStubKind,
  stubKindFromMetadata,
  type StubKind,
} from "./ts-sl-04-factors.js"
import {
  summarizeStubCandidate,
  type EvaluatedStubCandidates,
} from "./ts-sl-04-model.js"
import { evaluateStubPolicy } from "./ts-sl-04-policy.js"

export const evaluateStubCandidates = (
  candidates: ReadonlyArray<StubCandidate>,
  calibration: Option.Option<ResolvedCalibrationContext>,
  hardGateProduction: boolean,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<EvaluatedStubCandidates, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
    const evaluated = emptyEvaluatedStubCandidates()
    for (const candidate of candidates) {
      const candidateResult = yield* evaluateStubCandidate(
        candidate,
        calibration,
        hardGateProduction,
        factorOverrides,
      )
      mergeEvaluatedStubCandidate(evaluated, candidateResult)
    }
    return evaluated
  })

const emptyEvaluatedStubCandidates = (): {
  stubs: Array<EvaluatedStubCandidates["stubs"][number]>
  calibrationDecisions: Array<EvaluatedStubCandidates["calibrationDecisions"][number]>
  rawCandidates: Array<EvaluatedStubCandidates["rawCandidates"][number]>
  factorEntries: Array<EvaluatedStubCandidates["factorEntries"][number]>
} => ({
  stubs: [],
  calibrationDecisions: [],
  rawCandidates: [],
  factorEntries: [],
})

const mergeEvaluatedStubCandidate = (
  target: ReturnType<typeof emptyEvaluatedStubCandidates>,
  source: EvaluatedStubCandidates,
): void => {
  target.stubs.push(...source.stubs)
  target.calibrationDecisions.push(...source.calibrationDecisions)
  target.rawCandidates.push(...source.rawCandidates)
  target.factorEntries.push(...source.factorEntries)
}

const evaluateStubCandidate = (
  candidate: StubCandidate,
  calibration: Option.Option<ResolvedCalibrationContext>,
  hardGateProduction: boolean,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<EvaluatedStubCandidates, CalibrationProcessorError, never> =>
  Effect.gen(function* () {
    const classified = yield* classifyNoopCandidate(candidate, calibration)
    if (classified.value.classification === "intentional_noop") {
      return {
        stubs: [],
        calibrationDecisions: classified.decisions,
        rawCandidates: [summarizeStubCandidate(candidate, "intentional-noop")],
        factorEntries: [],
      }
    }
    const stubKind = stubKindForClassifiedCandidate(candidate, classified.value)
    if (stubKind === undefined) {
      return {
        stubs: [],
        calibrationDecisions: classified.decisions,
        rawCandidates: [],
        factorEntries: [],
      }
    }
    const policy = yield* evaluateStubPolicy(
      candidate,
      stubKind,
      calibration,
      hardGateProduction,
      factorOverrides,
    )
    return {
      stubs: [policy.stub],
      calibrationDecisions: [...classified.decisions, ...policy.decisions],
      rawCandidates: [summarizeStubCandidate(candidate, stubKind.kind)],
      factorEntries: policy.factorEntries,
    }
  })

const classifyNoopCandidate = (
  candidate: StubCandidate,
  calibration: Option.Option<ResolvedCalibrationContext>,
): Effect.Effect<
  CalibrationSlotOutput<"typescript.noop-classifier">,
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    const input: TypeScriptNoopClassificationValue = {
      file: candidate.path,
      name: candidate.name,
      line: candidate.line,
      nodeKind: candidate.nodeKind,
      bodyText: candidate.bodyText,
      functionText: candidate.functionText,
      parentKind: candidate.parentKind,
      parentText: candidate.parentText,
      ancestorKinds: candidate.ancestorKinds,
      candidateKind: candidate.stubKind?.kind ?? "unknown",
      inTestPath: candidate.isTestPath,
      classification: candidate.builtinIntentionalNoop ? "intentional_noop" : "stub",
      confidence: candidate.stubKind === undefined
        ? "high"
        : confidenceForStubKind(candidate.stubKind.kind),
      metadata: {
        builtinIntentionalNoop: candidate.builtinIntentionalNoop,
        ...(candidate.stubKind?.message !== undefined ? { message: candidate.stubKind.message } : {}),
      },
    }
    if (Option.isNone(calibration)) {
      return { value: input, decisions: [] }
    }
    return yield* calibration.value.runSlot("typescript.noop-classifier", input)
  })

const stubKindForClassifiedCandidate = (
  candidate: StubCandidate,
  classified: TypeScriptNoopClassificationValue,
): { readonly kind: StubKind; readonly message: string } | undefined => {
  if (classified.classification !== "stub") return undefined

  const metadata = classified.metadata
  const metadataKind = stubKindFromMetadata(metadata?.stubKind)
  const metadataMessage = typeof metadata?.message === "string" ? metadata.message : undefined
  return {
    kind: metadataKind ?? candidate.stubKind?.kind ?? "empty-body",
    message: metadataMessage ?? candidate.stubKind?.message ?? "Empty implementation",
  }
}
