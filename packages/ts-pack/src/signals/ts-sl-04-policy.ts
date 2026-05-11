import type { CalibrationDecision, CalibrationProcessorError, CalibrationSlotOutput, ResolvedCalibrationContext, TypeScriptUnfinishedImplementationPolicyValue } from "@skastr0/pulsar-core/calibration"
import type { SignalFactorLedgerEntry, SignalFactorValue } from "@skastr0/pulsar-core/signal"
import { makeFactorEntry } from "@skastr0/pulsar-core/factors"
import { Effect, Option } from "effect"
import type { StubCandidate } from "./ts-sl-04-candidates.js"
import {
  STUB_KIND_FACTOR_PREFIX,
  booleanFactorValue,
  confidenceForStubKind,
  factorDefinitionByPath,
  numberFactorValue,
  penaltyWeightForStubKind,
  scoreCapForStubKind,
  scoreCapParticipationForStubKind,
  severityForStub,
  stringFactorValue,
  toStubConfidence,
  toStubKind,
  type StubKind,
} from "./ts-sl-04-factors.js"
import type { Stub } from "./ts-sl-04-model.js"

export const evaluateStubPolicy = (
  candidate: StubCandidate,
  stubKind: { readonly kind: StubKind; readonly message: string },
  calibration: Option.Option<ResolvedCalibrationContext>,
  hardGateProduction: boolean,
  factorOverrides: Readonly<Record<string, SignalFactorValue>>,
): Effect.Effect<
  {
    readonly stub: Stub
    readonly decisions: ReadonlyArray<CalibrationDecision>
    readonly factorEntries: ReadonlyArray<SignalFactorLedgerEntry>
  },
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    const policyResult = yield* tuneStubPolicy(
      candidate,
      stubKind.kind,
      stubKind.message,
      calibration,
      hardGateProduction,
    )
    const effectivePolicy = finalizeStubPolicy(
      applyVectorOverridesToStubPolicy(policyResult.value, factorOverrides),
      candidate,
      hardGateProduction,
      factorOverrides,
    )
    return {
      stub: createStub(candidate, effectivePolicy, policyResult.decisions),
      decisions: policyResult.decisions,
      factorEntries: factorEntriesForPolicy(policyResult, factorOverrides),
    }
  })

const tuneStubPolicy = (
  candidate: StubCandidate,
  kind: StubKind,
  message: string | undefined,
  calibration: Option.Option<ResolvedCalibrationContext>,
  hardGateProduction: boolean,
): Effect.Effect<
  CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  CalibrationProcessorError,
  never
> =>
  Effect.gen(function* () {
    const input = defaultStubPolicy(candidate, kind, message, hardGateProduction)
    if (Option.isNone(calibration)) {
      return { value: input, decisions: [] }
    }
    return yield* calibration.value.runSlot("typescript.unfinished-implementation-policy", input)
  })

const defaultStubPolicy = (
  candidate: StubCandidate,
  kind: StubKind,
  message: string | undefined,
  hardGateProduction: boolean,
): TypeScriptUnfinishedImplementationPolicyValue => {
  const confidence = confidenceForStubKind(kind)
  const scoreCap = scoreCapForStubKind(kind)
  return {
    signalId: "TS-SL-04-unfinished-implementations",
    findingId: `${candidate.path}:${candidate.line}:${candidate.name}:${kind}`,
    file: candidate.path,
    name: candidate.name,
    line: candidate.line,
    stubKind: kind,
    message: message ?? "Empty implementation",
    visible: true,
    severity: severityForStub(candidate.isTestPath, confidence, hardGateProduction),
    confidence,
    penaltyWeight: penaltyWeightForStubKind(kind),
    scoreCapParticipation: scoreCapParticipationForStubKind(kind),
    ...(scoreCap !== undefined ? { scoreCap } : {}),
    factorPathPrefix: `${STUB_KIND_FACTOR_PREFIX}.${kind}`,
    metadata: {
      inTestPath: candidate.isTestPath,
    },
  }
}

