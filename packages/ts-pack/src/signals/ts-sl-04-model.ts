import type { CalibrationDecision } from "@skastr0/pulsar-core/calibration"
import type { SignalFactorLedger } from "@skastr0/pulsar-core/signal"
import type { StubConfidence, StubKind, StubSeverity } from "./ts-sl-04-factors.js"

export interface Stub {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly kind: StubKind
  readonly visible: boolean
  readonly severity: StubSeverity
  readonly confidence: StubConfidence
  readonly penaltyWeight: number
  readonly scoreCapParticipation: boolean
  readonly scoreCap: number | undefined
  readonly inTestPath: boolean
  readonly message: string | undefined
  readonly policyDecisions: ReadonlyArray<CalibrationDecision>
}

export interface TsSl04Output {
  readonly rawCandidates: ReadonlyArray<StubCandidateSummary>
  readonly stubs: ReadonlyArray<Stub>
  readonly calibrationDecisions: ReadonlyArray<CalibrationDecision>
  readonly byKind: ReadonlyMap<StubKind, number>
  readonly productionStubs: ReadonlyArray<Stub>
  readonly testStubs: ReadonlyArray<Stub>
  readonly totalFunctions: number
  readonly expectedCleanBudget: number
  readonly expectedCleanFunctionRatio: number
  readonly expectedCleanMinFunctions: number
  readonly hardGateProduction: boolean
  readonly diagnosticLimit: number
  readonly factorLedger: SignalFactorLedger
}

export interface StubCandidateSummary {
  readonly file: string
  readonly name: string
  readonly line: number
  readonly kind: StubKind | "intentional-noop" | "unknown"
  readonly inTestPath: boolean
}