const applyVectorOverridesToStubPolicy = (
  policy: TypeScriptUnfinishedImplementationPolicyValue,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): TypeScriptUnfinishedImplementationPolicyValue => {
  const prefix = policy.factorPathPrefix
  const confidence = stringFactorValue(`${prefix}.confidence`, policy.confidence, overrides)
  const scoreCap = numberFactorValue(`${prefix}.score_cap`, policy.scoreCap, overrides)
  return {
    ...policy,
    confidence: toStubConfidence(confidence),
    penaltyWeight:
      numberFactorValue(`${prefix}.penalty_weight`, policy.penaltyWeight, overrides) ??
      policy.penaltyWeight,
    scoreCapParticipation: booleanFactorValue(
      `${prefix}.score_cap_participation`,
      policy.scoreCapParticipation,
      overrides,
    ),
    ...(scoreCap !== undefined ? { scoreCap } : {}),
  }
}

const finalizeStubPolicy = (
  policy: TypeScriptUnfinishedImplementationPolicyValue,
  candidate: StubCandidate,
  hardGateProduction: boolean,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): TypeScriptUnfinishedImplementationPolicyValue => {
  const confidence = toStubConfidence(policy.confidence)
  const confidencePath = `${policy.factorPathPrefix}.confidence`
  const defaultSeverity = severityForStub(
    candidate.isTestPath,
    confidenceForStubKind(toStubKind(policy.stubKind)),
    hardGateProduction,
  )
  const shouldRecomputeSeverity =
    Object.hasOwn(overrides, confidencePath) || policy.severity === defaultSeverity
  return {
    ...policy,
    confidence,
    severity: shouldRecomputeSeverity
      ? severityForStub(candidate.isTestPath, confidence, hardGateProduction)
      : policy.severity,
  }
}

const createStub = (
  candidate: StubCandidate,
  policy: TypeScriptUnfinishedImplementationPolicyValue,
  policyDecisions: ReadonlyArray<CalibrationDecision>,
): Stub => ({
  file: candidate.path,
  name: candidate.name,
  line: candidate.line,
  kind: toStubKind(policy.stubKind),
  visible: policy.visible,
  severity: policy.severity,
  confidence: toStubConfidence(policy.confidence),
  penaltyWeight: policy.penaltyWeight,
  scoreCapParticipation: policy.scoreCapParticipation,
  scoreCap: policy.scoreCap,
  inTestPath: candidate.isTestPath,
  message: policy.message,
  policyDecisions,
})

const factorEntriesForPolicy = (
  policyResult: CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  overrides: Readonly<Record<string, SignalFactorValue>>,
): ReadonlyArray<SignalFactorLedgerEntry> => {
  const policy = policyResult.value
  const scoreCapPath = `${policy.factorPathPrefix}.score_cap`
  return [
    factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.confidence`, policy.confidence),
    factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.penalty_weight`, policy.penaltyWeight),
    factorEntryForPolicyValue(
      policyResult,
      `${policy.factorPathPrefix}.score_cap_participation`,
      policy.scoreCapParticipation,
    ),
    ...(policy.scoreCap !== undefined || Object.hasOwn(overrides, scoreCapPath)
      ? [factorEntryForPolicyValue(policyResult, `${policy.factorPathPrefix}.score_cap`, policy.scoreCap)]
      : []),
  ]
}

const factorEntryForPolicyValue = (
  policyResult: CalibrationSlotOutput<"typescript.unfinished-implementation-policy">,
  path: string,
  value: SignalFactorValue | undefined,
): SignalFactorLedgerEntry => {
  const decision = [...policyResult.decisions]
    .reverse()
    .find((item) => item.factorPaths?.includes(path))
  return makeFactorEntry(factorDefinitionByPath(path), value ?? null, {
    source: decision === undefined ? "computed" : "module",
    ...(decision !== undefined
      ? {
          attribution: {
            moduleId: decision.moduleId,
            processorId: decision.processorId,
            ...(decision.ruleId !== undefined ? { ruleId: decision.ruleId } : {}),
            evidence: decision.evidence,
          },
        }
      : {}),
  })
}
